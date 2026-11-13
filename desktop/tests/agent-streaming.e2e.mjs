import { _electron as electron } from 'playwright';
import executable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-streaming-ui-'));
const database = path.join(directory, 'polaris.sqlite');
const store = new PolarisStore(database), data = new AgentStore(store);
const id = data.send('Streaming cadence fixture');
const prefix = '## Streaming\n\n' + 'A stable paragraph with **bold text**, `code`, and a short sentence.\n\n'.repeat(48);
store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey='fixture-main' WHERE id=?", id);
data.setJob(id, 'completed'); data.message(id, prefix, 'completed', [{ type: 'text', text: prefix }]);
const env = { ...process.env, POLARIS_TEST: '1' }; env.POLARIS_TEST_NATIVE_CODEX = path.join(root, 'tests/fixtures/native-agent.mjs');
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFocusable() || w.isFocused())), false);
  await page.locator('.agent.full textarea').waitFor();
  await page.waitForFunction(() => document.querySelector('.agent-answer')?.textContent.includes('A stable paragraph'));
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const taskDuration = async () => (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'TaskDuration').value;
  const before = await taskDuration();
  await page.evaluate(() => {
    const target = document.querySelector('.agent-answer');
    window.streamMetrics = { start: performance.now(), updates: [], lengths: [] };
    let previous = target.textContent;
    window.streamObserver = new MutationObserver(() => {
      const next = target.textContent;
      if (next !== previous) { window.streamMetrics.updates.push(performance.now()); window.streamMetrics.lengths.push(next.length); previous = next; }
    });
    window.streamObserver.observe(target, { childList: true, subtree: true, characterData: true });
  });
  let body = prefix;
  data.setJob(id, 'running');
  for (let i = 0; i < 36; i++) {
    body += `片段${i} `;
    data.message(id, body, 'running', [{ type: 'text', text: body }]);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('polaris:agent-changed'));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const endOfFeed = await page.evaluate(() => performance.now());
  store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey='fixture-main' WHERE id=?", id);
data.setJob(id, 'completed'); data.message(id, body, 'completed', [{ type: 'text', text: body }]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('polaris:agent-changed'));
  await page.waitForFunction(() => document.querySelector('.agent-answer')?.textContent.includes('片段35'));
  const metrics = await page.evaluate(end => {
    window.streamObserver.disconnect();
    return { ...window.streamMetrics, endOfFeed: end, intermediateUpdates: window.streamMetrics.updates.filter(t => t < end).length,
      firstUpdateMs: window.streamMetrics.updates[0] - window.streamMetrics.start };
  }, endOfFeed);
  metrics.taskDurationMs = ((await taskDuration()) - before) * 1000;
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await writeFile(path.join(root, 'test-results/agent-streaming-metrics.json'), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ mode: 'hidden, unfocusable; cadence and main-thread cost, not foreground FPS', ...metrics }));
  assert.ok(metrics.intermediateUpdates >= 8, `Continuous change events must render during the feed, got ${metrics.intermediateUpdates}.`);
  assert.ok(metrics.firstUpdateMs < 350, `First chunk waited ${metrics.firstUpdateMs}ms.`);
  assert.equal(await page.locator('.agent-awaiting').count(), 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  body += ' Reduced motion displays the received text immediately.';
  data.setJob(id, 'running'); data.message(id, body, 'running', [{ type: 'text', text: body, phase: 'final_answer', complete: false }]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('polaris:agent-changed'));
  await page.getByText('Reduced motion displays the received text immediately.', { exact: false }).waitFor();
  assert.equal(await page.locator('.agent-stream-word').count(), 0, 'Reduced motion bypasses word fading.');
  console.log('PASS continuous streaming stays visible during event bursts and reaches the final text.');
} finally { await app?.close().catch(() => {}); store.close(); await rm(directory, { recursive: true, force: true }); }
