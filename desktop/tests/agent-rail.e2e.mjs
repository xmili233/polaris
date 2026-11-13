import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'polaris-agent-rail-'));
const database = path.join(dir, 'test.sqlite');
const store = new PolarisStore(database); seedDemo(store); store.close();
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_CODEX: path.join(root, 'tests/fixtures/native-agent.mjs') };
delete env.ELECTRON_RUN_AS_NODE;
delete env.POLARIS_TEST_VISIBLE;
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
let app;
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? electronExecutable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.app[data-ready="true"]').waitFor();
  assert.ok(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().every(w => !w.isVisible() && !w.isFocusable() && !w.isFocused())));
  const call = (method, params) => page.evaluate(async ({method,params}) => {
    const value = await window.polaris.call(method,params);
    if (value.error) throw new Error(value.error.code);
    return value.result;
  }, {method,params});
  const rail = page.locator('.work-rail'), main = rail.getByRole('button', { name: '主 Agent', exact: true });
  const dialog = page.locator('.work-chat-dialog'), input = page.locator('.main-agent textarea'), board = page.locator('.board-pane');
  await main.waitFor();
  assert.equal(await rail.getByRole('button').count(), 1, 'Main Agent stays available with no tasks');
  assert.equal(await rail.locator('.work-divider').count(), 0);
  assert.equal(await dialog.count(), 0);
  assert.equal(await main.getAttribute('aria-expanded'), 'false');
  const boardWidth = (await board.boundingBox()).width;
  await main.press('Enter');
  await dialog.getByRole('heading', {name:'主 Agent', exact:true}).waitFor();
  const avatar = await main.locator('.work-face').getAttribute('data-avatar-id');
  assert.match(avatar,/^polaris-/);
  assert.equal(await dialog.locator('.agent-header .work-face').getAttribute('data-avatar-id'),avatar);
  assert.equal((await board.boundingBox()).width, boardWidth, 'Opening chat does not resize the board');
  assert.equal(await board.evaluate(n => n.inert), true);
  assert.equal(await input.evaluate(n => n === document.activeElement), true);
  await input.fill('保留这段草稿');
  await input.press('Escape');
  await dialog.waitFor({state:'detached'});
  assert.equal(await board.evaluate(n => n.inert), false);
  await page.waitForFunction(() => document.activeElement?.classList.contains('main-agent-entry'));

  await call('agentNative', { action:'connect', provider:'chatgpt-codex' });
  await call('agentSend', { text:'question-fixture' });
  await main.locator('.agent-unread[aria-label="有新回复"]').waitFor();
  await main.click();
  await dialog.getByText('Which route?',{exact:true}).waitFor();
  assert.equal(await input.inputValue(), '保留这段草稿');
  assert.equal(await main.locator('.agent-unread').count(), 0);
  await dialog.getByRole('button',{name:'关闭',exact:true}).click();
  await dialog.waitFor({state:'detached'});

  await call('agentSend',{text:'work-rail-fixture'});
  await rail.locator('.work-item.result').nth(1).waitFor();
  assert.equal(await rail.locator('.work-items > :first-child').getAttribute('aria-label'), '主 Agent');
  assert.equal(await rail.locator('.main-agent-entry + .main-agent-divider').count(), 1);
  await main.blur();
  await page.mouse.move(300, 100);
  await page.locator('.board').evaluate(n => Promise.all(n.getAnimations().map(a=>a.finished)));
  await page.screenshot({path:path.join(results,'agent-rail-zh.png')});
  await main.press('ArrowDown');
  assert.equal(await rail.locator('.work-item.result').first().evaluate(n => n === document.activeElement), true);
  await rail.locator('.work-item.result').first().press('Enter');
  await dialog.locator('.child-chat').waitFor();
  assert.equal(await dialog.locator('.child-chat textarea').count(), 0);
  assert.equal(await input.isVisible(), false);
  await main.click();
  await input.waitFor();
  assert.equal(await input.inputValue(), '保留这段草稿');

  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].setContentSize(980,620));
  await page.waitForFunction(() => innerWidth === 980);
  const railBounds = await rail.boundingBox(), chatBounds = await dialog.boundingBox();
  assert.ok(chatBounds.x >= 0 && chatBounds.x + chatBounds.width <= railBounds.x && chatBounds.y + chatBounds.height <= 620);
  await dialog.evaluate(n => Promise.all(n.getAnimations().map(a=>a.finished)));
  await page.screenshot({path:path.join(results,'agent-rail-chat-zh.png')});
  for (const language of ['en','zh-Hant','ja','ko','fr','de','es','pt-BR']) {
    await page.evaluate(l => window.polaris.setLanguage(l), language);
    await page.waitForFunction(l => document.documentElement.lang === l, language);
    assert.ok(await dialog.evaluate(n => n.scrollWidth <= n.clientWidth));
  }
  await input.press('Escape');
  await dialog.waitFor({state:'detached'});
  await page.reload();
  await page.locator('.main-agent-entry').waitFor();
  assert.equal(await dialog.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS hidden Agent rail: board default, main entry and divider, dialog focus, unread reply and draft, task switching, compact size and nine locales.');
} finally {
  await app?.close();
  await rm(dir,{recursive:true,force:true});
}
