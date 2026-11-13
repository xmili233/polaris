import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-goal-icons-ui-')), database = path.join(directory, 'db.sqlite');
const store = new PolarisStore(database);
const make = (title, symbol) => store.mutate('goal', 'create', undefined, { requestID: randomUUID(), title, milestone: '验证离线目标图标', symbol });
const furniture = make('家具业务', 'Armchair'), fallback = make('旧记录兜底', 'Target');
make('研究探索', 'FlaskConical');
store.query("UPDATE goal SET payload=json_set(payload,'$.symbol','🪑') WHERE id=?", furniture.id);
store.query("UPDATE goal SET payload=json_set(payload,'$.symbol','unknown-old-icon') WHERE id=?", fallback.id);
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: '{}', POLARIS_TEST_NATIVE_CODEX: path.join(root, 'tests/fixtures/native-agent.mjs') }; delete env.ELECTRON_RUN_AS_NODE;
const output = path.join(root, 'test-results'); await mkdir(output, { recursive: true });
let app;
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? electronExecutable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env });
  const page = await app.firstWindow(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.app[data-ready="true"]').catch(async error => { console.error(await page.locator('body').innerText(), errors); throw error; });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => (process.env.POLARIS_TEST_VISIBLE !== '1' && window.isVisible()) || window.isFocused() || window.isFocusable())), false);
  await page.context().setOffline(true);
  for (const [title, name] of [['家具业务', 'Armchair'], ['旧记录兜底', 'Target'], ['研究探索', 'FlaskConical']]) {
    const button = page.getByRole('button', { name: title, exact: true });
    await button.click();
    const icon = button.locator('svg.goal-symbol');
    assert.equal(await icon.getAttribute('data-icon'), name);
    assert.ok(await icon.evaluate(node => node.getBBox().width > 0 && node.getBBox().height > 0));
    const colors = await icon.evaluate(node => ({ stroke: getComputedStyle(node).stroke, foreground: getComputedStyle(node.parentElement).color, background: getComputedStyle(node.parentElement).backgroundColor }));
    assert.equal(colors.stroke, colors.foreground); assert.notEqual(colors.stroke, colors.background);
  }
  await page.getByRole('button', { name: '家具业务', exact: true }).click();
  assert.equal(await page.locator('.goal-button .symbol').count(), 0);
  assert.equal(store.query("SELECT json_extract(payload,'$.symbol') AS symbol FROM goal WHERE id=?", furniture.id)[0].symbol, '🪑');
  await page.screenshot({ path: path.join(output, 'goal-icons-lucide.png'), animations: 'disabled' });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
  await page.screenshot({ path: path.join(output, 'goal-icons-lucide-compact.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
  console.log('PASS hidden offline goal icons: legacy chair, unknown fallback, built-in icon, selected contrast, unchanged stored data');
} finally { await app?.close(); store.close(); await rm(directory, { recursive: true, force: true }); }
