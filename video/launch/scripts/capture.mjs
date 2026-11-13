import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../../../desktop/dist-service/store.js';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(project, '../..');
const require = createRequire(path.join(root, 'desktop/package.json'));
const { _electron: electron } = require('playwright');
const appPath = path.join(root, 'macos/build/Polaris.app/Contents/MacOS/Polaris');
const out = path.resolve(process.env.POLARIS_CAPTURE_OUTPUT ?? path.join(project, 'public/capture'));
const scratch = path.join(project, '.capture');
await mkdir(scratch, { recursive: true });
await mkdir(out, { recursive: true });
const directory = await mkdtemp(path.join(scratch, 'electron-'));
const database = path.join(directory, 'polaris.sqlite');
const records = JSON.parse(await readFile(path.join(project, 'assets/parallel-demo.json'), 'utf8'));

function write(record) {
  const store = new PolarisStore(database, false);
  try { store.mutate(record.kind, record.action, undefined, record.input); }
  finally { store.close(); }
}
for (const record of records.filter(record => record.kind !== 'decision')) write(record);
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_VISIBLE: '0',
  POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ 'chatgpt-codex': null, 'claude-code': null, 'gemini-cli': null }) };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: appPath,
    args: ['--database', database, '--language', 'en', '-PolarisWindowSize', '1320x820', '--force-device-scale-factor=3'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false);
  await page.locator('.goal-list .goal-symbol').first().waitFor();
  async function save(name) {
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`Captured ${name}`);
  }
  await save('empty');
  const decisions = records.filter(record => record.kind === 'decision');
  decisions.forEach(write);
  await page.waitForFunction(count => document.querySelectorAll('.decision-card').length === count, decisions.length);
  await save('board');
  const layout = await page.locator('[data-decision-id]').evaluateAll(nodes => Object.fromEntries(nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return [node.dataset.decisionId, { x: rect.x, y: rect.y, w: rect.width, h: rect.height }];
  })));
  await writeFile(path.join(out, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
  for (const [id, stage] of [['audience', 'first'], ['angle', 'second']]) {
    await page.locator(`[data-decision-id="${id}"]`).click();
    await page.waitForSelector('.option');
    await save(`${stage}-open`);
    await page.locator('.option').first().click();
    await save(`${stage}-selected`);
    await page.locator('.confirm').click();
    await page.waitForSelector('.modal-layer', { state: 'detached' });
    await save(`after-${stage}`);
  }
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
