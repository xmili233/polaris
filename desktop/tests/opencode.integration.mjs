// Real OpenCode with a local model fixture: no provider account or model charges.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { seedDemo } from './fixtures/seed.mjs';

const executable = process.env.POLARIS_TEST_OPENCODE;
assert.ok(executable && path.isAbsolute(executable), 'Set POLARIS_TEST_OPENCODE to the absolute path of OpenCode 1.15.5.');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-opencode-native-'));
const environment = process.env, requests = [];
let store, runtime, strategy, secondStrategy, held = false, rejectAuth = true;
const wait = async predicate => {
  const end = Date.now() + 60_000;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail('OpenCode did not settle: ' + JSON.stringify(runtime?.snapshot().jobs));
};
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = JSON.parse(body);
  requests.push(input);
  const lastUser = input.messages.findLast(message => message.role === 'user');
  const text = JSON.stringify(lastUser?.content);
  if (text?.includes('hold-native-fixture')) {
    held = true;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': waiting\n\n');
    return;
  }
  if (input.stream && text?.includes('auth-native-fixture') && rejectAuth) {
    rejectAuth = false; response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Invalid local fixture credentials', type: 'invalid_request_error', code: 'invalid_api_key' } })); return;
  }
  const target = text?.includes('second-native-fixture') ? secondStrategy : strategy;
  const tools = input.tools ?? [];
  const name = tools.find(tool => tool.function.name.endsWith('request_decisions'))?.function.name;
  const card = text?.includes('card-native-fixture') && input.messages.at(-1)?.role !== 'tool';
  const delta = card && name ? { tool_calls: [{ index: 0, id: 'fixture-card', type: 'function', function: { name, arguments: JSON.stringify({ decisions: [{ strategy_id: target.id, issue_key: 'native-test', title: `Choose the pilot for ${target.id}?`, body: 'A local protocol test.', options: [{ id: 'yes', label: 'Yes' }] }] }) } }] } : { content: 'Local OpenCode response.' };
  const reason = delta.tool_calls ? 'tool_calls' : 'stop';
  if (input.stream) {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const item of [{ delta, finish_reason: null }, { delta: {}, finish_reason: reason }]) response.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: input.model, choices: [{ index: 0, ...item }] }) + '\n\n');
    response.end('data: [DONE]\n\n');
  } else {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', created: 1, model: input.model, choices: [{ index: 0, message: { role: 'assistant', content: 'Local title' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = {
    model: 'fixture/one', small_model: 'fixture/one', enabled_providers: ['fixture'], share: 'disabled', snapshot: false,
    provider: { fixture: { npm: '@ai-sdk/openai-compatible', name: 'Local fixture', options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-fixture' }, models: { one: { name: 'One', limit: { context: 32000, output: 1024 } }, two: { name: 'Two', limit: { context: 32000, output: 1024 } } } } },
  };
  // Replace only this test process's environment; the user's native configuration is never loaded.
  process.env = { PATH: environment.PATH, LANG: 'en_US.UTF-8', TMPDIR: tmpdir(), SHELL: environment.SHELL ?? '/bin/sh',
    POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ opencode: executable }),
    OPENCODE_PURE: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
  };
  for (const kind of ['CONFIG', 'DATA', 'CACHE', 'STATE']) { const dir = path.join(directory, kind.toLowerCase()); await mkdir(dir); process.env[`XDG_${kind}_HOME`] = dir; }
  store = new PolarisStore(path.join(directory, 'workspace.sqlite')); seedDemo(store);
  [strategy, secondStrategy] = store.snapshot().strategies;
  runtime = new AgentCoordinator(store);
  await runtime.connect('opencode');
  const connection = runtime.connections.get('opencode');
  assert.equal(connection.version, '1.15.5');
  assert.equal(connection.connected, true, JSON.stringify(connection));
  assert.equal(connection.authenticated, null);
  assert.deepEqual(connection.models.map(model => model.id).sort(), ['fixture/one', 'fixture/two']);
  runtime.select('opencode'); await runtime.chooseModel('opencode', 'fixture/two');
  const complete = async text => {
    const id = runtime.send(text);
    await wait(() => ['completed', 'failed', 'needs_review'].includes(runtime.data.job(id).state) && runtime.active.size === 0);
    assert.equal(runtime.data.job(id).state, 'completed', JSON.stringify(runtime.data.job(id)));
    return id;
  };
  const first = await complete('hello-native-fixture');
  assert.ok(requests.some(request => request.model === 'two'));
  assert.ok(runtime.conversation().messages.some(message => message.body.includes('Local OpenCode response.')));
  await complete('resume-native-fixture');
  assert.equal(runtime.connections.get('opencode').verified.resume, true);
  await runtime.selectSubModel('opencode', 'fixture/one');
  const work = runtime.data.createWork(strategy.id, 'Native card test', 'card-native-fixture');
  const other = runtime.data.createWork(secondStrategy.id, 'Concurrent native card test', 'card-native-fixture second-native-fixture');
  const id = runtime.queueWork(work.instructions, work.id), otherID = runtime.queueWork(other.instructions, other.id); runtime.pump();
  await wait(() => ['completed', 'failed', 'needs_review'].includes(runtime.data.job(id).state) && runtime.active.size === 0);
  assert.equal(runtime.data.job(id).state, 'completed', JSON.stringify(runtime.data.job(id)));
  assert.equal(runtime.data.job(otherID).state, 'completed', JSON.stringify(runtime.data.job(otherID)));
  for (const target of [strategy, secondStrategy]) assert.ok(store.snapshot().decisions.some(card => card.title === `Choose the pilot for ${target.id}?` && card.strategyID === target.id));
  assert.notEqual(runtime.data.job(first).sessionKey, runtime.data.job(id).sessionKey);
  assert.equal(runtime.conversation(work.id).canSend, false);
  const failed = runtime.send('auth-native-fixture');
  await wait(() => ['completed', 'failed'].includes(runtime.data.job(failed).state) && runtime.active.size === 0);
  assert.equal(runtime.data.job(failed).state, 'failed', 'A provider credential failure must not complete successfully.');
  runtime.retry(failed);
  await wait(() => runtime.data.job(failed).state === 'completed' && runtime.active.size === 0);
  const hold = runtime.send('hold-native-fixture'); await wait(() => held);
  await runtime.cancel(hold); await wait(() => runtime.data.job(hold).state === 'cancelled' && runtime.active.size === 0);
  assert.ok(requests.every(request => ['one', 'two'].includes(request.model)));
  assert.ok(requests.filter(request => request.tools).every(request => !request.tools.some(tool => tool.function.name === 'question')));
  console.log('PASS OpenCode 1.15.5: discovery, model selection, streaming, resume, scoped business MCP cards, concurrent background scopes, provider failure/retry, cancellation; local model fixture only.');
} finally {
  await runtime?.stop(); store?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  process.env = environment; await rm(directory, { recursive: true, force: true });
}
