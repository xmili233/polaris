import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { PolarisError } from '../dist-service/model.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
const wait = async fn => { const end = Date.now() + 5000; while (Date.now() < end) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail('Execution did not settle'); };
async function fixture(turn, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-execution-')), store = new PolarisStore(path.join(dir, 'test.sqlite')); seedDemo(store);
  const calls = [];
  const runtime = new AgentCoordinator(store, () => {}, (async options => {
    options.onSession(randomUUID()); calls.push(options);
    return { id: 'fixture', capabilities: emptyCapabilities(), prompt: text => turn(options, text, runtime), cancel: async () => {}, close: async () => {} };
  }));
  runtime.connections.set('chatgpt-codex', { provider: 'chatgpt-codex', connected: true, enabled: true, version: 'fixture', protocol: 'app-server', executable: 'mock', model: '', models: [], capabilities: emptyCapabilities(), verified: {} });
  const start = () => {
    const work = runtime.data.createWork(store.snapshot().strategies[0].id, '客户方案', '制作并导出客户方案');
    const id = runtime.queueWork(work.instructions, work.id); runtime.pump(); return id;
  };
  try { await fn({ runtime, store, calls, start, dir }); } finally { await runtime.stop(); store.close(); await rm(dir, { recursive: true, force: true }); }
}
async function tool(options, name, args) {
  const response = await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${options.mcp.env.POLARIS_MCP_TOKEN}` }, body: JSON.stringify({ id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const result = (await response.json()).result; assert.equal(result.isError, undefined, result.content?.[0]?.text); return JSON.parse(result.content[0].text);
}

function storeLegacyResult(store, job) {
  const result = { summary: '尚未导出', remaining: ['导出文件'], verification: 'incomplete', artifact_ids: [], artifacts: [] };
  store.query('INSERT INTO agent_run_result(jobID,generation,payload,updatedAt) VALUES(?,?,?,?)', job.id, job.generation, JSON.stringify(result), new Date().toISOString());
}

test('explicitly organizing imported knowledge links it only to the chosen goal', () => fixture(async (options, prompt, runtime) => {
  const id = prompt.match(/Organize document ([^\s]+) under the first goal/)[1];
  const doc = await tool(options, 'read_knowledge', { id, full: true });
  const rules = await tool(options, 'read_knowledge_rules', {});
  await tool(options, 'write_knowledge', { id, expectedVersion: doc.version, rulesVersion: rules.version,
    title: doc.title, body: doc.body, category: '客户', tags: [], aliases: [], sources: doc.sources, goalIDs: [runtime.store.snapshot().goals[0].id] });
  return { status: 'completed' };
}, async ({ runtime, store }) => {
  const args = { markdown: '# 客户访谈\n\n用户提供的客户事实。', filename: '访谈.md', requestID: randomUUID() };
  const doc = runtime.data.knowledge.importMarkdown(args);
  assert.deepEqual(doc.goalIDs, []);
  assert.equal(store.query('SELECT id FROM agent_job').length, 0);
  runtime.send(`Organize document ${doc.id} under the first goal`);
  await wait(() => runtime.active.size === 0 && runtime.data.knowledge.read(doc.id).version === 2);
  const goals = store.snapshot().goals;
  assert.equal(runtime.data.knowledge.find({ query: '客户访谈' }, { goalID: goals[0].id, jobID: 'task' }).total, 1);
  assert.equal(runtime.data.knowledge.find({ query: '客户访谈' }, { goalID: goals[1].id, jobID: 'task' }).total, 0);
  assert.equal(runtime.data.knowledge.read(doc.id).body, args.markdown);
}));
test('the main Agent can dismiss an exact uncertain run without replaying it or erasing evidence', () => fixture(async (options) => {
  options.onRun('run');
  throw new PolarisError('native_disconnected', 'Interrupted after sending');
}, async ({ runtime, store, start, calls }) => {
  const id = start();
  await wait(() => runtime.active.size === 0 && runtime.data.job(id).state === 'needs_review');
  const mainID = runtime.data.queue('main', 'Close this task alert.');
  const main = new AgentActions(store, runtime.data, { assertActive() {} }, () => {}).definitions(runtime.data.job(mainID));
  const alerts = () => JSON.parse(main.find(t => t.name === 'get_context').execute({})).attention;
  const dismiss = main.find(t => t.name === 'manage_work');
  const [alert] = alerts();
  assert.equal(alert.jobID, id);
  const args = { action: 'dismiss', id: alert.workID, job_id: id, generation: alert.generation };
  assert.throws(() => dismiss.execute({ ...args, generation: args.generation + 1 }), { code: 'conflict' });
  assert.throws(() => dismiss.execute({ action: 'dismiss', id: alert.workID }), { code: 'invalid_input' });
  dismiss.execute(args);
  dismiss.execute(args);
  assert.deepEqual(alerts(), []);
  assert.equal(runtime.data.executions.results().some(item => item.jobID === id), false);
  const run = runtime.data.runs.inspect(id);
  assert.equal(run.state, 'needs_review');
  assert.equal(run.delivery, 'unknown');
  assert.equal(runtime.conversation(alert.workID).retryJobID, undefined);
  assert.throws(() => runtime.retry(id), { code: 'conflict' });
  assert.equal(calls.length, 2, 'Only one additional read-only effect check is queued');
}));

test('retry after a submitted task fails continues in the same session and preserves prior work', () => fixture(async (options, prompt) => {
  options.onRun('run');
  if (!options.sessionID) {
    options.onEvent({ type: 'text', text: 'Partial research saved.' });
    throw new PolarisError('native_protocol', 'Usage limit reached.');
  }
  assert.match(prompt.split(/\n\n(?:User request|Task instructions):\n/).at(-1), /remaining authorized work/);
  return { status: 'completed' };
}, async ({ runtime, store, start, calls }) => {
  const id = start();
  await wait(() => runtime.active.size === 0 && runtime.data.job(id).state === 'failed');
  const { workID, sessionKey } = runtime.data.job(id);
  const saved = store.query('SELECT nativeSessionID FROM agent_session WHERE id=?', sessionKey)[0].nativeSessionID;
  assert.equal(runtime.conversation(workID).retryJobID, id);
  runtime.retry(id);
  assert.throws(() => runtime.retry(id), { code: 'conflict' });
  await wait(() => runtime.active.size === 0);
  const snapshot = runtime.conversation(workID);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sessionID, saved);
  assert.deepEqual(snapshot.jobs.map(job => job.state), ['completed', 'failed']);
  assert.equal(runtime.data.runs.inspect(id).result.summary, 'Partial research saved.');
  assert.equal(snapshot.retryJobID, undefined);
}));

test('work the main Agent delegates reads only the main-Agent artifacts it was given', () => {
  let approved, unrelated, received, denied;
  return fixture(async (options, _text, runtime) => {
    options.onRun('run');
    const request = async id => {
      const response = await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${options.mcp.env.POLARIS_MCP_TOKEN}` }, body: JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'read_artifact', arguments: { id } } }) });
      return (await response.json()).result;
    };
    received = await request(approved.id); denied = await request(unrelated.id); return { status: 'completed' };
  }, async ({ runtime, store }) => {
    const jobID = runtime.data.queue('main', '准备客户方案');
    store.query("UPDATE agent_job SET sessionKey='test-main',provider='chatgpt-codex' WHERE id=?", jobID);
    const actions = new AgentActions(store, runtime.data, { assertActive() {}, cancelWork() {}, retry() {}, queueWork: (input, id, inputs) => runtime.queueWork(input, id, 'chatgpt-codex', inputs) }, () => {}).definitions(runtime.data.job(jobID));
    approved = actions.find(t => t.name === 'write_artifact').execute({ title: '已批准的方案', body: '请交付这份方案的完整正文。' });
    unrelated = actions.find(t => t.name === 'write_artifact').execute({ title: '其他客户方案', body: '不能读取此内容。' });
    assert.ok(actions.find(t => t.name === 'request_decisions'), 'Main may request missing facts while coordinating cards');
    actions.find(t => t.name === 'start_work').execute({ strategy_id: store.snapshot().strategies[0].id, title: '交付客户方案', instructions: '交付已批准的方案。', artifact_ids: [approved.id] });
    runtime.data.setJob(jobID, 'completed'); runtime.pump();
    await wait(() => received && denied && runtime.active.size === 0);
    assert.equal(received.isError, undefined, received.content[0].text);
    assert.equal(JSON.parse(received.content[0].text).body, '请交付这份方案的完整正文。');
    assert.equal(denied.isError, true);
    const job = store.query("SELECT j.id FROM agent_job j JOIN agent_work w ON w.id=j.workID WHERE w.title='交付客户方案'")[0];
    assert.deepEqual(runtime.data.inputs(runtime.data.job(job.id)).artifactIDs, [approved.id]);
  });
});

function pendingCard(runtime, store, title, inputs = {}) {
  const strategyID = store.snapshot().strategies[0].id, work = runtime.data.createWork(strategyID, title, title);
  store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?", `prepare:${work.id}`, work.id);
  const card = store.mutate('decision', 'submit', undefined, { requestID: randomUUID(), strategyID, title, body: title, inputs, options: [{ id: 'yes', label: '执行' }, { id: 'no', label: '暂缓' }] });
  runtime.data.setWork(work.id, 'waiting_decision', '', card.id); return card;
}
test('confirmed cards pass explicit artifacts through main coordination into scoped work',()=>{
 const started=[];let artifactID;
 return fixture(async(options,text,runtime)=>{
  options.onRun('run');const job=runtime.data.job(options.mcp.env.POLARIS_REQUEST_ID);
  if(job.kind==='main'){
   const {decision}=JSON.parse(job.input);
   await tool(options,'start_work',{strategy_id:decision.strategyID,title:decision.title,instructions:decision.body,artifact_ids:decision.inputs?.artifactIDs??[]});
  }else{
   const title=runtime.data.work(job.workID).title;started.push(title);
   if(title==='Prepare report')artifactID=(await tool(options,'write_artifact',{title:'Report',body:'Approved source'})).id;
   else assert.equal((await tool(options,'read_artifact',{id:artifactID})).body,'Approved source');
  }
  return {status:'completed'};
 },async({runtime,store})=>{
  const first=pendingCard(runtime,store,'Prepare report');store.decide(first.id,'yes','',first.version);
  await wait(()=>runtime.active.size===0&&artifactID);
  const second=pendingCard(runtime,store,'Use report',{artifactIDs:[artifactID]});store.decide(second.id,'yes','',second.version);
  await wait(()=>runtime.active.size===0&&started.length===2);assert.deepEqual(started,['Prepare report','Use report']);
 });
});

test('unreviewed failures remain reachable beyond 200 newer deliveries', () => fixture(async () => ({ status: 'completed' }), async ({ runtime, store }) => {
  const ended = (state) => {
    const work = runtime.data.createWork(store.snapshot().strategies[0].id, '报告', '交付报告'), id = runtime.queueWork(work.instructions, work.id);
    runtime.data.setJob(id, 'running');
    if (state === 'completed') {
      const artifact = randomUUID(); store.query('INSERT INTO agent_artifact(id,workID,jobID,title,body) VALUES(?,?,?,?,?)', artifact, work.id, id, '报告', '报告正文');
    }
    runtime.data.setJob(id, state); runtime.data.setWork(work.id, state, ''); runtime.data.runs.finish(id); return id;
  };
  const failed = ended('failed');
  for (let i = 0; i < 201; i++) { ended('completed'); }
  for (let i = 0; i < 7; i++) ended('completed');
  const results = runtime.data.executions.results();
  assert.ok(results.some(item => item.jobID === failed && item.kind === 'attention'));
  assert.equal(results.filter(item => item.kind === 'done').length, 0);
}));
test('required knowledge must be linked before dispatch and missing links hold unsent work', () => fixture(async () => ({ status: 'completed' }), async ({ runtime, store }) => {
  runtime.connections.get('chatgpt-codex').connected = false;
  const strategy = store.snapshot().strategies[0];
  const doc = runtime.data.knowledge.save({ title: '客户背景', category: '客户', body: '当前产品信息', tags: [], aliases: [], sources: ['用户资料'], goalIDs: [], expectedVersion: 0, requestID: randomUUID() });
  assert.throws(() => pendingCard(runtime, store, '读取资料', { knowledgeIDs: [doc.id] }), e => e.messageKey === 'execution.inputMissing');
  const linked = runtime.data.knowledge.save({ ...doc, goalIDs: [strategy.goalID], expectedVersion: 1, requestID: randomUUID() });
  const card = pendingCard(runtime, store, '读取已关联资料', { knowledgeIDs: [doc.id] });
  const unlinked = runtime.data.knowledge.save({ ...linked, goalIDs: [], expectedVersion: linked.version, requestID: randomUUID() });
  assert.throws(() => store.decide(card.id, 'yes', '', card.version), e => e.messageKey === 'execution.inputMissing');
  assert.equal(store.outcomes().some(outcome => outcome.decisionID === card.id), false);
  assert.equal(store.get('decision', card.id).version, card.version);
  const relinked = runtime.data.knowledge.save({ ...unlinked, goalIDs: [strategy.goalID], expectedVersion: unlinked.version, requestID: randomUUID() });
  const outcome = store.decide(card.id, 'yes', '', card.version);
  const job = runtime.data.job(store.query('SELECT id FROM agent_job WHERE outcomeID=?', outcome.id)[0].id);
  assert.equal(runtime.data.inputStatus(job).ready, true);
  runtime.data.knowledge.save({ ...relinked, goalIDs: [], expectedVersion: relinked.version, requestID: randomUUID() });
  assert.equal(runtime.data.inputStatus(job).ready, false);
  assert.equal(runtime.data.inputStatus(job).missing[0].kind, 'knowledge');
}));

test('every newly confirmed card queues one built-in task, while past unassigned outcomes stay historical', () => fixture(async (options) => {
  options.onRun('run'); return { status: 'completed' };
}, async ({ runtime, store }) => {
  const first = store.snapshot().decisions.find(item => !item.outcome);
  const onOutcome = store.onOutcome;
  store.onOutcome = undefined;
  const historical = store.decide(first.id, first.options[0].id, '', first.version);
  store.onOutcome = onOutcome;
  runtime.pump();
  assert.equal(store.query('SELECT id FROM agent_job WHERE outcomeID=?', historical.id).length, 0);
  const next = store.snapshot().decisions.find(item => !item.outcome);
  assert.throws(() => store.decide(next.id, 'invalid', '', next.version), { code: 'invalid_input' });
  assert.equal(store.query('SELECT 1 FROM decision_source WHERE decisionID=?',next.id).length,0);
  const approved = store.decide(next.id, next.options[0].id, '', next.version);
  await wait(() => runtime.active.size === 0 && !!store.query("SELECT 1 FROM agent_job WHERE outcomeID=? AND state='completed'", approved.id).length);
  assert.equal(store.query('SELECT provider FROM agent_job WHERE outcomeID=?', approved.id)[0].provider, 'chatgpt-codex');
  assert.equal(store.query("SELECT COUNT(*) AS n FROM agent_job WHERE origin<>'auto_advance'")[0].n, 1);
  assert.equal(store.query("SELECT COUNT(*) AS n FROM agent_job WHERE origin='auto_advance'")[0].n, 1);
  assert.equal(store.outcomes().find(o => o.id === historical.id).acknowledgedAt, undefined);
}));

test('execution preparation distinguishes idle strategies and pending decisions without creating work', () => fixture(async () => ({ status: 'completed' }), async ({ runtime, store }) => {
  const strategy = store.get('strategy', 'warmup');
  const goal = store.get('goal', strategy.goalID);
  const before = store.query('SELECT count(*) AS n FROM agent_job')[0].n;
  assert.equal(runtime.executionPlan(goal.id).items.find(item => item.id === strategy.id).phase, 'stalled');
  const other = pendingCard(runtime, store, '等待选择');
  assert.equal(runtime.executionPlan().items.find(item => item.id === other.strategyID).phase, 'cards');
  assert.equal(store.query('SELECT count(*) AS n FROM agent_job')[0].n, before);
}));

test('superseded work cannot be dismissed or block its strategy', () => fixture(async () => ({ status: 'completed' }), async ({ runtime, store }) => {
  const work = runtime.data.createWork(store.snapshot().strategies[0].id, '多个回合的任务', '交付结果');
  const first = runtime.data.queue('work', '首次执行', work.id), second = runtime.data.queue('work', '回答后继续', work.id), session = `task:${first}`;
  store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?", session, work.id);
  for (const id of [first, second]) { store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=?,generation=1 WHERE id=?", session, id); runtime.data.setJob(id, 'completed'); runtime.data.runs.finish(id); }
  assert.throws(() => runtime.data.executions.dismiss(work.id, first, 1), { code: 'conflict' });
  store.query("UPDATE agent_job SET sessionKey='superseded-task',state='failed' WHERE id=?", first);
  assert.notEqual(runtime.executionPlan().items.find(item => item.id === work.strategyID).phase, 'needs_review', 'An ended task superseded by a newer task does not become an unreviewable strategy blocker');
}));

test('a source task retains its title and pending cards without creating placeholder tasks',()=>fixture(async options=>{options.onRun('run');return {status:'completed'};},async({runtime,store})=>{
 const strategy=store.snapshot().strategies[0],work=runtime.data.createWork(strategy.id,'Research customers','Research');
 const jobID=runtime.queueWork(work.instructions,work.id);runtime.data.setJob(jobID,'running');
 const defs=new AgentActions(store,runtime.data,{assertActive(){}},()=>{}).definitions(runtime.data.job(jobID),runtime.data.work(work.id));
 const draft=defs.find(t=>t.name==='write_artifact').execute({title:'Drafts',body:'Approved contact drafts'});
 const card=title=>({strategy_id:strategy.id,issue_key:title,title,body:'Check this recipient.',excerpt:title,artifact_ids:[draft.id],options:[{id:'send',label:'Send'},{id:'skip',label:'Skip'}]});
 defs.find(t=>t.name==='request_decisions').execute({decisions:[card('A'),card('B'),card('C')]});
 assert.ok(defs.find(t=>t.name==='write_artifact').execute({title:'Summary',body:'Continued independent work'}).id);
 assert.equal(store.query('SELECT * FROM agent_work').length,1);assert.equal(runtime.data.decisionCards(runtime.data.work(work.id)).length,3);
 runtime.data.setJob(jobID,'completed');runtime.data.runs.finish(jobID);
 const chosen=store.snapshot().decisions.find(d=>d.title==='A'),outcome=store.decide(chosen.id,'send','',chosen.version);runtime.pump();
 await wait(()=>runtime.active.size===0);
 const execution=runtime.data.job(store.query('SELECT id FROM agent_job WHERE outcomeID=?',outcome.id)[0].id);
 assert.equal(execution.kind,'main');assert.equal(runtime.data.readArtifact(execution,draft.id).title,'Drafts');
 assert.equal(runtime.data.decisionCards(runtime.data.work(work.id)).length,2);const result=runtime.data.executions.results().find(r=>r.jobID===jobID);
 assert.equal(result,undefined);assert.equal(runtime.data.work(work.id).title,'Research customers');
}));

test('manual tasks see compact decisions already made under their strategy', () => fixture(async () => ({ status: 'completed' }), async ({ runtime, store }) => {
  const strategy = store.snapshot().strategies[0];
  const submit = title => store.mutate('decision', 'submit', undefined, { requestID: randomUUID(), strategyID: strategy.id, title, body: '很长的背景。'.repeat(200),
    options: [{ id: 'cn', label: '国内家具商家', detail: '' }, { id: 'global', label: '海外卖家', detail: '' }] });
  const decided = submit('首批商家先从哪个市场找？'); store.decide(decided.id, 'cn', '', decided.version); submit('是否联系甲');
  const work = runtime.data.createWork(strategy.id, '招募', '找下一批商家');
  const job = runtime.data.job(runtime.queueWork(work.instructions, work.id));
  const context=runtime.data.context(job), cards=context.board.decisions;
  assert.equal(cards.find(item=>item.id===decided.id).outcome.optionID,'cn');
  assert.ok(cards.some(item=>item.title==='是否联系甲'&&!item.outcome));
  assert.ok(context.board.strategies.every(item=>item.id===strategy.id));
  assert.equal(context.work.id,work.id);

}));

test('a resumed main session is not resent unchanged rules or board, but compaction and new native sessions restore them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-prompt-')), store = new PolarisStore(path.join(dir, 'test.sqlite')); seedDemo(store);
  const prompts = []; let native = 'thread-1', compactNext = false, goalContext;
  const goalID = store.snapshot().goals[0].id;
  const largeBody = 'Read this strategy only when needed. '.repeat(200);
  store.mutate('strategy', 'create', 'long-strategy', { requestID: randomUUID(), goalID, title: 'Long strategy', body: largeBody, origin: 'User' });
  const runtime = new AgentCoordinator(store, () => {}, (async options => {
    options.onSession(native);
    return { id: 'fixture', capabilities: emptyCapabilities(), cancel: async () => {}, close: async () => {}, prompt: async text => {
      options.onRun(randomUUID());
      if (runtime.data.job(options.mcp.env.POLARIS_REQUEST_ID).origin === 'auto_advance') return { status: 'completed' };
      prompts.push(text);
      if (text.endsWith('read the changed principle')) goalContext = await tool(options, 'get_context', { goal_id: goalID });
      if (compactNext) { compactNext = false; options.onEvent({ type: 'compaction', id: randomUUID() }); }
      return { status: 'completed' }; } };
  }));
  runtime.connections.set('chatgpt-codex', { provider: 'chatgpt-codex', connected: true, enabled: true, version: 'fixture', protocol: 'app-server', executable: 'mock', model: '', models: [], capabilities: emptyCapabilities(), verified: {} });
  const turn = async text => {
    const id = runtime.send(text); runtime.pump(); await wait(() => runtime.data.job(id).state === 'completed' && runtime.active.size === 0);
    const prompt = prompts.at(-1), metrics = runtime.data.runs.inspect(id).events.find(event => event.type === 'prompt').data;
    assert.equal(metrics.bytes, Buffer.byteLength(prompt));
    assert.equal(metrics.contextBytes === 0, prompt.includes('Unchanged since your previous turn'));
    return prompt;
  };
  const full = text => /You are working in Polaris/.test(text) && /Polaris business context:\n\{/.test(text);
  try {
    const first = await turn('first'); assert.ok(full(first));
    assert.match(first, /Long strategy/); assert.doesNotMatch(first, /Read this strategy only when needed/);
    let text = await turn('hi?');
    assert.match(text, /Polaris working rules: unchanged/); assert.match(text, /Polaris business context:\nUnchanged since your previous turn/);
    assert.match(text, /Current activity:\n\{/); assert.match(text, /Current time: /); assert.ok(text.length < 4000, `follow-up prompt stays small (${text.length})`);
    const goal=store.get('goal',goalID);store.mutate('goal','update',goalID,{requestID:randomUUID(),expectedVersion:goal.version,title:goal.title,milestone:goal.milestone,constraints:'只联系真实商家'});
    text = await turn('read the changed principle');
    assert.match(text, /Polaris working rules: unchanged/); assert.doesNotMatch(text, /只联系真实商家/);
    assert.equal(goalContext.board.goals[0].constraints, '只联系真实商家');
    assert.equal(goalContext.board.strategies.find(item => item.id === 'long-strategy').body, largeBody);
    assert.deepEqual(goalContext.board.goals.map(item => item.id), [goalID]);
    compactNext = true; await turn('compact during this turn');
    assert.ok(full(await turn('after compaction')), 'Compaction may drop earlier rules, so they are sent again.');
    native = 'thread-2'; assert.ok(full(await turn('new native thread')), 'A new native session has not seen the rules.');
  } finally { await runtime.stop(); store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('run_strategies starts one fresh round per strategy and never duplicates a running or waiting round', () => fixture(async () => new Promise(() => {}), async ({ runtime, store }) => {
  const [a, b, c] = store.snapshot().strategies;
  const defs = () => new AgentActions(store, runtime.data, { assertActive() {}, cancelWork() {}, retry() {}, language: 'zh-Hans', queueWork: (input, id, inputs) => runtime.queueWork(input, id, 'chatgpt-codex', inputs) }, () => {})
    .definitions(runtime.data.job(runtime.data.send('都跑一遍吧')), undefined).find(t => t.name === 'run_strategies');
  const card = runtime.data.createWork(c.id, '已批准的卡片执行', '执行'); const cardJob = runtime.queueWork('执行', card.id); store.query("UPDATE agent_job SET outcomeContextID='x' WHERE id=?", cardJob);
  const first = defs().execute({ strategy_ids: [a.id, b.id, a.id, c.id], note: '核实旧草稿后再找新商家' });
  assert.deepEqual(first.map(item => item.status), ['started', 'started', 'started'], 'Duplicates collapse; card executions do not block a strategy round.');
  const work = runtime.data.work(first[0].workID);
  assert.equal(work.title, a.title); assert.match(work.instructions, new RegExp(`继续推进策略：${a.title}`)); assert.match(work.instructions, /核实旧草稿/);
  assert.notEqual(work.sessionKey, runtime.data.work(first[1].workID).sessionKey);
  store.query("UPDATE agent_job SET state='waiting_connection' WHERE workID=?", first[1].workID);
  const again = defs().execute({ strategy_ids: [a.id, b.id] });
  assert.deepEqual(again.map(item => [item.status, item.workID]), [['already_running', first[0].workID], ['already_running', first[1].workID]]);
  store.query("UPDATE agent_job SET state='completed' WHERE workID=?", first[0].workID);
  const next = defs().execute({ strategy_ids: [a.id], note: '下一轮' })[0];
  assert.equal(next.status, 'started'); assert.notEqual(next.workID, first[0].workID, 'A finished round is never resumed; the next round is fresh.');
}));

test('auto advance waits for the last decision handoff and a round with no card stays idle', async () => {
  let release, strategyID;
  const handoff = new Promise(resolve => { release = resolve; });
  await fixture(async (options, _prompt, runtime) => {
    options.onRun('run');
    const job = runtime.data.job(options.mcp.env.POLARIS_REQUEST_ID);
    if (job.outcomeID && JSON.parse(job.input).decision.title === 'Last decision') await handoff;
    return { status: 'completed' };
  }, async ({ runtime, store }) => {
    const strategy = store.mutate('strategy', 'create', undefined, { requestID: randomUUID(), goalID: store.snapshot().goals[0].id,
      title: 'Test strategy', body: 'Research the next step', origin: 'User' });
    strategyID = strategy.id;
    const card = title => store.mutate('decision', 'submit', undefined, { requestID: randomUUID(), strategyID, title, body: 'Choose how to proceed.', options: [{ id: 'go', label: 'Go' }] });
    const first = card('First decision'), last = card('Last decision');
    const rounds = () => store.query("SELECT * FROM agent_job WHERE origin='auto_advance'");
    runtime.pump();
    try {
      assert.equal(rounds().length, 0);
      const firstOutcome = store.decide(first.id, 'go', '', first.version);
      await wait(() => store.query('SELECT state FROM agent_job WHERE outcomeID=?', firstOutcome.id)[0]?.state === 'completed');
      assert.equal(rounds().length, 0);
      const lastOutcome = store.decide(last.id, 'go', '', last.version);
      await wait(() => store.query('SELECT state FROM agent_job WHERE outcomeID=?', lastOutcome.id)[0]?.state === 'running');
      assert.equal(runtime.loopStates()[strategyID].state, 'running');
      runtime.pump();
      assert.equal(rounds().length, 0);
      release();
      await wait(() => rounds()[0]?.state === 'completed');
      runtime.pump(); runtime.pump();
      assert.equal(rounds().length, 1);
      assert.equal(runtime.loopStates()[strategyID].state, 'stalled');
      assert.equal(runtime.schedules.snapshot(strategyID).tasks.length, 0);
    } finally { release(); }
  });
});

test('existing and new active strategies prepare cards by default and retain consumed rounds across restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-default-cards-'));
  const file = path.join(dir, 'test.sqlite');
  let store = new PolarisStore(file), runtime;
  const goal = store.mutate('goal', 'create', undefined, { requestID: randomUUID(), title: 'Default research', milestone: 'Choose an approach', symbol: 'Target' });
  const create = title => store.mutate('strategy', 'create', undefined, { requestID: randomUUID(), goalID: goal.id, title, body: 'Research choices', origin: 'User' });
  const existing = create('Existing strategy'), archived = create('Archived strategy');
  store.mutate('strategy', 'archive', archived.id, { requestID: randomUUID(), expectedVersion: archived.version });
  store.close();
  store = new PolarisStore(file);
  const openRuntime = () => new AgentCoordinator(store, () => {}, async options => {
    options.onSession(randomUUID());
    return { id: 'default-cards', capabilities: emptyCapabilities(), cancel: async () => {}, close: async () => {}, prompt: async () => {
      options.onRun(randomUUID());
      return { status: 'completed' };
    } };
  });
  const rounds = () => store.query("SELECT w.strategyID,j.state FROM agent_job j JOIN agent_work w ON w.id=j.workID WHERE j.origin='auto_advance'");
  try {
    runtime = openRuntime();
    runtime.connections.set('chatgpt-codex', { provider: 'chatgpt-codex', connected: true, enabled: true, version: 'fixture', protocol: 'app-server', executable: 'mock', model: '', models: [], capabilities: emptyCapabilities(), verified: {} });
    runtime.startScheduling();
    await wait(() => rounds().length === 1 && rounds()[0].state === 'completed');
    assert.equal(rounds()[0].strategyID, existing.id);
    const added = create('New strategy');
    runtime.pump();
    await wait(() => rounds().length === 2 && rounds().every(job => job.state === 'completed'));
    assert.deepEqual(new Set(rounds().map(job => job.strategyID)), new Set([existing.id, added.id]));
    await runtime.stop();
    store.close(); store = new PolarisStore(file); runtime = openRuntime();
    runtime.startScheduling(); runtime.pump();
    assert.equal(rounds().length, 2, 'Reopening an unchanged empty column must not repeat research');
  } finally {
    await runtime?.stop(); store.close(); await rm(dir, { recursive: true, force: true });
  }
});

test('decision preparation adds several cards and can run alongside delegated execution', async () => {
  let strategyID, roundFailure, releaseExecution, preparationRounds = 0;
  const execution = new Promise(resolve => { releaseExecution = resolve; });
  await fixture(async (options, prompt, runtime) => {
    options.onRun('run');
    const job = runtime.data.job(options.mcp.env.POLARIS_REQUEST_ID);
    if (job.origin === 'auto_advance' && ++preparationRounds === 1) {
      const decision = { strategy_id: strategyID, body: 'The answer changes what we research.', options: [{ id: 'go', label: 'Go' }] };
      try {
        assert.match(prompt, /Task instructions:\nPrepare the next decision cards/);
        assert.doesNotMatch(prompt, /User request:\nPrepare the next decision cards/);
        assert.match(prompt, /use the language of the goal and strategy/);
        await tool(options, 'request_decisions', { decisions: ['channel', 'region', 'offer'].map(issue => ({ ...decision, issue_key: issue, title: `Choose ${issue}` })) });
        const actions = new AgentActions(runtime.store, runtime.data, { assertActive() {} }, () => {}).definitions(job, runtime.data.work(job.workID));
        const request = actions.find(action => action.name === 'request_decisions');
        assert.throws(() => request.execute({ decisions: [{ ...decision, issue_key: 'timing', title: 'Pick a time' }] }), { code: 'conflict', message: /decision card limit/ });
        assert.ok(!actions.some(action => ['manage_scheduled_task', 'start_work', 'write_knowledge'].includes(action.name)));
      } catch (error) { roundFailure = error; throw error; }
    }
    if (job.outcomeID && JSON.parse(job.input).decision.title === 'Choose offer')
      await tool(options, 'start_work', { strategy_id: strategyID, title: 'Apply choice', instructions: 'Follow the selected channel' });
    if (job.input === 'Follow the selected channel') await execution;
    return { status: 'completed' };
  }, async ({ runtime, store }) => {
    strategyID = store.mutate('strategy', 'create', undefined, { requestID: randomUUID(), goalID: store.snapshot().goals[0].id,
      title: 'Automatic progress test', body: 'Research available channels', origin: 'User' }).id;
    runtime.pump();
    const rounds = () => store.query("SELECT * FROM agent_job WHERE origin='auto_advance'");
    try {
      await wait(() => ['completed', 'failed'].includes(rounds()[0]?.state));
      if (roundFailure) throw roundFailure;
      assert.equal(rounds()[0].state, 'completed');
      const cards = store.snapshot().decisions.filter(card => card.strategyID === strategyID);
      assert.equal(cards.length, 3);
      for (const card of cards) store.decide(card.id, 'go', '', card.version);
      await wait(() => rounds()[1]?.state === 'completed');
      assert.equal(store.query("SELECT state FROM agent_job WHERE input='Follow the selected channel'")[0]?.state, 'running');
      runtime.pump();
      assert.equal(rounds().length, 2);
      const actions = new AgentActions(store, runtime.data, { assertActive() {} }, () => {}).definitions(rounds()[1], undefined);
      assert.ok(!actions.some(action => action.name === 'set_strategy_auto_advance'));
    } finally { releaseExecution(); }
  });
});

test('platforms without compaction events keep receiving the full rules and board', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-prompt-acp-')), store = new PolarisStore(path.join(dir, 'test.sqlite')); seedDemo(store);
  const prompts = [];
  const runtime = new AgentCoordinator(store, () => {}, (async options => { options.onSession('acp-thread');
    return { id: 'fixture', capabilities: emptyCapabilities(), cancel: async () => {}, close: async () => {}, prompt: async text => { prompts.push(text); options.onRun(''); return { status: 'completed' }; } }; }));
  runtime.connections.set('claude-code', { provider: 'claude-code', connected: true, enabled: true, version: 'fixture', protocol: 'acp', executable: 'mock', model: '', models: [], capabilities: emptyCapabilities(), verified: {} });
  runtime.select('claude-code');
  try {
    for (const text of ['first', 'hi?']) { const id = runtime.send(text); runtime.pump(); await wait(() => runtime.data.job(id).state === 'completed' && runtime.active.size === 0); }
    assert.match(prompts.at(-1), /You are working in Polaris/); assert.match(prompts.at(-1), /Polaris business context:\n\{/); assert.match(prompts.at(-1), /Current activity:\n\{/);
  } finally { await runtime.stop(); store.close(); await rm(dir, { recursive: true, force: true }); }
});
