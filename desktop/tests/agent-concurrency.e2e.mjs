import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';
import { catalogs } from '../../packages/i18n/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-concurrency-ui-'));
const database = path.join(directory, 'db.sqlite'), store = new PolarisStore(database);
seedDemo(store);
const executable = path.join(directory, 'native-agent.mjs'), output = path.join(root, 'test-results');
await mkdir(output, { recursive: true });
await copyFile(path.join(root, 'tests/fixtures/native-agent.mjs'), executable);
await chmod(executable, 0o755);
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ 'chatgpt-codex': executable }) };
delete env.ELECTRON_RUN_AS_NODE;
const wait = async predicate => {
  const end = Date.now() + 20_000;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.fail('Timed out waiting for concurrency state');
};
let app;
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? electronExecutable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env });
  const page = await app.firstWindow(), errors = [];
  page.setDefaultTimeout(20_000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocusable() || window.isFocused() || (process.env.POLARIS_TEST_VISIBLE !== '1' && window.isVisible()))), false);
  const call = async (method, params) => {
    const response = await page.evaluate(({ method, params }) => window.polaris.call(method, params), { method, params });
    assert.equal(response.error, undefined, JSON.stringify(response.error)); return response.result;
  };
  await call('agentNative', { action: 'connect', provider: 'chatgpt-codex' });
  const setup = await call('agentSend', { text: 'concurrency-fixture' });
  await wait(() => store.query('SELECT state FROM agent_job WHERE id=?', setup)[0]?.state === 'completed');
  await wait(() => store.query("SELECT count(*) AS n FROM agent_job WHERE kind='work' AND state='running' AND delivery='accepted'")[0].n === 5);
  const queued = store.query("SELECT * FROM agent_job WHERE kind='work' AND state='queued'");
  assert.equal(queued.length, 1);
  const job = queued[0], main = await call('agentSend', { text: 'hold-fixture main remains available' });
  await wait(() => store.query('SELECT delivery FROM agent_job WHERE id=?', main)[0]?.delivery === 'accepted');
  assert.equal(store.query("SELECT count(*) AS n FROM agent_job WHERE state='running'")[0].n, 6);
  await page.locator(`[data-work-id="${job.workID}"]`).click();
  const queuedFace = page.locator(`[data-work-id="${job.workID}"] .work-face`);
  await queuedFace.locator(':scope > svg').waitFor();
  const avatarID = await queuedFace.getAttribute('data-avatar-id');
  const message = page.locator(`.child-chat [data-job-id="${job.id}"]`), status = message.locator('.agent-awaiting');
  for (const language of ['zh-Hans', 'en', 'zh-Hant', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR']) {
    await page.evaluate(language => window.polaris.setLanguage(language), language);
    const expected = catalogs[language]['agent.backgroundQueued'].replace('{{limit}}', '5');
    await wait(async () => await status.textContent() === expected);
    assert.equal(await message.locator('.agent-live-label').count(), 0, 'Queued messages must not animate Thinking');
    assert.ok(await status.evaluate(node => node.scrollWidth <= node.clientWidth), `${language}: queue text overflows`);
  }
  await page.evaluate(() => window.polaris.setLanguage('zh-Hans'));
  await wait(async () => (await status.textContent()).includes('当前排队中'));
  await page.screenshot({ path: path.join(output, 'agent-queued-five-zh.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
  await page.screenshot({ path: path.join(output, 'agent-queued-five-compact.png') });
  assert.ok(await status.evaluate(node => node.scrollWidth <= node.clientWidth));
  const running = store.query("SELECT id,workID FROM agent_job WHERE kind='work' AND state='running' ORDER BY seq")[0];
  await call('agentWorkStop', { workID: running.workID, id: running.id });
  await wait(() => store.query('SELECT delivery FROM agent_job WHERE id=?', job.id)[0]?.delivery === 'accepted');
  await wait(async () => await status.textContent() === 'Thinking');
  await queuedFace.locator('[data-avatar-scene]').waitFor();
  assert.equal(await queuedFace.getAttribute('data-avatar-id'), avatarID, 'Starting a queued task must not change its avatar.');
  assert.equal(store.query("SELECT count(*) AS n FROM agent_job WHERE kind='work' AND state='running'")[0].n, 5);
  assert.equal(store.query('SELECT state FROM agent_job WHERE id=?', main)[0].state, 'running');
  assert.deepEqual(errors, []);
  console.log('PASS hidden concurrency UI: 5 background + 1 main, sixth queued, 9 locales, no Thinking while queued, automatic dispatch after cancellation');
} finally {
  await app?.close(); store.close(); await rm(directory, { recursive: true, force: true });
}
