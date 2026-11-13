import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { PolarisError } from '../dist-service/model.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';

const capabilities = () => ({ ...emptyCapabilities(), toolEvents: 'details' });
const wait = async predicate => {
  const end = Date.now() + 5000;
  while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), 'Run did not settle');
};
async function fixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-runs-')), store = new PolarisStore(path.join(dir, 'test.sqlite'));
  seedDemo(store); const data = new AgentStore(store);
  const work = () => {
    const w = data.createWork(store.snapshot().strategies[0].id, 'Deliver a report', 'Save the requested report in Polaris.');
    const id = data.queue('work', w.instructions, w.id), session = `task:${id}`;
    store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?", session, w.id);
    store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=?,generation=1 WHERE id=?", session, id);
    store.query("INSERT INTO agent_session(id,provider,nativeSessionID) VALUES(?,'chatgpt-codex','native-session')", session);
    data.setJob(id, 'running'); return data.job(id);
  };
  const artifact = (job, body = 'Verified deliverable') => {
    const id = randomUUID(); store.query('INSERT INTO agent_artifact(id,workID,jobID,title,body) VALUES(?,?,?,?,?)', id, job.workID, job.id, 'Report', body); return id;
  };
  try { await fn({ store, data, work, artifact }); } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
}
const controls = { assertActive() {}, cancelWork() {}, retry() {}, queueWork() {} };
function tool(data, job, name) {
  return new AgentActions(data.store, data, controls, () => {}).definitions(job, job.workID ? data.work(job.workID) : undefined).find(item => item.name === name);
}
async function mcp(options, name, args) {
  const response = await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${options.mcp.env.POLARIS_MCP_TOKEN}` },
    body: JSON.stringify({ id: randomUUID(), method: 'tools/call', params: { name, arguments: args } }) });
  const result = (await response.json()).result; assert.equal(result.isError, undefined, result.content?.[0]?.text); return JSON.parse(result.content[0].text);
}
function runtime(store, turn) {
  const rt = new AgentCoordinator(store, () => {}, (async options => {
    options.onSession('native-session');
    return { id: 'native-session', capabilities: capabilities(), prompt: text => turn(options, text), cancel: async () => {}, close: async () => {} };
  }));
  rt.connections.set('chatgpt-codex', { provider: 'chatgpt-codex', connected: true, enabled: true, version: 'fixture', protocol: 'app-server', executable: 'mock',
    models: [], model: '', account: 'fixture', capabilities: capabilities(), verified: {} });
  return rt;
}
function start(rt) {
  const w = rt.data.createWork(rt.store.snapshot().strategies[0].id, 'Deliver a report', 'Save the requested report in Polaris.');
  const id = rt.queueWork(w.instructions, w.id); rt.pump(); return id;
}

test('run events commit with state and delivery, deduplicate observations, and paginate in durable order', () => fixture(({ store, data, work }) => {
  const job = work(); data.runs.delivery(job.id, 'sent'); data.runs.delivery(job.id, 'sent');
  const before = data.runs.inspect(job.id);
  assert.equal(before.events.filter(e => e.type === 'delivery').length, 1);
  assert.equal(before.events.at(-1).data.nativeSessionID, 'native-session');
  store.db.exec("CREATE TRIGGER reject_run_event BEFORE INSERT ON agent_run_event BEGIN SELECT RAISE(ABORT,'event fixture failure'); END");
  assert.throws(() => data.setJob(job.id, 'completed'), /event fixture failure/);
  assert.throws(() => data.runs.delivery(job.id, 'accepted'), /event fixture failure/);
  assert.equal(data.job(job.id).state, 'running'); assert.equal(data.job(job.id).delivery, 'sent');
  assert.deepEqual(data.runs.inspect(job.id), before); store.db.exec('DROP TRIGGER reject_run_event');
  for (let i = 0; i < 105; i++) data.runs.record(job.id, 'fixture', { i });
  const first = data.runs.inspect(job.id), second = data.runs.inspect(job.id, first.nextAfter);
  assert.equal(first.events.length, 100); assert.equal(second.events.length, 7);
  assert.ok(second.events.every(e => e.seq > first.nextAfter));
  assert.equal(new AgentStore(store).runs.inspect(job.id).events.length, 100);
}));

test('task results retain summaries and file references without claiming verification, and generations stay separate',()=>fixture(({store,data,work,artifact})=>{
 const job=work();data.message(job.id,'Research finished');data.setJob(job.id,'completed');data.runs.finish(job.id);
 assert.equal(data.runs.inspect(job.id).result.summary,'Research finished');assert.deepEqual(data.runs.inspect(job.id).result.artifacts,[]);assert.equal(data.runs.inspect(job.id).result.verification,undefined);
 store.query('UPDATE agent_job SET generation=2 WHERE id=?',job.id);data.setJob(job.id,'running');const id=artifact(job);data.message(job.id,'Saved the draft');data.setJob(job.id,'completed');data.runs.finish(job.id);
 assert.equal(data.runs.inspect(job.id).result.artifacts[0].id,id);assert.equal(data.runs.inspect(job.id,0,1).result.summary,'Research finished');
 assert.ok(data.runs.inspect(job.id,0,1).events.every(e=>e.generation===1));
}));

test('inspect tools and work context cannot expose another task or a previous decision task', () => fixture(({ store, data, work }) => {
  const job = work(), other = work();
  const inspect = tool(data, job, 'inspect_agent_run');
  assert.equal(inspect.execute({ job_id: job.id }).jobID, job.id);
  assert.throws(() => inspect.execute({ job_id: other.id }), /not found in this task/);
  assert.deepEqual(data.context(job).runs.map(r => r.jobID), [job.id]);
  store.query('UPDATE agent_job SET workID=? WHERE id=?', job.workID, other.id);
  assert.throws(() => inspect.execute({ job_id: other.id }), /not found in this task/);
  const main = { id: 'inspection', kind: 'main', workID: null };
  assert.equal(tool(data, main, 'inspect_agent_run').execute({ job_id: other.id }).jobID, other.id);
  assert.equal(tool(data, main, 'report_work_result'), undefined);
}));

test('native execution records acceptance once and finalizes artifact evidence through actual MCP calls', () => fixture(async ({ store }) => {
  const rt = runtime(store, async (options, prompt) => {
    assert.doesNotMatch(prompt, /Before ending completed work, call report_work_result/); options.onRun('native-turn'); options.onRun('native-turn');
    const artifact = await mcp(options, 'write_artifact', { title: 'Report', body: 'Actual result' });
    return { status: 'completed' };
  });
  try {
    const id = start(rt); await wait(() => rt.active.size === 0);
    const record = rt.data.runs.inspect(id);
    assert.equal(record.state, 'completed'); assert.equal(record.result.artifacts.length, 1); assert.ok(record.result.finalizedAt);
    assert.deepEqual(record.events.filter(e => e.type === 'delivery').map(e => e.data.delivery), ['preparing', 'sent', 'accepted', 'completed']);
    assert.equal(record.events.find(e => e.data.delivery === 'accepted').data.nativeRunID, 'native-turn');
    assert.equal(rt.data.context().runs.find(r => r.jobID === id).state, 'completed');
  } finally { await rt.stop(); }
}));

test('recovery preserves the last known stage and evidence without replaying uncertain work', () => fixture(async ({ store, data, work, artifact }) => {
  const job = work(), id = artifact(job); data.runs.delivery(job.id, 'sent');
  data.message(job.id, 'Submitted before interruption');
  let calls = 0; const rt = runtime(store, async () => { calls++; return { status: 'completed' }; });
  try {
    rt.pump(); assert.equal(calls, 0); assert.throws(() => rt.retry(job.id));
    const record = rt.data.runs.inspect(job.id);
    assert.equal(record.state, 'needs_review'); assert.equal(record.delivery, 'unknown'); assert.equal(record.result.verification, undefined);
    assert.deepEqual(record.events.filter(e => e.type === 'delivery').map(e => e.data.delivery), ['sent', 'unknown']);
    assert.equal(record.events.filter(e => e.type === 'recovered').length, 1);
  } finally { await rt.stop(); }
  const again = runtime(store, async () => { calls++; return { status: 'completed' }; });
  try { assert.equal(again.data.runs.inspect(job.id).events.filter(e => e.type === 'recovered').length, 1); } finally { await again.stop(); }
}));

const failure = id => ({ id, name: 'shell', state: 'failed', input: 'command SECRET_INPUT', output: 'SECRET_OUTPUT', error: { code: 'native_tool', message: 'SECRET_FAILURE' } });
test('three distinct identical failures produce one durable warning without persisting raw arguments or outputs', () => fixture(({ data, work }) => {
  const job = work(), observe = data.runs.observeTools(job.id, 1);
  for (let i = 0; i < 5; i++) { observe(failure(String(i)), true); observe(failure(String(i)), true); }
  const record = data.runs.inspect(job.id);
  assert.equal(record.events.filter(e => e.type === 'tool_started').length, 5);
  assert.equal(record.events.filter(e => e.type === 'tool_finished').length, 5);
  assert.equal(record.events.filter(e => e.type === 'stalled').length, 1);
  assert.equal(data.runs.overview().find(r => r.jobID === job.id).suspectedStall, 1);
  assert.doesNotMatch(JSON.stringify(record), /SECRET_/); assert.equal(data.job(job.id).state, 'running');
}));

test('successful polling, changing errors, incomplete details and successful intervening work do not count as a stall', () => fixture(({ store, data, work }) => {
  const job = work(), observe = data.runs.observeTools(job.id, 1); let id = 0;
  for (let i = 0; i < 4; i++) observe({ ...failure(String(id++)), state: 'completed', error: undefined }, true);
  for (let i = 0; i < 4; i++) observe({ ...failure(String(id++)), error: { code: 'native_tool', message: String(i) } }, true);
  for (let i = 0; i < 4; i++) observe(failure(String(id++)), false);
  for (let i = 0; i < 4; i++) observe({ ...failure(String(id++)), input: 'x'.repeat(12000) }, true);
  for (let i = 0; i < 3; i++) {
    observe(failure(String(id++)), true); observe(failure(String(id++)), true);
    observe({ ...failure(String(id++)), state: 'completed', error: undefined }, true);
  }
  assert.equal(data.runs.inspect(job.id).events.filter(e => e.type === 'stalled').length, 0);
  store.query('UPDATE agent_job SET generation=2 WHERE id=?', job.id);
  observe(failure('late'), true); assert.equal(data.runs.inspect(job.id).events.filter(e => e.data.toolID === 'late').length, 0);
  const next = data.runs.observeTools(job.id, 2); next(failure('new'), true);
  assert.equal(data.runs.overview().find(r => r.jobID === job.id).suspectedStall, 0);
}));

test('native failed tool events surface a passive warning while the same run continues', () => fixture(async ({ store }) => {
  let finish, options;
  const rt = runtime(store, async o => {
    options = o; o.onRun('failures');
    for (let i = 0; i < 3; i++) {
      o.onEvent({ type: 'tool', nativeID: String(i), data: { tool: 'read_file', arguments: { path: 'same' }, status: 'in_progress' } });
      o.onEvent({ type: 'tool', nativeID: String(i), complete: true, data: { status: 'failed', error: 'Unavailable' } });
    }
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    const id = start(rt); await wait(() => !!finish);
    assert.equal(rt.data.runs.overview().find(r => r.jobID === id).suspectedStall, 1);
    assert.equal(rt.data.job(id).state, 'running'); assert.equal(rt.active.size, 1);
    finish({ status: 'completed' }); await wait(() => rt.active.size === 0);
    const count = rt.data.runs.inspect(id).events.length;
    options.onEvent({ type: 'tool', nativeID: 'late', data: { tool: 'late', status: 'completed' } });
    options.onRun('late-run'); options.onSession('late-session');
    assert.equal(rt.data.runs.inspect(id).events.length, count);
    assert.equal(rt.data.job(id).delivery, 'completed'); assert.equal(rt.data.job(id).nativeRunID, 'failures');
  } finally { finish?.({ status: 'cancelled' }); await rt.stop(); }
}));

test('committed evidence survives process death before send, after acceptance and after a tool result without replay', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-run-crash-'));
  const script = `
    import { seedDemo } from ${JSON.stringify(new URL('./fixtures/seed.mjs', import.meta.url).href)};
    import { PolarisStore } from ${JSON.stringify(new URL('../dist-service/store.js', import.meta.url).href)};
    import { AgentStore } from ${JSON.stringify(new URL('../dist-service/agent-store.js', import.meta.url).href)};
    const store = new PolarisStore(process.argv[1]); seedDemo(store); const data = new AgentStore(store);
    const work = data.createWork(store.snapshot().strategies[0].id, 'Crash test', 'Inspect persisted evidence');
    store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey='crash-task' WHERE id=?", work.id);
    const id = data.queue('work', work.instructions, work.id);
    store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey='crash-task',generation=1 WHERE id=?", id);
    data.setJob(id, 'running'); data.runs.delivery(id, 'preparing');
    if (process.argv[2] !== 'preparing') { data.runs.delivery(id, 'sent'); data.runs.delivery(id, 'accepted'); }
    if (process.argv[2] === 'tool') data.runs.observeTools(id, 1)({ id:'tool',name:'read_file',state:'completed',input:'fixture',output:'Read completed' }, true);
    process.kill(process.pid, 'SIGKILL');
  `;
  try {
    for (const stage of ['preparing', 'accepted', 'tool']) {
      const database = path.join(dir, stage + '.sqlite');
      const child = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, database, stage], { encoding: 'utf8' });
      assert.equal(child.signal, 'SIGKILL', child.stderr);
      const store = new PolarisStore(database); let calls = 0;
      const rt = runtime(store, async () => { calls++; return { status: 'completed' }; });
      try {
        const id = String(store.query('SELECT id FROM agent_job')[0].id), record = rt.data.runs.inspect(id);
        assert.equal(record.state, 'needs_review'); assert.equal(record.delivery, 'unknown');
        const deliveries = record.events.filter(e => e.type === 'delivery').map(e => e.data.delivery);
        assert.deepEqual(deliveries, stage === 'preparing' ? ['preparing', 'unknown'] : ['preparing', 'sent', 'accepted', 'unknown']);
        assert.equal(record.events.some(e => e.type === 'tool_finished'), stage === 'tool');
        rt.pump(); assert.equal(calls, 0); assert.throws(() => rt.retry(id), /cannot be replayed/);
      } finally { await rt.stop(); store.close(); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('errors before and after dispatch preserve delivery safety and record missing results conservatively', () => fixture(async ({ store }) => {
  let failBefore = true;
  const rt = runtime(store, async () => { throw new PolarisError('native_disconnected', 'Private provider error'); });
  const driver = rt.driver; rt.driver = async options => { if (failBefore) throw new PolarisError('native_protocol', 'Private initialize error'); return driver(options); };
  try {
    const id = start(rt); await wait(() => rt.active.size === 0);
    assert.equal(rt.data.job(id).delivery, 'not_sent'); assert.equal(rt.data.runs.inspect(id).state, 'failed');
    failBefore = false; rt.retry(id); await wait(() => rt.active.size === 0);
    assert.equal(rt.data.job(id).delivery, 'unknown'); assert.equal(rt.data.job(id).state, 'needs_review'); assert.throws(() => rt.retry(id));
    const record = rt.data.runs.inspect(id); assert.equal(record.generation, 2); assert.doesNotMatch(JSON.stringify(record), /Private/);
    assert.ok(record.events.some(e => e.generation === 1)); assert.ok(record.events.some(e => e.generation === 2));
  } finally { await rt.stop(); }
}));
