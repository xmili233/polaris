import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { discover, inspectConnection, compatibleVersion } from '../dist-service/agents/discovery.js';
import { onboardingState } from '../dist-service/agent-onboarding.js';
import { seedDemo } from './fixtures/seed.mjs';

const wait = async predicate => {
  const end = Date.now() + 15_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.fail('OpenCode fixture did not settle');
};
async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'polaris-opencode-'));
  const executable = path.join(directory, 'opencode.mjs'), trace = path.join(directory, 'trace.jsonl');
  const prior = Object.fromEntries(['POLARIS_TEST', 'POLARIS_TEST_NATIVE_AGENTS'].map(key => [key, process.env[key]]));
  await writeFile(executable, `#!/usr/bin/env node\nimport ${JSON.stringify(new URL('./fixtures/native-agent.mjs', import.meta.url).href)};\n`, { mode: 0o755 });
  const settings = { version: '1.15.5', trace, defaultModel: 'local/one', acpModels: [{ modelId: 'local/one', name: 'One' }, { modelId: 'local/two', name: 'Two' }],
    acpOptions: { 'local/one': [{ id: 'effort', category: 'thought_level', type: 'select', name: 'Reasoning', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'high', name: 'High' }] }] } };
  const configure = patch => writeFile(executable + '.json', JSON.stringify({ ...settings, ...patch }));
  await configure({});
  process.env.POLARIS_TEST = '1'; process.env.POLARIS_TEST_NATIVE_AGENTS = JSON.stringify({ opencode: executable });
  const store = new PolarisStore(path.join(directory, 'workspace.sqlite')); seedDemo(store);
  const runtime = new AgentCoordinator(store);
  try { await run({ runtime, store, directory, trace, configure }); }
  finally {
    await runtime.stop(); store.close();
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(directory, { recursive: true, force: true });
  }
}

test('OpenCode discovery uses native ACP, keeps full model IDs and does not claim verified authentication', () => fixture(async ({ trace, configure }) => {
  assert.equal(compatibleVersion('opencode', '1.15.5'), true);
  assert.equal(compatibleVersion('opencode', '1.14.0'), false);
  assert.equal(compatibleVersion('opencode', '2.0.0'), false);
  const connection = await inspectConnection(await discover('opencode'));
  assert.equal(connection.connected, true); assert.equal(connection.authenticated, null);
  assert.equal(onboardingState(connection), 'ready');
  assert.deepEqual(connection.models.map(model => model.id), ['local/one', 'local/two']);
  assert.equal(connection.models[0].options[0].kind, 'reasoning');
  const requests = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests[0].args, ['acp']);
  assert.equal(requests[0].permission, undefined, 'Probing does not enable full access.');
  await configure({ signedOut: true });
  const signedOut = await inspectConnection(await discover('opencode'));
  assert.equal(signedOut.authenticated, false); assert.equal(onboardingState(signedOut), 'signed_out');
}));

test('OpenCode main chat selects models, restores sessions and preserves mandatory permissions', () => fixture(async ({ runtime, trace }) => {
  await runtime.connect('opencode'); runtime.select('opencode');
  await runtime.chooseModel('opencode', 'local/one', undefined, { effort: 'high' });
  const first = runtime.send('artifact-fixture');
  await wait(() => runtime.data.job(first).state === 'completed' && runtime.active.size === 0);
  const second = runtime.send('continue');
  await wait(() => runtime.data.job(second).state === 'completed' && runtime.active.size === 0);
  assert.equal(runtime.connections.get('opencode').verified.resume, true);
  const late = runtime.send('late-stream-fixture');
  await wait(() => runtime.data.job(late).state === 'completed' && runtime.active.size === 0);
  assert.ok(runtime.conversation().messages.some(message => message.body === 'Complete late reply.'));
  const empty = runtime.send('empty-turn-fixture');
  await wait(() => runtime.data.job(empty).state === 'failed' && runtime.active.size === 0);
  assert.equal(runtime.data.job(empty).error, 'native_incomplete');
  const requestID = runtime.send('forced-permission-fixture');
  await wait(() => runtime.snapshot().permissions.length === 1);
  const permission = runtime.snapshot().permissions[0];
  assert.equal(permission.options[0].kind, 'allow_once');
  runtime.permission(permission.id, 'accept');
  await wait(() => runtime.data.job(requestID).state === 'completed' && runtime.active.size === 0);
  const wire = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
  const executions = wire.filter(item => item.permission);
  assert.ok(executions.some(item => item.method === 'session/load'));
  assert.ok(executions.every(item => JSON.parse(item.permission).question === 'deny'));
  assert.ok(wire.some(item => item.method === 'session/set_mode' && item.modeId === 'build'));
  assert.ok(!wire.some(item => item.modeId === 'yolo' || item.modeId === 'bypassPermissions'));
  assert.ok(wire.some(item => item.configId === 'effort' && item.value === 'high'));
}));

test('OpenCode background tasks use scoped MCP cards and preserve cancellation and retry', () => fixture(async ({ runtime, store }) => {
  await runtime.connect('opencode'); runtime.select('opencode');
  await runtime.selectSubModel('opencode', 'local/one');
  const strategy = store.snapshot().strategies[0];
  const work = runtime.data.createWork(strategy.id, 'Research', 'decision-fixture');
  const id = runtime.queueWork(work.instructions, work.id); runtime.pump();
  await wait(() => runtime.data.job(id).state === 'completed' && runtime.active.size === 0);
  assert.ok(store.snapshot().decisions.some(card => card.title === 'Choose a route' && card.strategyID === strategy.id));
  assert.equal(runtime.conversation(work.id).canSend, false);
  const limited = runtime.data.createWork(strategy.id, 'Quota interrupted', 'quota-fixture');
  const failed = runtime.queueWork(limited.instructions, limited.id); runtime.pump();
  await wait(() => runtime.data.job(failed).state === 'failed' && runtime.active.size === 0);
  const sessionKey = runtime.data.job(failed).sessionKey;
  runtime.retry(failed);
  await wait(() => runtime.data.work(limited.id).state === 'completed' && runtime.active.size === 0);
  assert.equal(runtime.data.work(limited.id).sessionKey, sessionKey, 'Retry continues the same native session.');
  const interrupted = runtime.data.createWork(strategy.id, 'Interrupted', 'forced-permission-fixture');
  const stopped = runtime.queueWork(interrupted.instructions, interrupted.id); runtime.pump();
  await wait(() => ['failed', 'needs_review'].includes(runtime.data.job(stopped).state) && runtime.active.size === 0);
  assert.equal(runtime.data.job(stopped).error, 'work_permission');
  assert.equal(runtime.snapshot().permissions.length, 0, 'Background work never opens a permission chat.');
  runtime.newSession();
  const hold = runtime.send('hold-fixture'); await wait(() => runtime.data.job(hold).delivery === 'sent');
  await runtime.cancel(hold); await wait(() => runtime.data.job(hold).state === 'cancelled' && runtime.active.size === 0);
}));
