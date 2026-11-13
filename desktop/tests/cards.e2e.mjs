import { _electron as electron } from 'playwright';
import executablePath from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { persistSchedule } from '../dist-service/strategy-schedule.js';

// Unified card responses and derived strategy state in a hidden window.
const root = process.cwd(), directory = await mkdtemp(path.join(tmpdir(), 'polaris-loop-ui-')), database = path.join(directory, 'test.sqlite');
const store = new PolarisStore(database), data = new AgentStore(store), results = path.join(root, 'test-results'); await mkdir(results, { recursive: true });
const milestone = '到 2027-01-19：至少 5 家中国跨境家具卖家发布教程', next = '到 2027-01-19：至少 5 家中国跨境家具卖家或工厂发布教程';
const goal = store.mutate('goal', 'create', undefined, { requestID: randomUUID(), title: 'Formlore 增长', milestone, symbol: 'Target' });
const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const strategy = (id, title) => { const value = { id, version: 1, status: 'active', createdAt: at, updatedAt: at, goalID: goal.id, title, body: '按已确认的方向推进', origin: 'user' }; store.persist('strategy', value); return value; };
const idle = strategy('idle', '社区发帖招募'), active = strategy('factories', '创始人亲自带首批商家');
const scheduled = strategy('scheduled', '定时复查');
// These columns have finished decision preparation and remain available for manual work.
for (const item of [idle, scheduled]) store.query("INSERT INTO metadata(key,value) VALUES(?,'prepared')", `strategy_auto_advance:${item.id}`);
const nextAt = new Date(Date.now() + 86_400_000).toISOString();
const scheduleID = persistSchedule(store, { strategyID: scheduled.id, title: '复查回复', instructions: 'Check for replies.', nextAt, config: { timezone: 'UTC', rule: { frequency: 'once', at: nextAt } } });
const scheduledTask = store.query('SELECT * FROM scheduled_task WHERE id=?', scheduleID)[0];
const card = fields => store.mutate('decision','submit',undefined,{requestID:randomUUID(),strategyID:active.id,body:'工厂发布教程，看教程的是下游卖家的顾客。',...fields});
const old = card({ title: '首批商家从哪里找', options: [{ id: 'factories', label: '联系产业带工厂' }] });
const oldOutcome = store.decide(old.id, 'factories', '', old.version);
store.persistOutcome({ ...oldOutcome, decidedAt: '2026-01-01T00:00:00Z' });
const plan=card({title:'自己做说明书的工厂算不算进 5 家',options:[{id:'count-b',label:'算：工厂也计入 5 家',detail:next},{id:'a-only',label:'不算：只算自己卖货的工厂'}]});
const action=card({title:'示例教程的网址是什么？',options:[],body:'填写网址，Agent 会把它放进联系话术。'});
const uncertain = strategy('uncertain', '待核对策略');
const uncertainWork = data.createWork(uncertain.id, '发送结果不明', '发送消息');
const uncertainJob = data.queue('work', uncertainWork.instructions, uncertainWork.id);
store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?", uncertainJob, uncertainWork.id);
store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=? WHERE id=?", uncertainJob, uncertainJob);
data.setJob(uncertainJob, 'needs_review'); data.runs.delivery(uncertainJob, 'unknown');
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ 'claude-code': null, 'chatgpt-codex': null, 'gemini-cli': null }) }; delete env.ELECTRON_RUN_AS_NODE;
let app; const errors = [];
const settled = page => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executablePath, args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env });
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFocused() || w.isFocusable())), false);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 720));

  const uncertainLane = page.locator('.lane', { has: page.getByRole('heading', { name: uncertain.title }) });
  await uncertainLane.getByText('Polaris 需要先核实上次结果，再继续执行。', { exact: true }).waitFor();
  assert.equal(await uncertainLane.getByRole('button', { name: '继续推进', exact: true }).count(), 0);
  const refused = await page.evaluate(strategyID => window.polaris.call('advanceStrategy', { strategyID }), uncertain.id);
  assert.equal(refused.error.messageKey, 'loop.reviewRequired');
  assert.equal(store.query('SELECT COUNT(*) AS n FROM agent_job WHERE workID=?', uncertainWork.id)[0].n, 1);

  const idleLane = page.locator('.lane', { has: page.getByRole('heading', { name: idle.title }) });
  await idleLane.getByText('没有待决策', { exact: true }).waitFor();
  const cards = page.locator('.lane', { has: page.getByRole('heading', { name: active.title }) });
  assert.equal(await cards.getByText(old.title, { exact: true }).count(), 0);

  await settled(page); await page.screenshot({ path: path.join(results, 'loop-board-zh.png') });

  await cards.locator(`[data-decision-id="${plan.id}"]`).click();
  const modal = page.locator('.modal-content');
  assert.equal(await modal.locator('.plan-changes').count(),0);
  await modal.getByText(next,{exact:true}).waitFor();
  await modal.locator('.option').first().click(); await settled(page);
  await page.screenshot({ path: path.join(results, 'loop-plan-card-zh.png') });
  await modal.getByRole('button', { name: /^确定/ }).click();
  await page.waitForFunction(() => !document.querySelector('.modal-content'));
  assert.equal(store.get('goal', goal.id).milestone, milestone,'Only main Agent applies accepted plan edits');
  assert.equal(await page.locator('.undo-toast').count(), 0, 'An applied plan edit offers no undo');

  await cards.locator(`[data-decision-id="${action.id}"]`).click();
  await modal.getByRole('heading', { name: action.title, exact: true }).waitFor();
  assert.equal(await modal.locator('.option').count(), 0);
  assert.equal(await modal.getByRole('button',{name:/^确定/}).isDisabled(),true);
  await modal.locator('textarea').fill('https://example.test/tutorial');
  await settled(page);await page.screenshot({path:path.join(results,'unified-card-zh.png')});
  await modal.getByRole('button',{name:/^确定/}).click();
  await page.waitForFunction(() => !document.querySelector('.modal-content'));
  assert.equal(store.snapshot().decisions.find(item => item.id === action.id).outcome.note, 'https://example.test/tutorial');

  await idleLane.getByRole('button', { name: '继续推进', exact: true }).click();
  const idleState = idleLane.locator('.lane-loop-waiting_connection');
  await idleState.getByText('没有待决策', { exact: true }).waitFor();
  assert.equal(await idleState.getByText(idle.title, { exact: true }).count(), 0);
  assert.equal(store.query("SELECT count(*) AS n FROM agent_work WHERE strategyID=?", idle.id)[0].n, 1);

  await cards.locator('.lane-loop-waiting_connection').waitFor();
  assert.equal(await cards.getByText(old.title, { exact: true }).count(), 0);
  assert.equal(await cards.getByText(/^已决策/).count(), 0);
  const strategyTitle = cards.locator('.strategy-title-button');
  await strategyTitle.click();
  const records = page.getByRole('dialog', { name: active.title }), history = records.locator('.record-row');
  await records.getByRole('heading', { name: '历史决定' }).waitFor();
  assert.deepEqual(await records.locator('.records-body > *').evaluateAll(nodes => nodes.map(node => node.className.trim() || node.textContent)),
    ['markdown', '历史决定', 'record-row', 'record-row', 'record-row']);
  assert.equal(await records.locator('.markdown').textContent(), active.body);
  assert.equal(await history.last().locator('strong').textContent(), old.title);
  assert.deepEqual(new Set(await history.locator('strong').allTextContents()), new Set([action.title, plan.title, old.title]));
  await history.filter({ hasText: 'https://example.test/tutorial' }).click();
  await modal.getByRole('heading', { name: action.title }).waitFor();
  assert.equal(await modal.getByRole('button', { name: /^确定/ }).count(), 0);
  await modal.press('Escape');
  await records.getByRole('heading', { name: '历史决定' }).waitFor();
  await records.press('Escape');
  await page.waitForFunction(id => document.activeElement?.dataset.strategyId === id, active.id);

  const scheduledLane = page.locator('.lane', { has: page.getByRole('heading', { name: scheduled.title }) });
  await scheduledLane.locator('.lane-loop-scheduled').waitFor();
  const advanceScheduled = scheduledLane.getByRole('button', { name: '继续推进', exact: true });
  assert.equal(await advanceScheduled.count(), 1, 'A future schedule should still allow manual work');
  await advanceScheduled.click();
  await scheduledLane.locator('.lane-loop-waiting_connection').getByText('没有待决策', { exact: true }).waitFor();
  assert.equal(await advanceScheduled.count(), 0);
  const repeated = await page.evaluate(strategyID => window.polaris.call('advanceStrategy', { strategyID }), scheduled.id);
  assert.equal(repeated.result.status, 'already_running');
  assert.equal(store.query('SELECT count(*) AS n FROM agent_work WHERE strategyID=?', scheduled.id)[0].n, 1);
  assert.deepEqual(store.query('SELECT * FROM scheduled_task WHERE id=?', scheduleID)[0], scheduledTask);
  assert.deepEqual(errors, []);
  console.log('PASS hidden unified card UI, connection and uncertainty states, and manual advancement with future timing preserved.');
} finally { await app?.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
