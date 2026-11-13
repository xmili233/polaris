import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import executable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { languages, translator } from '@polaris/i18n';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-language-ui-'));
const database = path.join(directory, 'test.sqlite'), profile = path.join(directory, 'profile');
const store = new PolarisStore(database); seedDemo(store); store.close();
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_CODEX: path.join(root, 'tests/fixtures/native-agent.mjs') };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch(language) {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--user-data-dir', profile, '--database', database, ...(language ? ['--language', language] : [])], env });
  const page = await app.firstWindow();
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false);
  return page;
}
const config = page => page.evaluate(() => window.polaris.config());
async function openSettings(page) { await page.evaluate(() => window.dispatchEvent(new CustomEvent('polaris:settings', { detail: 'general' }))); await page.locator('.language-setting').waitFor(); }
async function select(page, name) {
  await page.locator('.language-setting button').click();
  await page.locator('.language-search input').fill(name);
  await page.getByRole('option', { name, exact: true }).click();
  await page.locator('.language-popover').waitFor({ state: 'detached' });
}
try {
  let page = await launch('en');
  const before = await page.evaluate(async () => (await window.polaris.call('snapshot')).result.board);
  await page.locator('.main-agent-entry').click();
  await page.locator('.agent-input textarea').fill('Keep my draft 原文');
  await openSettings(page);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  for (const item of languages) {
    await select(page, item.name);
    assert.equal((await config(page)).language, item.code);
    assert.equal(await page.locator('html').getAttribute('lang'), item.code);
    assert.equal(await page.locator('.settings-page h2').innerText(), translator(item.code)('settings.general'));
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[3].label);
    assert.equal(menu, translator(item.code)('menu.view'));
    assert.equal(await page.locator('.agent-input textarea').inputValue(), 'Keep my draft 原文');
  }
  const after = await page.evaluate(async () => (await window.polaris.call('snapshot')).result.board);
  assert.deepEqual(after, before);
  // Invalid and failed saves leave the effective language unchanged.
  assert.equal(await page.evaluate(() => window.polaris.setLanguage('../../bad').then(() => false, () => true)), true);
  const preferenceFile = path.join(profile, 'preferences.json');
  await rename(preferenceFile, `${preferenceFile}.backup`); await mkdir(preferenceFile);
  await page.locator('.language-setting button').click(); await page.locator('.language-search input').fill('Deutsch');
  await page.getByRole('option', { name: 'Deutsch', exact: true }).click();
  await page.locator('.settings-error').waitFor(); assert.equal((await config(page)).language, 'pt-BR');
  await rm(preferenceFile, { recursive: true }); await rename(`${preferenceFile}.backup`, preferenceFile);
  await page.locator('.language-search input').press('Escape');
  assert.equal(await page.locator('.settings').count(), 1);
  await select(page, '简体中文');
  await page.locator('.language-setting button').click();
  await page.locator('.language-search input').fill('法语');
  assert.equal(await page.getByRole('option').count(), 1);
  await page.locator('.language-search input').press('Enter');
  await page.waitForFunction(() => document.documentElement.lang === 'fr');
  await page.locator('.language-setting button').click(); await page.locator('.language-search input').fill('zzzz');
  assert.equal(await page.getByRole('option').count(), 0); await page.locator('.language-empty').waitFor();
  await page.locator('.language-search input').press('Escape');
  const results = path.join(root, 'test-results'); await mkdir(results, { recursive: true });
  await select(page, 'English'); await page.locator('.language-setting button').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.language-popover')).opacity === '1');
  await page.screenshot({ path: path.join(results, 'language-settings-en.png') });
  await page.locator('.language-search input').press('Escape'); await select(page, '简体中文');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 620));
  await page.locator('.language-setting button').click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.language-popover')).opacity === '1');
  await page.screenshot({ path: path.join(results, 'language-settings-zh.png') });
  const bounds = await page.locator('.language-popover').boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 620);
  await page.locator('.language-search input').press('Escape');
  await select(page, '日本語');
  assert.equal(errors.length, 0, errors.join('\n'));
  await app.evaluate(({ BrowserWindow }) => new Promise(resolve => {
    const window = BrowserWindow.getAllWindows()[0]; window.once('closed', resolve); window.close();
  }));
  const reopened = app.waitForEvent('window');
  await app.evaluate(({ Menu }, label) => {
    Menu.getApplicationMenu().items[0].submenu.items.find(item => item.label === label).click();
  }, translator('ja')('settings.title') + '…');
  page = await reopened;
  await page.locator('.language-setting').waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false);
  assert.equal((await config(page)).languagePreference, 'ja');
  await app.close(); app = undefined;
  page = await launch(); assert.equal((await config(page)).languagePreference, 'ja');
  await openSettings(page); await page.locator('.language-setting button').click();
  await page.getByRole('option', { name: translator('ja')('settings.autoDetect'), exact: true }).click();
  assert.equal((await config(page)).languagePreference, 'auto');
  assert.equal(JSON.parse(await readFile(preferenceFile, 'utf8')).language, 'auto');
  console.log('PASS hidden Electron: 9 languages, search, keyboard, menu refresh, preserved draft/data, failed save recovery, restart and auto detect');
} finally { await app?.close(); await rm(directory, { recursive: true, force: true }); }
