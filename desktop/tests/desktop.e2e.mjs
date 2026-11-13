import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { LocalHost } from '../electron/host.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-electron-ui-'));
const database = path.join(directory, 'polaris.sqlite');
const cliPath = path.resolve(root, 'bin/polaris');
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
function cli(...args) {
  const result = spawnSync(cliPath, ['--database', database, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function write(kind, action, values, id, file = database) {
  const store = new PolarisStore(file);
  try { return store.mutate(kind, action, id, { requestID: randomUUID(), ...values }); }
  finally { store.close(); }
}
function submit(id, strategyID, title = `Research question ${id}`) {
  return write('decision', 'submit', { id, strategyID, title, body: '## Context\n\nWe can interview **five people** this week.\n\n- Learn from real conversations\n- Keep the audience focused\n\n| Audience | Benefit |\n| --- | --- |\n| Founders | Fast feedback |\n\n```js\nconst decision = "your call";\n```\n\n[Reference](https://example.com)',
    excerpt: '> A short excerpt for review.',
    options: [{ id: 'a', label: '**Solo** founders', detail: 'Start with people who can [try it](https://example.com) themselves.' }, { id: 'b', label: 'Small product teams', detail: 'Learn where shared workflows create friction.' }],
    recommendedOptionID: 'a' });
}
write('goal', 'create', { id: 'growth', title: 'Find my first 10 customers', milestone: 'Speak with five potential customers this week.', symbol: 'ChartNoAxesCombined', constraints:'**No paid ads.** Start with direct conversations.' });
write('strategy', 'create', { id: 'interviews', goalID: 'growth', title: 'Customer conversations', body: 'Interview potential users and compare their needs.', origin: 'Agent' });
for (let i = 0; i < 6; i++) submit(`question-${i}`, 'interviews', i === 0 ? 'Who should we interview first?' : `Which opportunity should we validate ${i}?`);
write('goal', 'create', { id: 'build', title: 'Build a useful product', milestone: 'Validate three independent approaches.', symbol: 'hammer', constraints:'Prefer **small changes** with evidence.' });
for (let i = 0; i < 3; i++) write('strategy', 'create', { id: `strategy-${i}`, goalID: 'build', title: ['Build in public', 'Validate the offer', 'Explore alternatives'][i], body: 'Research the next useful step.', origin: 'Agent' });
submit('other-1', 'strategy-0'); submit('other-2', 'strategy-1');

const env = { ...process.env, POLARIS_TEST: '1' }; env.POLARIS_TEST_NATIVE_CODEX = path.join(root, 'tests/fixtures/native-agent.mjs');
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  const executablePath = process.env.POLARIS_APP ?? electronExecutable;
  const appArgs = process.env.POLARIS_APP ? [] : [root];
  app = await electron.launch({ executablePath, args: [...appArgs, '--database', database, '--language', 'en'], env, timeout: 30_000 });
  const page = await app.firstWindow();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false, 'UI tests must not take desktop focus.');
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await page.locator('.goal-constraints > summary').count(), 0, 'Constraints are visible without expanding a section.');
  assert.equal(await page.locator('.constraint-chip').first().innerText(), 'No paid ads. Start with direct conversations.');
  assert.equal(await page.locator('.auth-screen').count(), 0);
  assert.equal(await page.evaluate(() => typeof window.polaris.auth), 'undefined');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 2, 'Only general and model settings remain');
  await page.locator('.settings-close').click();
  await page.locator('.settings-layer').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.agent-sheet, .agent.full').count(), 0, 'An existing goal never enters first-goal animation while the initial snapshot loads.');
  await page.waitForFunction(() => document.querySelectorAll('.decision-card').length === 6);
  assert.equal(await page.locator('.lane').count(), 1);
  const singleWidth = await page.locator('.lane').evaluate(node => node.getBoundingClientRect().width);
  assert.equal(singleWidth, await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lane'))));
  assert.equal(await page.locator('.lane-cards').evaluate(node => getComputedStyle(node).display), 'flex');
  await page.locator('.goal-list .goal-button').nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 3);
  assert.equal(await page.locator('.lane').first().evaluate(node => node.getBoundingClientRect().width), singleWidth, 'A single strategy has the same width as each strategy in a multi-column board.');
  await page.locator('.goal-list .goal-button').first().click();
  await page.waitForFunction(() => document.querySelectorAll('.decision-card').length === 6);
  assert.equal(await page.locator('.goal-list .goal-button').count(), 2);
  await page.waitForSelector('.goal-button svg.goal-symbol');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.board')).opacity === '1');
  await page.screenshot({ path: path.join(results, 'single-strategy.png') });

  const agent = page.locator('.agent'), agentInput = agent.locator('textarea');
  // Reduced motion follows the system setting unless the test run pins it (POLARIS_TEST_REDUCED_MOTION, used by CI).
  const pinnedMotion = process.env.POLARIS_TEST_REDUCED_MOTION;
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('reduce-motion')),
    pinnedMotion === '1' || pinnedMotion === '0' ? pinnedMotion === '1'
      : await app.evaluate(({ systemPreferences }) => systemPreferences.getAnimationSettings().prefersReducedMotion), 'Reduced motion follows the system setting.');
  // R-D162 opens the main conversation from the first rail entry.
  const toggle=page.locator('.main-agent-entry');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  const settled=()=>page.locator('.work-chat-dialog').evaluate(n=>Promise.all(n.getAnimations().map(a=>a.finished)));
  await toggle.click();await settled();
  const original=await agentInput.boundingBox();
  await agentInput.fill('Draft survives closing');await toggle.click();
  await agent.waitFor({state:'hidden'});await toggle.click();await settled();
  assert.equal(await agentInput.inputValue(),'Draft survives closing');await agentInput.fill('');
  const restored=await agentInput.boundingBox();for(const key of ['x','y','width','height'])assert.ok(Math.abs(restored[key]-original[key])<1,'Dialog restores input geometry within pixel rounding');
  assert.equal(await agent.locator('.agent-header .work-chat-heading > span').count(),0,'An idle main Agent shows no status (R-D169)');
  await page.evaluate(() => window.polaris.call('agentNative', { action: 'disconnect', provider: 'chatgpt-codex' }));
  await page.locator('.agent-offline').waitFor();
  await agentInput.fill('Draft a plan'); await agentInput.press('Shift+Enter');
  assert.equal(await agentInput.inputValue(), 'Draft a plan\n');
  await agentInput.press('Enter');
  await agent.locator('.agent-message').waitFor();
  assert.equal(await agent.locator('.agent-message').textContent(), 'Draft a plan');
  assert.match(await agent.locator('.agent-offline').textContent(), /^Codex is not connected\. Message saved\. Connect to continue\.\s*Open Settings$/);
  assert.equal(await agent.locator('.agent-recovery').count(), 0, 'Waiting for a connection is not shown as a failure.');
  const messageTop = () => agent.locator('.agent-message').evaluate(element => element.getBoundingClientRect().top);
  const restingTop = await messageTop(); await agent.locator('.agent-message').hover();
  assert.equal(await messageTop(), restingTop, 'Hovering a message must not change the layout.');
  assert.equal(await agent.locator('.agent-user-message button').count(), 0);
  assert.equal(await agentInput.inputValue(), '');
  // Sending briefly disables the input, so establish focus before testing pointer leave.
  await agentInput.focus();
  await page.mouse.move(400, 200); await page.waitForTimeout(500);
  assert.equal(await page.locator('.work-chat-dialog').count(), 1, 'A focused agent input stays open when the pointer leaves.');
  await page.screenshot({ path: path.join(results, 'agent-expanded.png') });
  await agentInput.press('Escape'); await agent.waitFor({state:'hidden'});

  await page.locator('[data-decision-id="question-0"] .card-title').click();
  await page.waitForSelector('.modal-content');
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
  assert.equal(await page.locator('.decision-reading table').count(), 1);
  assert.equal(await page.locator('.decision-reading pre').count(), 1);
  await page.locator('.option-content').first().click();
  assert.equal(await page.locator('.option').first().getAttribute('aria-pressed'), 'true');
  await page.locator('.custom-decision').fill('Start with **B2B founders**.');
  assert.equal(await page.locator('.option.selected').count(), 0);
  await page.locator('.custom-decision').press('2');
  assert.equal(await page.locator('.option.selected').count(), 0);
  await page.locator('.modal-content').focus();
  await page.keyboard.press('2');
  assert.equal(await page.locator('.option').nth(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.custom-decision').inputValue(), '');
  await page.locator('.custom-decision').fill('Start with **B2B founders**.');
  await page.screenshot({ path: path.join(results, 'decision-custom.png') });
  await page.keyboard.press('Meta+Enter');
  await page.waitForSelector('.modal-content', { state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('.decision-card').length === 5);
  const custom = cli('outcomes', '--unacknowledged').find(item => item.decisionID === 'question-0');
  assert.equal(custom.note, 'Start with **B2B founders**.'); assert.equal(custom.optionID, undefined);
  await page.locator('[data-strategy-id=interviews]').click();
  await page.locator('.strategy-records .record-row').filter({hasText:'Who should we interview first?'}).click();
  await page.waitForSelector('.modal-content');
  assert.equal(await page.locator('.option.selected').count(), 0);
  assert.equal(await page.locator('.saved-note strong').textContent(), 'B2B founders');
  assert.equal(await page.locator('.undo-toast').count(), 0);
  assert.equal(await page.locator('.decision-footer button, .custom-decision').count(), 0, 'Confirmed cards are read-only');
  assert.equal(await page.getByRole('button', { name: 'Withdraw', exact: true }).count(), 0);
  assert.equal(cli('outcomes', '--unacknowledged').find(item => item.decisionID === 'question-0').id, custom.id);
  await page.locator('.modal-content').press('Escape');
  await page.waitForSelector('.modal-content', { state: 'detached' });
  await page.waitForSelector('.strategy-records');
  await page.screenshot({ path: path.join(results, 'decided-panel.png') });
  assert.equal(await page.locator('.handoff-button').count(), 0);
  assert.equal(await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.some(item=>item.label==='Grok')), false);
  assert.equal(await page.evaluate(()=>typeof window.polaris.copyHandoff), 'undefined');
  await page.locator('.strategy-records').press('Escape');

  await page.locator('[data-decision-id="question-1"]').click();
  await page.waitForSelector('.modal-content');
  const old = cli('decision', 'list').find(item => item.id === 'question-1');
  write('decision', 'update', { expectedVersion: old.version, strategyID: old.strategyID, title: 'Updated externally', body: old.body, excerpt: old.excerpt, options: old.options,
    recommendedOptionID: old.recommendedOptionID }, old.id);
  await page.waitForFunction(() => document.querySelector('[data-decision-id="question-1"]')?.textContent.includes('Updated externally'));
  assert.equal((await page.locator('#decision-title').textContent()).includes('Updated externally'), false);
  await page.locator('.option').first().click(); await page.locator('.confirm').click();
  await page.waitForSelector('.error-alert');
  assert.equal(await page.locator('.modal-content').count(), 1);
  await page.locator('.error-alert .primary').click();
  await page.locator('.modal-content').press('Escape');
  await page.waitForSelector('.modal-content', { state: 'detached' });
  await page.locator('[data-decision-id="question-1"]').click();
  assert.equal(await page.locator('#decision-title').textContent(), 'Updated externally');
  await page.locator('.option').first().click(); await page.locator('.confirm').click();
  await page.waitForSelector('.modal-content', { state: 'detached' });
  const fixture = new PolarisStore(database);
  try { fixture.persistOutcome({ ...custom, acknowledgedAt: custom.decidedAt }); }
  finally { fixture.close(); }
  assert.equal(await page.locator('.decided-button').count(),0);

  await page.keyboard.press('Meta+2');
  await page.waitForFunction(() => document.querySelectorAll('.lane').length === 3);
  const heights = await page.locator('.lane').evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().height)));
  assert.equal(new Set(heights).size, 1);
  const emptyGeometry = await page.locator('.lane-empty').evaluate(element => {
    const rect = element.getBoundingClientRect(); const icon = element.querySelector('.symbol').getBoundingClientRect();
    return { center: rect.top + rect.height / 2, contentCenter: (icon.top + element.lastElementChild.getBoundingClientRect().bottom) / 2 };
  });
  assert.ok(Math.abs(emptyGeometry.center - emptyGeometry.contentCenter) < 10);
  await page.screenshot({ path: path.join(results, 'multiple-strategies.png') });
  await page.locator('.constraint-chip').first().click();
  assert.equal(await page.locator('.constraints-dialog strong').textContent(),'small changes');
  await page.locator('.constraints-dialog').press('Escape');
  await page.waitForFunction(() => document.querySelector('.constraints-chips .constraint-chip') === document.activeElement);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(980,620));
  await page.screenshot({path:path.join(results,'minimum-window.png')});

  assert.deepEqual(errors, []);
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const window = BrowserWindow.getAllWindows()[0]; window.once('closed', resolve); window.close();
  }));
  const reopenedPromise = app.waitForEvent('window');
  await app.evaluate(({app}) => app.emit('activate'));
  const reopened = await reopenedPromise;
  await reopened.waitForSelector('.app[data-ready="true"]');
  await reopened.locator('[data-strategy-id=interviews]').click();
  await reopened.locator('.strategy-records').waitFor();
  await reopened.getByRole('button',{name:/Who should we interview first/}).click();
  await reopened.locator('.saved-note strong').waitFor();
  assert.equal(await reopened.locator('.custom-decision').count(),0);
  await reopened.locator('.modal-content').press('Escape');
  await reopened.locator('.strategy-records').press('Escape');
  for (let i=0;i<18;i++)submit(`pending-many-${i}`,'interviews',`A pending question ${i}`);
  await reopened.keyboard.press('Meta+1');
  await reopened.waitForFunction(()=>document.querySelectorAll('.decision-card').length===22);
  await reopened.locator('.lane-cards').evaluate(element=>{element.scrollTop=element.scrollHeight;});
  assert.ok(await reopened.locator('.decision-card').last().evaluate(n=>n.getBoundingClientRect().bottom<=innerHeight));
  await reopened.screenshot({path:path.join(results,'single-overflow.png')});
  await app.close(); app = undefined;

  const blank = path.join(directory, 'empty', 'polaris.sqlite');
  app = await electron.launch({ executablePath, args: [...appArgs, '--database', blank, '--language', 'zh-Hans'], env, timeout: 30_000 });
  const emptyPage = await app.firstWindow();
  await emptyPage.waitForSelector('.app[data-ready="true"]');
  assert.equal(await emptyPage.locator('.no-goals h1').textContent(), '还没有目标');
  assert.equal(await emptyPage.locator('.goal-list .goal-button').count(), 0);
  await emptyPage.screenshot({ path: path.join(results, 'empty-install-zh.png') });
  const blankWrite = (kind, values) => write(kind, 'create', values, undefined, blank);
  blankWrite('goal', { id: 'short', title: '验证真实需求', milestone: '先找到愿意持续使用产品的人。' });
  const fresh=new PolarisStore(blank);try{const goal=fresh.get('goal','short');fresh.mutate('goal','update',goal.id,{requestID:randomUUID(),expectedVersion:goal.version,title:goal.title,milestone:goal.milestone,constraints:'先验证用户需求，再扩大投入。'});}finally{fresh.close();}
  await emptyPage.locator('.constraints-chips .constraint-chip').getByText('先验证用户需求，再扩大投入。',{exact:true}).waitFor();
  await emptyPage.screenshot({path:path.join(results,'goal-constraints-zh.png')});
  const constraints = ['首批验证阶段对商家完全免费，不收取任何费用', ...Array.from({length:6},(_,i)=>`约束 ${i+1}：优先完成已经确认的工作，并记录真实反馈。`)];
  const updateConstraints = text => { const store=new PolarisStore(blank);try { const goal=store.get('goal','short');store.mutate('goal','update',goal.id,{requestID:randomUUID(),expectedVersion:goal.version,title:goal.title,milestone:goal.milestone,constraints:text}); } finally {store.close();} };
  updateConstraints(constraints.join('\n\n'));
  await emptyPage.locator('.goal-constraints .constraints-more').waitFor();
  assert.ok(await emptyPage.locator('.constraints-chips [data-constraint-index]').count() < constraints.length);
  await emptyPage.screenshot({path:path.join(results,'goal-constraints-chips-zh.png')});
  await emptyPage.locator('.goal-constraints .constraints-more').click();
  await emptyPage.getByRole('menuitem').first().press('End');
  await emptyPage.waitForFunction(text => document.activeElement?.textContent === text, constraints.at(-1));
  await emptyPage.keyboard.press('Enter');
  await emptyPage.locator('.constraints-dialog').getByText(constraints.at(-1),{exact:true}).waitFor();
  await emptyPage.locator('.constraints-dialog').press('Tab');
  assert.ok(await emptyPage.locator('.constraints-dialog').evaluate(node=>node.contains(document.activeElement)));
  await emptyPage.keyboard.press('Escape');
  await emptyPage.locator('.constraints-dialog').waitFor({state:'detached'});
  await emptyPage.waitForFunction(() => document.querySelector('.goal-constraints .constraints-more') === document.activeElement);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(980,620));
  await emptyPage.waitForFunction(() => { const row=document.querySelector('.goal-constraints'); return row.scrollWidth<=row.clientWidth; });
  for(const language of ['en','zh-Hant','ja','ko','fr','de','es','pt-BR','zh-Hans']) {
    await emptyPage.evaluate(language=>window.polaris.setLanguage(language),language);
    await emptyPage.waitForFunction(language=>document.documentElement.lang===language,language);
    assert.ok(await emptyPage.locator('.goal-constraints .constraints-more').getAttribute('aria-label'));
    await emptyPage.waitForFunction(() => { const row=document.querySelector('.goal-constraints'); return row.scrollWidth<=row.clientWidth; });
  }
  await emptyPage.locator('.constraints-chips .constraint-chip').first().click();
  updateConstraints(constraints[0]+'（更新）\n\n'+constraints.slice(1).join('\n\n'));
  await emptyPage.locator('.constraints-dialog').getByText(constraints[0]+'（更新）',{exact:true}).waitFor();
  await emptyPage.keyboard.press('Escape');
  updateConstraints('');await emptyPage.locator('.goal-constraints').waitFor({state:'detached'});

  console.log('PASS Electron UI: lanes, agent composer, Markdown, mouse/keyboard, custom decisions, immutable confirmed cards, removed Grok controls, workspace refresh/conflict, window lifecycle, many-goal results, overflow clearance and Chinese empty install.');
} catch (error) {
  if (app) {
    const page = await app.firstWindow().catch(() => null);
    if (page) {
      await page.screenshot({ path: path.join(results, 'failure.png') }).catch(() => {});
      console.error('UI state:', (await page.locator('body').innerText().catch(() => '')).slice(-7000));
    }
  }
  throw error;
} finally {
  await app?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
