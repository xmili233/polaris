import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import executable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';
import { translator } from '@polaris/i18n';

// Appearance runs in a hidden, non-focusable window with an isolated profile and database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-appearance-ui-'));
const database = path.join(directory, 'test.sqlite'), profile = path.join(directory, 'profile');
const preferences = path.join(profile, 'preferences.json'), results = path.join(root, 'test-results');
const store = new PolarisStore(database); seedDemo(store); store.close();
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_CODEX: path.join(root, 'tests/fixtures/native-agent.mjs') };
delete env.ELECTRON_RUN_AS_NODE;
const t = translator('en');
let app;
async function launch() {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--user-data-dir', profile, '--database', database, '--language', 'en'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false);
  return page;
}
const native = () => app.evaluate(({ nativeTheme, BrowserWindow }) => ({
  source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors, background: BrowserWindow.getAllWindows()[0].getBackgroundColor(),
}));
const pageColors = page => page.evaluate(() => ({
  dark: document.documentElement.classList.contains('theme-dark'),
  page: getComputedStyle(document.body).backgroundColor,
  scheme: getComputedStyle(document.documentElement).colorScheme,
}));
async function openSettings(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('polaris:settings', { detail: 'general' })));
  await page.locator('.appearance-setting').waitFor();
}
async function choose(page, key, dark) {
  await page.locator('.appearance-setting label').filter({ hasText: t(key) }).click();
  await page.waitForFunction(value => document.documentElement.classList.contains('theme-dark') === value, dark);
}
try {
  await mkdir(results, { recursive: true });
  let page = await launch();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Tests start light, whatever the Mac's own appearance is.
  assert.equal((await page.evaluate(() => window.polaris.config())).appearance, 'light');
  assert.deepEqual(await pageColors(page), { dark: false, page: 'rgb(255, 255, 255)', scheme: 'light' });

  // Save a language first: choosing an appearance must keep it.
  await page.evaluate(() => window.polaris.setLanguage('en'));
  await openSettings(page);
  assert.equal(await page.locator('.appearance-setting').getByRole('radio', { checked: true }).getAttribute('value'), 'light');
  await choose(page, 'settings.appearanceDark', true);
  assert.deepEqual(await pageColors(page), { dark: true, page: 'rgb(15, 16, 18)', scheme: 'dark' });
  assert.deepEqual(await native(), { source: 'dark', dark: true, background: '#0F1012' });
  assert.deepEqual(JSON.parse(await readFile(preferences, 'utf8')), { language: 'en', appearance: 'dark' });
  await page.locator('.appearance-setting input[value="dark"]:checked').waitFor();
  await page.waitForTimeout(400); // let button color transitions finish before the review screenshot
  await page.screenshot({ path: path.join(results, 'appearance-settings-dark.png') });

  // Invalid input is rejected without replacing the saved choice.
  assert.equal(await page.evaluate(() => window.polaris.setAppearance('neon').then(() => false, () => true)), true);
  assert.equal(JSON.parse(await readFile(preferences, 'utf8')).appearance, 'dark');

  await page.keyboard.press('Escape');
  await page.locator('.settings').waitFor({ state: 'detached' });
  await page.screenshot({ path: path.join(results, 'appearance-board-dark.png') });
  await page.locator('.decision-card').first().click();
  await page.locator('.modal-content').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(results, 'appearance-decision-dark.png') });
  await page.keyboard.press('Escape');
  await page.locator('.modal-content').waitFor({ state: 'detached' });
  await page.locator('.main-agent-entry').click();
  await page.locator('.agent-input textarea').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(results, 'appearance-chat-dark.png') });

  // The choice survives a restart.
  await app.close();
  page = await launch();
  assert.equal((await page.evaluate(() => window.polaris.config())).appearance, 'dark');
  assert.equal((await pageColors(page)).dark, true);

  // System hands control back to macOS; Light restores the light tokens.
  await openSettings(page);
  await page.locator('.appearance-setting label').filter({ hasText: t('settings.appearanceSystem') }).click();
  await page.waitForFunction(() => document.querySelector('.appearance-setting input[value="system"]').checked);
  assert.equal((await native()).source, 'system');
  assert.equal((await pageColors(page)).dark, (await native()).dark);
  await choose(page, 'settings.appearanceLight', false);
  assert.deepEqual(await pageColors(page), { dark: false, page: 'rgb(255, 255, 255)', scheme: 'light' });
  assert.deepEqual(await native(), { source: 'light', dark: false, background: '#FFFFFF' });
  assert.deepEqual(errors, []);
  console.log('PASS hidden appearance: light by default in tests, dark tokens and window colors, saved with the language, invalid input rejected, restart, system and light');
} finally {
  await app?.close().catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
