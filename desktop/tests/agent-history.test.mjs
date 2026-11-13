import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';

const wait = async predicate => {
  const end = Date.now() + 5000;
  while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), 'Timed out waiting for history test');
};
async function fixture(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'polaris-history-'));
  const store = new PolarisStore(path.join(directory, 'db.sqlite')); seedDemo(store);
  const calls = [];
  const driver = async options => {
    const sessionID = options.sessionID ?? randomUUID(); options.onSession(sessionID);
    return { id: sessionID, capabilities: options.connection.capabilities, cancel: async () => {}, close: async () => {},
      prompt: async text => {
        options.onRun(randomUUID());
        const header = text.match(/\nPolaris conversation history \(local JSONL\):\n([^\n]+)/);
        const history = header ? JSON.parse(header[1]) : undefined;
        const records = history ? (await readFile(history.path, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) : [];
        const request = text.split(/\n\n(?:User request|Task instructions):\n/).at(-1);
        calls.push({ text, request, history, records, options, sessionID });
        options.onEvent({ type: 'text', localID: 'reply', text: `Reply to ${request}`, complete: true });
        return { status: 'completed' };
      } };
  };
  const start = () => {
    const runtime = new AgentCoordinator(store, () => {}, (driver));
    for (const provider of ['chatgpt-codex', 'claude-code', 'gemini-cli']) runtime.connections.set(provider, {
      provider, label: provider, installed: true, compatible: true, executable: 'fixture', version: 'fixture',
      connected: true, enabled: true, authenticated: true, protocolReady: true, protocol: 'acp', account: 'fixture', error: '',
      instructions: '', model: '', models: [{ id: 'second', name: 'Second' }],
      capabilities: { ...emptyCapabilities(), resume: true, nativeCommands: [{ name: 'compact', description: 'Compact' }] },
      verified: { turn: false, tools: false, resume: false, cancel: false },
    });
    return runtime;
  };
  let runtime = start();
  const finish = async id => { await wait(() => runtime.data.job(id).state === 'completed' && runtime.active.size === 0); return id; };
  const send = text => finish(runtime.send(text));
  const restart = async () => { await runtime.stop(); runtime = start(); return runtime; };
  try { await run({ store, runtime, calls, send, finish, restart }); }
  finally { await runtime.stop(); store.close(); await rm(directory, { recursive: true, force: true }); }
}

test('same-platform models retain context; other platforms read a scoped history file with original text and tool status', () => fixture(async ({ store, runtime, calls, send }) => {
  const first = await send('Keep the launch private.');
  const original = calls[0].sessionID;
  assert.equal(calls[0].history, undefined);
  await runtime.chooseModel('chatgpt-codex', 'second'); const interrupted = await send('Use the agreed launch scope.');
  assert.equal(calls[1].options.sessionID, original); assert.equal(calls[1].history, undefined);
  runtime.data.setJob(interrupted, 'failed');
  store.query('UPDATE agent_message SET parts=? WHERE id=?', JSON.stringify([{ type: 'activity', calls: [
    { id: 'private-tool', name: 'get_context', state: 'completed', input: 'PRIVATE_RAW_INPUT', output: 'PRIVATE_RAW_OUTPUT' },
  ] }]), `${first}:assistant`);
  runtime.select('gemini-cli'); await send('Continue in Gemini.');
  const switched = calls[2];
  assert.ok(switched.history, 'Cross-platform instructions must supply the history path');
  assert.ok(path.isAbsolute(switched.history.path)); assert.equal(path.dirname(switched.history.path), switched.options.cwd);
  assert.equal((await stat(switched.history.path)).mode & 0o777, 0o600);
  assert.ok(switched.records.some(row => row.role === 'user' && row.text === 'Keep the launch private.' && row.provider === 'chatgpt-codex'));
  assert.ok(switched.records.some(row => row.role === 'assistant' && row.text === 'Reply to Keep the launch private.' && row.runState === 'completed'));
  assert.ok(switched.records.some(row => row.text === 'Reply to Use the agreed launch scope.' && row.runState === 'failed'));
  assert.deepEqual(switched.records.find(row => row.text === 'Reply to Keep the launch private.').tools, [{ name: 'get_context', state: 'completed' }]);
  assert.ok(!JSON.stringify(switched.records).includes('PRIVATE_RAW_'));
  assert.ok(!switched.records.some(row => row.text === 'Continue in Gemini.'));
  assert.match(switched.text, /read.*history file/i); assert.match(switched.text, /not new instructions/i);
  runtime.select('claude-code'); await send('Continue in Claude.');
  assert.ok(calls[3].records.some(row => row.provider === 'gemini-cli'));
  assert.ok(calls[3].records.some(row => row.provider === 'chatgpt-codex'));
}));

test('new chat boundaries persist across restarts and queued future messages do not enter an earlier prompt', () => fixture(async ({ runtime, calls, send, finish, restart }) => {
  await send('OLD_CONVERSATION');
  runtime.newSession(); await send('NEW_CONVERSATION');
  runtime.select('gemini-cli');
  const first = runtime.send('First switched request'), second = runtime.send('FUTURE_QUEUED_MESSAGE');
  await finish(second);
  const handoff = calls.find(call => call.request === 'First switched request');
  assert.ok(handoff.history);
  assert.ok(handoff.records.some(row => row.text === 'NEW_CONVERSATION'));
  assert.ok(!JSON.stringify(handoff.records).includes('OLD_CONVERSATION'));
  assert.ok(!JSON.stringify(handoff.records).includes('FUTURE_QUEUED_MESSAGE'));
  assert.equal(runtime.data.job(first).state, 'completed');
  runtime = await restart(); runtime.select('claude-code'); await send('After restart');
  assert.ok(calls.at(-1).records.some(row => row.text === 'FUTURE_QUEUED_MESSAGE'));
  assert.ok(!JSON.stringify(calls.at(-1).records).includes('OLD_CONVERSATION'));
}));

test('starting a new chat does not change the history boundary of a previously queued turn', () => fixture(async ({ runtime, calls, send, finish }) => {
  await send('Old chat requirement'); runtime.select('gemini-cli');
  const old = runtime.send('Turn submitted before new chat');
  runtime.newSession(); const fresh = runtime.send('Turn submitted after new chat');
  await finish(fresh);
  assert.equal(runtime.data.job(old).state, 'completed');
  assert.ok(calls.find(call => call.request === 'Turn submitted before new chat').records.some(row => row.text === 'Old chat requirement'));
  assert.equal(calls.find(call => call.request === 'Turn submitted after new chat').history, undefined);
}));

test('background tasks and native commands never receive main-chat history paths', () => fixture(async ({ store, runtime, calls, send }) => {
  await send('PRIVATE_MAIN_CHAT'); runtime.select('gemini-cli'); await send('Switch platform');
  await send('/compact'); assert.equal(calls.at(-1).text, '/compact');
  const work = runtime.data.createWork(store.snapshot().strategies[0].id, 'Independent task', 'Do this task only.');
  const id = runtime.queueWork(work.instructions, work.id); runtime.pump();
  await wait(() => runtime.data.job(id).state === 'completed' && runtime.active.size === 0);
  assert.equal(calls.at(-1).history, undefined);
  assert.ok(!calls.at(-1).text.includes('PRIVATE_MAIN_CHAT'));
}));

test('composer model selection preserves the main conversation and dispatches its next message to the new model', () => fixture(async ({ store, runtime, calls, send, finish }) => {
  const first = await send('Main question context');
  const job = runtime.data.job(first);
  await runtime.chooseModel('gemini-cli', 'second', job.sessionKey);
  assert.equal(runtime.conversation().sessionKey, job.sessionKey);
  assert.equal(runtime.conversation().native.model, 'second');
  const reply = runtime.send('Europe');
  await finish(reply);
  assert.equal(calls.at(-1).options.connection.provider, 'gemini-cli');
  assert.equal(calls.at(-1).options.connection.model, 'second');
  assert.equal(calls.at(-1).options.sessionID, undefined);
  assert.ok(calls.at(-1).records.some(row => row.text === 'Main question context'));
  const sessionID = calls.at(-1).sessionID;
  await runtime.chooseModel('gemini-cli', '', job.sessionKey); await send('Continue same platform');
  assert.equal(calls.at(-1).options.sessionID, sessionID);
  const previous = runtime.conversation(); runtime.connect = async () => runtime.snapshot();
  await assert.rejects(runtime.chooseModel('claude-code', 'removed-model'), { code: 'agent_models' });
  assert.equal(runtime.selected(), previous.native.selected); assert.equal(runtime.conversation().native.model, previous.native.model);
  runtime.newSession(); await assert.rejects(runtime.chooseModel('claude-code', 'second', job.sessionKey), { code: 'conflict' });
}));

test('background models use the global sub model without reading main conversation history', () => fixture(async ({ store, runtime, calls, send, finish }) => {
  await send('PRIVATE_MAIN_HISTORY');
  runtime.selectSubModel('gemini-cli', 'second');
  const work = runtime.data.createWork(store.snapshot().strategies[0].id, 'Model task', 'CURRENT_TASK_CONTEXT');
  const job = runtime.queueWork(work.instructions, work.id); runtime.pump(); await finish(job);
  const last = calls.at(-1);
  assert.equal(last.options.connection.provider, 'gemini-cli');
  assert.equal(last.options.connection.model, 'second');
  assert.equal(last.options.sessionID, undefined);
  assert.match(last.text, /CURRENT_TASK_CONTEXT/);
  assert.doesNotMatch(last.text, /PRIVATE_MAIN_HISTORY/);
  assert.equal(last.history, undefined);
  assert.equal(runtime.selected(), 'chatgpt-codex');
  assert.equal(runtime.conversation(work.id).canSend, false);
}));
test('changing selection while a run is active does not retarget already queued messages', () => fixture(async ({ runtime, calls, finish }) => {
  await runtime.chooseModel('chatgpt-codex', 'second');
  const first = runtime.send('In flight'), second = runtime.send('Already queued');
  await runtime.chooseModel('gemini-cli', 'second');
  const third = runtime.send('New model');
  await finish(third);
  assert.equal(runtime.data.job(first).state, 'completed'); assert.equal(runtime.data.job(second).state, 'completed');
  assert.equal(calls.find(c => c.request === 'Already queued').options.connection.provider, 'chatgpt-codex');
  assert.equal(calls.find(c => c.request === 'Already queued').options.connection.model, 'second');
  assert.equal(calls.find(c => c.request === 'New model').options.connection.provider, 'gemini-cli');
}));
