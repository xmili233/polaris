import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { translator } from '@polaris/i18n';
const root = process.cwd(), directory = await mkdtemp(path.join(tmpdir(), 'polaris-execution-ui-')), database = path.join(directory, 'test.sqlite');
const store = new PolarisStore(database), data = new AgentStore(store), results = path.join(root, 'test-results'); await mkdir(results, { recursive: true });
const goals = [], strategies = [];
for (let i = 1; i <= 20; i++) {
  goals.push(store.mutate('goal', 'create', undefined, { requestID: randomUUID(), id: `goal-${i}`, title: `目标 ${i}`, milestone: '集中决策，自动推进', symbol: 'Target' }));
  strategies.push(store.mutate('strategy', 'create', undefined, { requestID: randomUUID(), goalID: goals.at(-1).id, title: `策略 ${i}`, body: '按已确认的方向推进工作', origin: 'user' }));
}
const sourceJob = data.queue('main', '生成客户方案'); data.setJob(sourceJob, 'completed');
const artifactID = randomUUID(); store.query('INSERT INTO agent_artifact(id,workID,title,body,jobID) VALUES(?,NULL,?,?,?)', artifactID, '客户方案正文', '这是批准后应该交付的方案正文。', sourceJob);
const card = (title, strategyID, inputs, excerpt) => store.mutate('decision', 'submit', undefined, { requestID: randomUUID(), strategyID, title, body: '本次已明确工作范围，请确认具体选择。', inputs, ...(excerpt ? { excerpt } : {}), options: [{ id: 'yes', label: '按方案执行', detail: '执行这里确认的工作' }, { id: 'no', label: '暂缓执行', detail: '保留现状' }] });
const first = card('确认客户方案', strategies[0].id, { artifactIDs: [artifactID] }, '请查收本周客户方案。');
const second = card('确认后续交付', strategies[1].id, {});
function receipt(title, state, report) {
  const work = data.createWork(strategies[0].id, title, '准备并交付客户资料'), id = data.queue('work', work.instructions, work.id), session = `task:${id}`;
  store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?", session, work.id);
  store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=?,generation=1 WHERE id=?", session, id); data.setInputs(id, {}); data.setJob(id, 'running');
  if (report) {
    const artifact = randomUUID(); store.query('INSERT INTO agent_artifact(id,workID,title,body,jobID) VALUES(?,?,?,?,?)', artifact, work.id, '客户分析报告', '# 客户分析\n\n已整理客户需求、预算和下一步验证方式。', id);
  }
  data.runs.delivery(id, state === 'needs_review' ? 'unknown' : 'completed'); data.setJob(id, state, state === 'needs_review' ? 'native_delivery_unknown' : ''); data.setWork(work.id, state, ''); data.runs.finish(id);
  return id;
}
const interrupted = receipt('待核对的任务', 'needs_review'), delivered = receipt('已交付的任务', 'completed', true), unverified = receipt('没有结果报告的任务', 'completed');
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ 'claude-code': null, 'chatgpt-codex': null, 'gemini-cli': null }) }; delete env.ELECTRON_RUN_AS_NODE;
let app; const errors = [];
const wait = async predicate => { const until = Date.now() + 15000; while (Date.now() < until) { if (await predicate()) return; await new Promise(r => setTimeout(r, 40)); } assert.fail('UI state did not settle'); };
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executablePath, args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env }); const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await page.locator('.connect-screen').count(), 0, 'Existing business data stays accessible without an installed AI');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFocused() || w.isFocusable())), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
  const rail = page.locator('.goal-list');
  await rail.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const bounds = await page.locator('.goal-list .goal-button').last().boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height < await page.locator('.library-button').evaluate(n => n.getBoundingClientRect().top));
  await page.locator('.goal-list .goal-button').last().click(); await page.getByRole('heading', { name: '目标 20', exact: true }).waitFor();
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  await page.screenshot({ path: path.join(results, 'execution-goals-compact.png') });
  assert.equal(await page.getByRole('button', { name: '连续审阅', exact: true }).count(), 0, 'Continuous review is removed (R-D170).');
  await page.locator('.goal-list .goal-button').first().click(); await page.getByRole('heading', { name: '目标 1', exact: true }).waitFor();
  await page.locator(`[data-decision-id="${first.id}"]`).click();
  await page.getByRole('heading', { name: first.title, exact: true }).waitFor();
  const modal = page.locator('.modal-content');
  await modal.getByText('请查收本周客户方案。', { exact: true }).waitFor();
  assert.equal(await modal.getByText('客户方案正文', { exact: true }).count(), 0);
  assert.equal(await modal.getByText('这是批准后应该交付的方案正文。', { exact: true }).count(), 0);
  assert.equal(await modal.getByRole('checkbox').count(), 0);
  await modal.getByText(translator('zh-Hans')('execution.confirmationHelp'), { exact: true }).waitFor();
  await modal.locator('.option').first().click();
  await page.waitForFunction(() => !document.querySelector('.modal-content .confirm')?.disabled && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  await page.screenshot({ path: path.join(results, 'execution-decision-zh.png') });
  await modal.getByRole('button', { name: /^确定/ }).click();
  await wait(async () => await page.locator('.modal-content').count() === 0);
  assert.equal(store.outcomes().some(o => o.decisionID === second.id), false, 'Confirming one card never decides another');
  await page.locator('.goal-list .goal-button').nth(1).click(); await page.getByRole('heading', { name: '目标 2', exact: true }).waitFor();
  await page.locator(`[data-decision-id="${second.id}"]`).click();
  await page.getByRole('heading', { name: second.title, exact: true }).waitFor();
  assert.equal(await modal.locator('.option[aria-pressed="true"]').count(), 0);
  const firstJob = store.query('SELECT j.id FROM agent_job j JOIN outcome o ON o.id=j.outcomeID WHERE o.decision_id=?', first.id)[0].id;
  assert.deepEqual(data.inputs(data.job(firstJob)).artifactIDs, [artifactID]);
  assert.equal(await modal.locator('.execution-section').count(), 0);
  await modal.locator('.option').first().click(); await modal.getByRole('button', { name: /确定/ }).last().click();
  await wait(async () => await page.locator('.modal-content').count() === 0);
  assert.equal(await page.getByRole('button', { name: /^执行记录/ }).count(), 0, 'Results live in the task capsule (R-D126).');
  const done = page.locator(`[data-result-id="${delivered}"]`), attention = page.locator(`[data-result-id="${interrupted}"]`);
  await attention.waitFor();
  assert.equal(await done.count(), 0, 'Completed tasks leave the rail without requiring the user to open them.');
  const unchecked = page.locator(`[data-result-id="${unverified}"]`);
  assert.equal(await unchecked.count(), 0, 'A completed task does not need an artifact to leave the rail.');
  assert.equal(data.job(delivered).state, 'completed');
  assert.equal(store.query('SELECT body FROM agent_artifact WHERE jobID=?', delivered).length, 1, 'Removing the entry preserves its result.');
  const taskDialog = page.locator('.work-chat-dialog');
  await attention.click(); await taskDialog.getByRole('heading', { name: '待核对的任务', exact: true }).waitFor();
  for (const language of ['en', 'zh-Hant', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'zh-Hans']) {
    await page.evaluate(value => window.polaris.setLanguage(value), language); await page.waitForFunction(value => document.documentElement.lang === value, language);
    assert.ok(await taskDialog.evaluate(node => node.scrollWidth <= node.clientWidth), `${language}: task chat overflow`);
  }
  await page.screenshot({ path: path.join(results, 'task-chat-interrupted-zh.png') });
  assert.equal(await taskDialog.locator('.child-chat textarea').count(), 0);
  assert.equal(data.job(interrupted).delivery, 'unknown');
  assert.deepEqual(errors, []); console.log('PASS hidden execution UI: offline workspace, 20-goal scrolling, single-card decisions, built-in dispatch, hidden inputs, visible approval text, completed tasks removed with records preserved, read-only interrupted tasks, nine languages and focus.');
} catch (error) {
  const page = app?.windows()[0]; if (page) { console.error(await page.locator('body').innerText().catch(() => 'No body')); await page.screenshot({ path: path.join(results, 'execution-failure.png') }).catch(() => {}); }
  console.error(errors); throw error;
} finally { await app?.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
