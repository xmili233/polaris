import { _electron as electron } from 'playwright';
import executable from 'electron';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// R-D81: the production first-run flow, in a hidden, unfocusable window with its own empty database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-onboarding-e2e-'));
const database = path.join(directory, 'polaris.sqlite');
const results = path.join(root, 'test-results');
await mkdir(results, { recursive: true });
const fixture = new URL('./fixtures/native-agent.mjs', import.meta.url).href;
const codex = path.join(directory, 'codex-fixture.mjs'), gemini = path.join(directory, 'gemini-fixture.mjs');
await writeFile(codex, `#!/usr/bin/env node\nimport ${JSON.stringify(fixture)};\n`, { mode: 0o755 });
await writeFile(codex+'.json', JSON.stringify({ signedOut: true }));
const states = () => ({ 'claude-code': null, 'chatgpt-codex': codex, 'gemini-cli': gemini });
const language = process.env.POLARIS_TEST_LANGUAGE ?? 'zh-Hans';
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: JSON.stringify(states()) };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
const launch = async () => {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? executable,
    args: [...(process.env.POLARIS_APP ? [] : [root]), '--user-data-dir', path.join(directory, 'profile'), '--database', database, '--language', language], env });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isFocused() || window.isFocusable())), false, 'Tests must not take desktop focus.');
  return page;
};
try {
  const page = await launch();
  const shot = name => page.screenshot({ path: path.join(results, `onboarding-${name}.png`) });

  // All unavailable: real discovery shows missing and signed-out without enabling any runtime.
  await page.locator('.connect-agent[data-state="signed_out"]').waitFor();
  assert.equal(await page.locator('.connect-agent[data-state="missing"]').count(), 3);
  assert.equal(await page.locator('.connect-continue').count(), 0);
  await page.locator('.connect-agent[data-state="signed_out"] .connect-state-link').click();
  await page.locator('.connect-fix code').filter({ hasText: 'codex login' }).waitFor();
  const clipboard = await app.evaluate(({clipboard})=>clipboard.readText());
  await page.locator('.connect-fix button').click();
  assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()), 'codex login');
  await app.evaluate(({clipboard}, text)=>clipboard.writeText(text), clipboard);
  await shot('connect-fix');
  // Installing and signing in outside Polaris is picked up by the existing 5-second polling.
  await writeFile(gemini, `#!/usr/bin/env node\nimport ${JSON.stringify(fixture)};\n`, { mode: 0o755 });
  await writeFile(gemini+'.json', JSON.stringify({ signedOut: true }));
  await page.waitForFunction(()=>document.querySelectorAll('.connect-agent[data-state="signed_out"]').length===2);
  await writeFile(codex+'.json', '{}');
  await page.locator('.connect-agent[data-state="ready"]').waitFor({timeout:10000});
  await page.locator('.connect-continue').waitFor();
  await shot('connect');
  // A ready check can go stale: connection failure must not fade out or leave this page.
  await writeFile(codex+'.json', JSON.stringify({signedOut:true}));
  await page.locator('.connect-continue').click();
  await page.locator('.connect-agent[data-state="failed"]').waitFor();
  assert.equal(await page.locator('.connect-screen.leaving').count(), 0);
  await writeFile(codex+'.json', '{}');
  await page.locator('.connect-agent[data-state="failed"] .connect-state-link').click();
  await page.locator('.connect-agent[data-state="ready"]').waitFor();
  // Full-window Agent: guide copy, composer already at its docked place.
  await page.locator('.connect-continue').click();
  await page.locator('.agent.full .agent-guide').waitFor();
  await shot('chat-empty');
  assert.equal(await page.locator('.agent-offline').count(), 0, 'Selected Agent is connected before entering chat');
  await page.locator('.agent-input textarea').fill('artifact-fixture');
  await page.locator('.agent-send').click();
  await page.getByText('Native fixture completed.', { exact: true }).waitFor();
  assert.ok(await page.locator('.agent.full').count(), 'Stays full-window until a goal exists');
  await shot('chat');

  // The native Agent creates the actual goal, principles, strategy and atomic first batch through MCP.
  const release=path.join(directory,'release-onboarding');
  await writeFile(codex+'.json',JSON.stringify({onboardingReleaseFile:release}));
  await page.locator('.agent-input textarea').fill('onboarding-fixture');
  await page.locator('.agent-send').click();
  // waitForFunction does not await an async predicate, so the service state is polled here.
  for (const deadline = Date.now() + 15000; ; await new Promise(resolve => setTimeout(resolve, 25))) {
    const held = await page.evaluate(async()=>{
      const s=(await window.polaris.call('agentSnapshot')).result;
      const job=s.jobs.find(j=>j.input==='onboarding-fixture');
      // IPC can observe the new job before the renderer applies its next snapshot.
      const board=(await window.polaris.call('snapshot')).result.board;
      // R-D173: the main turn saves the plan; cards come from the strategy's first round.
      return job?.state==='running' && s.native.activeJobIDs.includes(job.id) && board.strategies.some(item=>item.id==='reach')
        && /停止|Stop/.test(document.querySelector('.agent-send')?.getAttribute('aria-label') ?? '');
    });
    if (held) break;
    assert.ok(Date.now() < deadline, 'Onboarding turn did not hold after submitting cards');
  }
  assert.equal(await page.locator('.agent-opening').count(), 0, 'Saving the plan is not native turn completion');
  assert.match(await page.locator('.agent-send').getAttribute('aria-label'), /停止|Stop/, 'Native work remains cancellable until the actual turn ends');
  assert.equal(await page.locator('.board').evaluate(node=>getComputedStyle(node).visibility),'hidden');
  await writeFile(release,'');
  await page.locator('.agent-opening').waitFor();
  assert.equal(await page.locator('.board').evaluate(node => getComputedStyle(node).visibility), 'hidden', 'Nothing from the board shows through the sheet');
  await shot('holding');
  // The full-window conversation returns to its first entry on the Agent rail.
  await page.locator('.agent-sheet').waitFor({ state: 'detached' });
  await page.locator('.board .decision-card').first().waitFor();
  assert.equal(await page.locator('.board .decision-card').count(), 2);
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.agent.full').count(), 0);
  const main = page.locator('.main-agent-entry');
  assert.equal(await main.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.work-chat-dialog').count(),0);
  await main.click();
  assert.ok(await page.locator('.main-agent').innerText().then(text=>text.includes('Native fixture completed.')));
  await page.locator('.main-agent textarea').press('Escape');
  await page.locator('.work-chat-dialog').waitFor({state:'detached'});
  assert.equal(await page.locator('.goal-rail[inert], .board-pane[inert]').count(), 0);
  await shot('board');

  // R-D118: saved work opens while native discovery continues in the background.
  await app.close(); app = undefined;
  await writeFile(codex+'.json', JSON.stringify({ versionDelay: 15000 }));
  await writeFile(gemini+'.json', JSON.stringify({ versionDelay: 15000 }));
  const restored = await launch();
  await restored.locator('.app[data-ready="true"] .board .decision-card').first().waitFor({ timeout: 10000 });
  await restored.screenshot({ path: path.join(results, 'onboarding-restored.png') });
  const after = (await restored.evaluate(() => window.polaris.call('agentOnboarding'))).result;
  assert.equal(after.preferred, 'chatgpt-codex');
  assert.equal(after.agents.find(agent => agent.provider === 'chatgpt-codex').state, 'checking', 'Saved work opens without waiting for the selected AI');
  assert.equal(after.agents.find(agent => agent.provider === 'gemini-cli').state, 'checking', 'Saved work opens without waiting for other AIs');
  assert.equal(await restored.locator('.agent.full, .connect-screen').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS real onboarding detection, polling, copy, failed connect, native MCP first batch, active-turn guard, full-window to Agent rail handoff and saved-workspace restored launch');
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
