import { _electron as electron } from 'playwright';
import executable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-turn-ui-'));
const database = path.join(directory, 'polaris.sqlite');
const store = new PolarisStore(database), data = new AgentStore(store);
const id = data.send('Check the workspace');
const tool = { type: 'activity', calls: [
  { id: 'read', name: 'get_context', state: 'completed', output: 'Workspace context loaded.' },
  { id: 'command', name: 'commandExecution', state: 'completed', input: '{"command":"pwd"}', output: '/workspace' },
] };
tool.calls.push(...Array.from({ length: 16 }, (_, index) => ({ id: `extra-${index}`, name: 'commandExecution', state: 'completed', input: JSON.stringify({ command: `echo tool-${index}` }), output: `tool-${index}` })));
const legacy = [tool, { type: 'text', text: 'I will inspect the files.' }, tool, { type: 'text', text: 'Everything is ready.' }];
store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey='fixture-main' WHERE id=?", id);
data.setJob(id, 'completed'); data.message(id, 'Everything is ready.', 'completed', legacy);
store.query('UPDATE agent_message SET provider=? WHERE id=?', 'chatgpt-codex', `${id}:assistant`);
const env = { ...process.env, POLARIS_TEST: '1' }; env.POLARIS_TEST_NATIVE_CODEX = path.join(root, 'tests/fixtures/native-agent.mjs');
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'en'], env });
  const page = await app.firstWindow();
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isFocusable() || w.isFocused())), false);
  await page.locator('.agent textarea').click();
  return page;
}
async function refresh() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('polaris:agent-changed')); }
try {
  const page = await launch();
  const header = page.locator('.agent-turn > summary');
  await header.waitFor();
  assert.equal(await header.innerText(), 'Activity');
  assert.equal(await header.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.getByText('I will inspect the files.', { exact: true }).isVisible(), false);
  assert.equal(await page.locator('.agent-final-answer').innerText(), 'Everything is ready.');
  await header.press('Enter');
  await page.getByText('I will inspect the files.', { exact: true }).waitFor();
  assert.equal(await page.locator('.agent-turn .agent-tool').count(), 36);
  assert.equal(await page.locator('.agent-provider-label, .agent-tool-count').count(), 0);
  const group = page.locator('.agent-tool-group').first();
  assert.equal(await group.evaluate(element => element.open), true, 'Tool groups start expanded.');
  await group.locator('.agent-tool > summary').first().waitFor();
  const list = await group.locator('.agent-tool-list').evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight, maxHeight: getComputedStyle(element).maxHeight, overflow: getComputedStyle(element).overflowY, lastBottom: element.lastElementChild.getBoundingClientRect().bottom, bottom: element.getBoundingClientRect().bottom }));
  assert.ok(list.height > 224, 'All 18 tool rows determine the list height.');
  assert.equal(list.maxHeight, 'none'); assert.equal(list.overflow, 'visible'); assert.ok(list.content <= list.height + 1); assert.ok(list.lastBottom <= list.bottom + 1);
  await group.locator(':scope > summary').click();
  tool.calls[1].output = '/workspace/refreshed'; data.message(id, 'Everything is ready.', 'completed', legacy); await refresh();
  await page.waitForFunction(() => document.querySelector('.agent-tool-group')?.textContent.includes('/workspace/refreshed'));
  assert.equal(await group.evaluate(element => element.open), false, 'New activity data preserves manual collapse.');
  await group.locator(':scope > summary').click();
  const lefts = await group.locator('.agent-tool-heading').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().left));
  assert.equal(lefts.length, 19);
  assert.ok(lefts.every(left => Math.abs(left - lefts[0]) < 1), 'Child tool rows align with the group heading.');
  assert.doesNotMatch(await group.innerText(), /\d+ tool calls/);
  await group.locator('.agent-tool > summary').first().click();
  await group.getByText('Workspace context loaded.', { exact: true }).waitFor();
  await group.locator('.agent-tool > summary').first().click();
  await group.locator('.agent-tool > summary').first().evaluate(element => element.blur());
  // Wheel events in the full-window chat gutters must reach the same native scroll container.
  const originalSize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  for (const size of [originalSize, [980, 700]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), size);
    const viewport = page.locator('.main-agent.full .agent-thread');
    const geometry = await page.evaluate(() => {
      const thread = document.querySelector('.main-agent.full .agent-thread').getBoundingClientRect();
      const input = document.querySelector('.main-agent .agent-input').getBoundingClientRect();
      const message = document.querySelector('.agent-thread > *').getBoundingClientRect();
      return { left: thread.left, right: thread.right, top: thread.top, height: thread.height,
        window: innerWidth, inputLeft: input.left, inputWidth: input.width, messageLeft: message.left, messageWidth: message.width };
    });
    assert.ok(Math.abs(geometry.left) < 1 && Math.abs(geometry.right - geometry.window) < 1, 'Full-window chat scroll area includes both gutters.');
    assert.ok(Math.abs(geometry.messageLeft - geometry.inputLeft) < 1 && Math.abs(geometry.messageWidth - geometry.inputWidth) < 1, 'Text keeps its existing composer-aligned column.');
    for (const x of [16, geometry.window - 16]) {
      await viewport.evaluate(node => { node.scrollTop = 80; });
      const before = await viewport.evaluate(node => node.scrollTop);
      const y = geometry.top + Math.min(geometry.height / 2, 200);
      assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.agent-thread'), { x, y }), true);
      await page.mouse.move(x, y); await page.mouse.wheel(0, 240);
      await page.waitForFunction(before => document.querySelector('.main-agent.full .agent-thread').scrollTop > before + 100, before);
    }
  }
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), originalSize);
  await page.locator('.agent-thread').evaluate(node => { node.scrollTop = 0; });
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await page.locator('.agent').screenshot({ path: path.join(root, 'test-results/agent-tools-flat.png') });
  await header.press('Enter');

  data.setJob(id, 'running');
  const start = Date.now() - 90_000, finalStart = new Date(start + 60_000).toISOString();
  store.query('UPDATE agent_job SET startedAt=? WHERE id=?', new Date(start).toISOString(), id);
  const process = [{ type: 'text', text: 'Checking context.', phase: 'commentary', complete: true }, tool];
  data.message(id, 'Checking context.', 'running', process); await refresh();
  await page.waitForFunction(() => document.querySelector('.agent-turn > summary')?.textContent.startsWith('Working for'));
  assert.equal(await header.getAttribute('aria-disabled'), 'true');
  await page.getByText('Checking context.', { exact: true }).waitFor();

  const answer = { type: 'text', text: 'The final result.', phase: 'final_answer', startedAt: finalStart, complete: false };
  data.message(id, answer.text, 'running', [...process, answer]); await refresh();
  await page.waitForFunction(() => document.querySelector('.agent-turn > summary')?.textContent === 'Worked for 1m 0s');
  assert.equal(await header.getAttribute('aria-expanded'), 'false');
  await page.waitForTimeout(1100);
  assert.equal(await header.innerText(), 'Worked for 1m 0s', 'Final-answer streaming must not extend work time.');
  await header.press('Enter');
  answer.text += ' More detail.';
  data.message(id, answer.text, 'running', [...process, answer]); await refresh();
  await page.getByText(answer.text, { exact: true }).waitFor();
  assert.equal(await header.getAttribute('aria-expanded'), 'true', 'Streaming must preserve manual expansion.');

  data.message(id, answer.text, 'running', [...process, answer, tool]); await refresh();
  await page.waitForFunction(() => document.querySelector('.agent-final-answer') === null);
  assert.match(await header.innerText(), /^Working for/);
  await page.getByText(answer.text, { exact: true }).waitFor();
  data.message(id, answer.text, 'running', [...process, answer, tool, { ...answer, text: 'Verified final result.' }]); await refresh();
  await page.getByText('Verified final result.', { exact: true }).waitFor();
  assert.equal(await header.getAttribute('aria-expanded'), 'true', 'Manual expansion survives a corrected final boundary.');
  await header.press('Enter');
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await header.evaluate(element => element.blur());
  await page.waitForTimeout(800);
  await page.locator('.agent').screenshot({ path: path.join(root, 'test-results/agent-turn-collapsed.png') });
  await header.focus(); await header.press('Enter'); await header.evaluate(element => element.blur()); await page.waitForTimeout(300);
  await page.locator('.agent').screenshot({ path: path.join(root, 'test-results/agent-turn-expanded.png') });

  data.setJob(id, 'cancelled'); await refresh();
  await page.waitForFunction(() => document.querySelector('.agent-turn > summary')?.textContent.startsWith('You stopped after'));
  assert.equal(await header.getAttribute('aria-disabled'), 'true');
  const stopped = await header.innerText(); await page.waitForTimeout(1100); assert.equal(await header.innerText(), stopped);
  store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey='fixture-main' WHERE id=?", id);
data.setJob(id, 'completed'); data.message(id, answer.text, 'completed', [...process, { ...answer, complete: true }]);
  await app.close(); app = undefined;
  const reopened = await launch();
  await reopened.locator('.agent-turn > summary').waitFor();
  assert.equal(await reopened.locator('.agent-turn > summary').innerText(), 'Worked for 1m 0s', 'Saved timing survives app restart.');
  assert.equal(await reopened.locator('.agent-turn > summary').getAttribute('aria-expanded'), 'false');
  console.log('PASS turn disclosure: full-window gutter scrolling at wide/narrow widths, default-expanded 18-row groups without internal scrolling, manual collapse, flat tools, no provider/count labels, tool details, legacy fallback, final boundary, frozen timing, manual state, later tools, stopping and restart. Hidden and unfocusable.');
} finally { await app?.close().catch(() => {}); store.close(); await rm(directory, { recursive: true, force: true }); }
