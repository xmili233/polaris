// Captures the open-source launch film's UI states from the built Polaris app.
// The app runs hidden and non-focusable (POLARIS_TEST=1) against an isolated
// database seeded with the fictional content in assets/launch-demo.json.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { PolarisStore } from '../../../desktop/dist-service/store.js';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(project, '../..');
const require = createRequire(path.join(root, 'desktop/package.json'));
const { _electron: electron } = require('playwright');
const appPath = process.env.POLARIS_APP ?? path.join(root, 'macos/build/Polaris.app/Contents/MacOS/Polaris');
// Usage: node scripts/capture-launch.mjs [en|zh-Hans]
const LOCALE = process.argv[2] ?? 'en';
const TEXT = { en: { preparing: 'Preparing decision cards', decide: /^Decide/ }, 'zh-Hans': { preparing: '正在准备决策卡片', decide: /^确定/ } }[LOCALE];
if (!TEXT) throw new Error(`Unsupported locale ${LOCALE}`);
const out = path.join(project, 'public/v3', LOCALE);
const WINDOW = { width: 1536, height: 864 }, SCALE = 2.5;
const demo = JSON.parse(await readFile(path.join(project, `assets/launch-demo.${LOCALE}.json`), 'utf8'));
await mkdir(path.join(project, '.capture'), { recursive: true });
await mkdir(out, { recursive: true });
const directory = await mkdtemp(path.join(project, '.capture/launch-'));
const database = path.join(directory, 'polaris.sqlite');

function withStore(action) {
  const store = new PolarisStore(database);
  try { return action(store); } finally { store.close(); }
}
const request = (kind, id) => `launch-v3-${kind}-${id}`;
const prepared = (store, strategyID) => store.query("INSERT INTO metadata(key,value) VALUES(?,'prepared') ON CONFLICT(key) DO UPDATE SET value='prepared'", `strategy_auto_advance:${strategyID}`);
const strategy = (store, goalID, item) => {
  store.mutate('strategy', 'create', undefined, { requestID: request('strategy', item.id), id: item.id, goalID, title: item.title, body: item.body, origin: 'Fictional launch demo' });
  prepared(store, item.id);
};
// Minutes since each card arrived, oldest first within a strategy so the lane order is unchanged.
const AGES = { audience: 48, problem: 35, invitation: 21, feedback: 9, angle: 44, demo: 31, teaser: 17, followup: 5, promise: 52, access: 39, onboarding: 26, intent: 12,
  'speaking-format': 130, topics: 70, 'tutor-pick': 55, commute: 40, plan: 190, longrun: 125, routine: 90, register: 50, shoes: 25, 'communities-suggestion': 1 };
const decision = (store, strategyID, item) => store.transaction(() => {
  const value = store.mutate('decision', 'submit', undefined, {
    requestID: request('decision', item.id), id: item.id, strategyID, title: item.title, body: item.body, options: item.options,
    ...(item.recommendedOptionID ? { recommendedOptionID: item.recommendedOptionID } : {}) });
  if (AGES[item.id]) {
    const at = new Date(Date.now() - AGES[item.id] * 60_000).toISOString();
    store.query("UPDATE decision SET payload=json_set(payload,'$.createdAt',?,'$.updatedAt',?) WHERE id=?", at, at, item.id);
  }
  return value;
});
// Background work shown in the Agent rail. Rows are written after launch,
// because startup recovery marks inherited running jobs as interrupted.
function running(strategyID, title, origin = 'system') {
  return withStore(store => store.transaction(() => {
    const workID = randomUUID(), jobID = randomUUID(), session = `launch-session-${strategyID}`, at = new Date().toISOString();
    store.query('INSERT INTO agent_work(id,strategyID,title,instructions,state,provider,sessionKey) VALUES(?,?,?,?,?,?,?)', workID, strategyID, title, 'Fictional launch demo work.', 'running', 'claude-code', session);
    store.query("INSERT INTO agent_job(id,kind,input,workID,state,createdAt,acceptedAt,startedAt,title,provider,sessionKey,origin,delivery) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'accepted')",
      jobID, 'work', 'Fictional launch demo work.', workID, 'running', at, at, at, title, 'claude-code', session, origin);
    return jobID;
  }));
}
const finish = jobID => withStore(store => store.query("UPDATE agent_job SET state='completed',completedAt=? WHERE id=?", new Date().toISOString(), jobID));

withStore(store => {
  for (const goal of demo.goals) {
    store.mutate('goal', 'create', undefined, { requestID: request('goal', goal.id), id: goal.id, title: goal.title, milestone: goal.milestone, symbol: goal.symbol, constraints: goal.constraints });
    for (const item of goal.strategies) strategy(store, goal.id, item);
  }
});

const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_VISIBLE: '0',
  POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ 'chatgpt-codex': null, 'claude-code': null, 'gemini-cli': null }) };
delete env.ELECTRON_RUN_AS_NODE;
const layout = { window: WINDOW, scale: SCALE, states: {} };
let app;
try {
  app = await electron.launch({ executablePath: appPath,
    args: ['--database', database, '--language', LOCALE, '-PolarisWindowSize', `${WINDOW.width}x${WINDOW.height}`, `--force-device-scale-factor=${SCALE}`], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false);
  // Progress rings are redrawn and animated by the film, so captures keep the avatars without them.
  await page.addStyleTag({ content: '.work-ring { visibility: hidden !important; }' });
  const settled = () => page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity));
  const rects = selector => page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const r = node.getBoundingClientRect();
    return { id: node.dataset.decisionId ?? node.getAttribute('aria-label') ?? node.getAttribute('title') ?? '', x: r.x, y: r.y, w: r.width, h: r.height };
  }));
  // Builds made before the board.or catalog key render a literal "or" in the decision dialog; show the localized source text.
  const divider = JSON.parse(await readFile(path.join(root, `packages/i18n/locales/${LOCALE}.json`), 'utf8'))['board.or'];
  async function save(name) {
    await page.evaluate(word => { for (const node of document.querySelectorAll('.alternative')) for (const child of node.childNodes) if (child.nodeType === 3 && child.textContent.trim() === 'or') child.textContent = word; }, divider);
    await settled();
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    layout.states[name] = { cards: await rects('[data-decision-id]'), lanes: await rects('.lane'), goals: await rects('.goal-list .goal-button, nav .goal-button:not(.library-button)'),
      header: (await rects('.board-header'))[0] ?? null, modal: (await rects('.modal-content'))[0] ?? null, options: await rects('.modal-content .option'),
      confirm: (await rects('.modal-content button.confirm, .modal-content button[type="submit"]'))[0] ?? null, rail: (await rects('.work-rail'))[0] ?? null,
      agents: await page.locator('.work-rail .work-item:not(.leaving)').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect();
        return { id: node.dataset.workSession ?? '', running: node.classList.contains('running'), x: r.x, y: r.y, w: r.width, h: r.height };
      })) };
    console.log(`Captured ${name}`);
  }
  const selectGoal = async id => {
    const title = demo.goals.find(goal => goal.id === id).title;
    await page.locator(`.goal-button[title="${title}"]`).click();
    await page.locator('.board-header h1', { hasText: title }).waitFor();
  };
  const cardCount = count => page.waitForFunction(n => document.querySelectorAll('.decision-card').length === n, count);

  const [customers, japanese, marathon] = demo.goals;
  await selectGoal(customers.id);
  running('conversations', 'Shortlist interview candidates');
  running('public', 'Draft the launch teaser');
  running('offer', 'Compare early-access offers');
  running('speaking', 'Find a shadowing podcast');
  running('mileage', 'Compare beginner training plans');
  const runningAgents = count => page.waitForFunction(n => document.querySelectorAll('.work-rail .work-item.running:not(.leaving)').length === n, count, { timeout: 15_000 });
  await runningAgents(5);
  await save('customers-empty');
  layout.laneSurface = await page.locator('.lane').first().evaluate(node => getComputedStyle(node).backgroundColor);

  withStore(store => { for (const goal of demo.goals) for (const item of goal.strategies) for (const card of item.decisions) decision(store, item.id, card); });
  await cardCount(12);
  await save('customers-board');
  await selectGoal(japanese.id); await cardCount(4); await save('japanese-board');
  await selectGoal(marathon.id); await cardCount(5); await save('marathon-board');
  await selectGoal(customers.id); await cardCount(12);

  const modal = page.locator('.modal-content');
  async function decide(id, prefix) {
    await page.locator(`[data-decision-id="${id}"]`).click();
    await modal.locator('.option').first().waitFor();
    await save(`${prefix}-open`);
    await modal.locator('.option').first().click();
    await save(`${prefix}-selected`);
    await modal.getByRole('button', { name: TEXT.decide }).click();
    await page.waitForFunction(() => !document.querySelector('.modal-content'));
  }
  await decide('audience', 'audience');
  await save('customers-after-audience');

  withStore(store => decision(store, demo.suggestion.strategyID, demo.suggestion));
  await page.locator(`[data-decision-id="${demo.suggestion.id}"]`).waitFor();
  await save('customers-suggestion');
  await decide(demo.suggestion.id, 'suggestion');

  const added = demo.newStrategy;
  withStore(store => strategy(store, added.goalID, added));
  const preparing = running(added.id, `Prepare decisions: ${added.title}`, 'auto_advance');
  await page.locator('.lane', { hasText: added.title }).getByText(TEXT.preparing, { exact: true }).waitFor();
  await runningAgents(6);
  await save('customers-preparing');
  withStore(store => { for (const card of added.decisions) decision(store, added.id, card); });
  finish(preparing);
  await page.locator('.lane', { hasText: added.title }).locator('.decision-card').nth(added.decisions.length - 1).waitFor();
  await runningAgents(5);
  await save('customers-communities');
  await writeFile(path.join(out, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
