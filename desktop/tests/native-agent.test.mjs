import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { readFileSync as readFileSyncForTest } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { createBusinessMCP } from '../dist-service/agent-mcp.js';
import { connectACP } from '../dist-service/agents/acp.js';
import { compatibleVersion, inspectConnection } from '../dist-service/agents/discovery.js';
import { nativeEnvironment } from '../dist-service/agents/rpc.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
const executable = fileURLToPath(new URL('./fixtures/native-agent.mjs', import.meta.url));
const wait = async predicate => { const end = Date.now()+10000; while (!predicate() && Date.now()<end) await new Promise(r=>setTimeout(r,20)); assert.ok(predicate(), 'native run timed out'); };
const connection = (provider = 'chatgpt-codex') => ({ provider, label: 'Fixture', installed: true, executable, version:'0.162.1', compatible:true, protocol:provider === 'chatgpt-codex'?'app-server':'acp', protocolReady:true, authenticated:true, connected:true, enabled:true, account:'fixture', error:'', instructions:'', model:'', models:[], capabilities:{...emptyCapabilities(), resume:true, nativeCommands:[{name:'compact',description:'Compact'}]}, verified:{turn:false,tools:false,resume:false,cancel:false} });
async function fixture(fn) {
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-native-test-')); const store=new PolarisStore(path.join(dir,'db.sqlite')); seedDemo(store);
 const runtime=new AgentCoordinator(store); runtime.connections.set('chatgpt-codex',connection());
 try { await fn(runtime,store,dir); } finally { await runtime.stop(); store.close(); await rm(dir,{recursive:true,force:true}); }
}
test('native version checks and API billing environment isolation',()=>{
 assert.equal(compatibleVersion('gemini-cli','0.66.0'),true); assert.equal(compatibleVersion('gemini-cli','0.65.0'),false); assert.equal(compatibleVersion('gemini-cli','0.67.0'),false);
 process.env.OPENAI_API_KEY='must-not-propagate'; process.env.GEMINI_API_KEY='must-not-propagate';
 assert.equal(nativeEnvironment().OPENAI_API_KEY,undefined); assert.equal(nativeEnvironment().GEMINI_API_KEY,undefined);
 delete process.env.OPENAI_API_KEY;delete process.env.GEMINI_API_KEY;
});
test('scoped MCP rejects stale generations and invalid arguments',async()=>{
 let valid=true,calls=0;
 const server=await createBusinessMCP([{name:'write',description:'Write',parameters:z.object({value:z.string()}),execute:()=>++calls}],()=>{if(!valid)throw new Error('stale');},()=>{});
 const send=async args=>(await (await fetch(server.endpoint,{method:'POST',headers:{authorization:`Bearer ${server.token}`},body:JSON.stringify({id:1,method:'tools/call',params:{name:'write',arguments:args}})})).json()).result;
 try { assert.equal((await send({value:'ok'})).isError,undefined); valid=false;assert.equal((await send({value:'late'})).isError,true);assert.equal(calls,1); assert.equal((await fetch(server.endpoint,{method:'POST',body:'{}'})).status,403); } finally {await server.close();}
});
test('native Codex subprocess uses scoped MCP, retains phase, and resumes the same session',async()=>fixture(async(runtime,store)=>{
 await runtime.chooseModel('chatgpt-codex','');
 const id=runtime.send('artifact-fixture'); await wait(()=>runtime.data.job(id).state==='completed'); await wait(()=>runtime.active.size===0);
 assert.equal(store.query('SELECT body FROM agent_artifact')[0].body,'Native MCP result');
 const message=runtime.data.snapshot().messages.at(-1); assert.equal(message.provider,'chatgpt-codex');assert.equal(message.parts[0].phase,'final_answer');assert.equal(message.body,'Native fixture completed.');
 const second=runtime.send('continue');await wait(()=>runtime.data.job(second).state==='completed');await wait(()=>runtime.active.size===0);
 assert.equal(store.query('SELECT nativeSessionID FROM agent_session WHERE id=?',runtime.data.job(id).sessionKey)[0].nativeSessionID,'native-session');
 assert.equal(runtime.connections.get('chatgpt-codex').verified.resume,true);
}));
test('decision cards keep the turn running and each runs once in a fresh native task',async()=>fixture(async(runtime,store)=>{
 // R-D173: decision cards come from a strategy round, not the main conversation.
 const work=runtime.data.createWork(store.snapshot().strategies[0].id,'Route task','decision-fixture'),first=runtime.queueWork(work.instructions,work.id);runtime.pump();await wait(()=>runtime.data.job(first).state==='completed');
 const decision=store.snapshot().decisions.find(item=>item.title==='Choose a route');assert.ok(decision);
 assert.equal(decision.excerpt,'Route A draft');assert.equal(decision.recommendedOptionID,'a');assert.equal(decision.options[0].detail,'First route');
 assert.ok(store.snapshot().decisions.some(item=>item.title==='Choose a channel'),'A later batch in the same turn is saved.');
 assert.equal(store.query("SELECT 1 FROM agent_artifact WHERE title='After cards'").length,1);
 store.decide(decision.id,'a','',decision.version);runtime.pump();
 await wait(()=>store.query("SELECT state FROM agent_job WHERE outcomeID IS NOT NULL")[0]?.state==='completed');
 assert.equal(store.query('SELECT count(*) AS n FROM agent_job WHERE outcomeID IS NOT NULL')[0].n,1);
 const jobs=store.query('SELECT sessionKey FROM agent_job');assert.notEqual(jobs[0].sessionKey,jobs[1].sessionKey);
}));
test('cancel waits for a native completion; unknown delivery is never replayed',async()=>fixture(async(runtime,store)=>{
 const id=runtime.send('hold-fixture');await wait(()=>runtime.data.job(id).delivery==='accepted');await runtime.cancel(id);await wait(()=>runtime.data.job(id).state==='cancelled');
 const lost=runtime.send('disconnect-fixture');await wait(()=>runtime.data.job(lost).state==='needs_review');assert.throws(()=>runtime.retry(lost));
 const next=runtime.send('continue');await wait(()=>runtime.data.job(next).state==='failed');assert.equal(runtime.data.job(next).error,'native_delivery_unknown');
 runtime.newSession();const fresh=runtime.send('fresh');await wait(()=>runtime.data.job(fresh).state==='completed');
}));
test('old execution records are readable history and never enter the native queue', () => fixture(async (runtime, store) => {
  const data = new AgentStore(store);
  const old = data.send('Retired executor input');
  data.message(old, 'Historical reply', 'interrupted');
  store.query("UPDATE agent_job SET state='running' WHERE id=?", old);
  const strategy = store.snapshot().strategies[0], work = data.createWork(strategy.id, 'Retired task', 'Old authorization');
  const queued = data.queue('work', work.instructions, work.id);
  assert.equal(data.activeStrategyWork(strategy.id), undefined);
  runtime.pump();
  assert.equal(runtime.active.size, 0);
  assert.equal(data.job(old).state, 'running');
  assert.equal(data.job(queued).state, 'queued');
  assert.ok(runtime.conversation().messages.some(message => message.body === 'Historical reply'));
  assert.ok(!runtime.conversation().jobs.some(job => job.id === old));
  assert.throws(() => runtime.retry(queued), { code: 'conflict' });
  await assert.rejects(runtime.cancel(old), { code: 'not_found' });
  const current = runtime.send('Native request');
  await wait(() => runtime.data.job(current).state === 'completed');
  const original = data.job(current);
  runtime.select('claude-code');
  assert.equal(runtime.send('Native request', current.toUpperCase()), current);
  assert.equal(data.job(current).sessionKey, original.sessionKey);
}));
test('Codex steers a live turn and does not replay a lost steering receipt',async()=>fixture(async(runtime,store)=>{
 const first=runtime.send('hold-fixture');await wait(()=>runtime.data.job(first).delivery==='accepted');
 const input=runtime.send('finish-steer-fixture');await wait(()=>runtime.active.size===0);
 assert.equal(runtime.data.job(first).state,'completed');assert.equal(runtime.data.job(input),undefined);
 assert.equal(store.query('SELECT state FROM agent_message WHERE id=?',`${input}:user`)[0].state,'accepted');
 const second=runtime.send('hold-fixture');await wait(()=>runtime.data.job(second).delivery==='accepted');
 const request=randomUUID();runtime.send('lost-steer-fixture',request);await wait(()=>runtime.active.size===0);
 assert.equal(runtime.data.job(second).state,'needs_review');assert.equal(store.query('SELECT state FROM agent_message WHERE id=?',`${request}:user`)[0].state,'unknown');
 runtime.send('lost-steer-fixture',request);assert.equal(runtime.data.job(request),undefined);
}));
test('warm Codex turns replace the MCP scope and never write under the earlier job',async()=>fixture(async(runtime,store)=>{
 const first=runtime.send('artifact-fixture');await wait(()=>runtime.active.size===0&&runtime.data.job(first).state==='completed');
 const second=runtime.send('artifact-fixture');await wait(()=>runtime.active.size===0&&runtime.data.job(second).state==='completed');
 assert.deepEqual(store.query('SELECT jobID FROM agent_artifact ORDER BY rowid').map(r=>r.jobID),[first,second]);
 assert.equal(runtime.idle.size,1);const rpc=[...runtime.idle.values()][0].rpc;
 await runtime.stop();assert.equal(runtime.idle.size,0);assert.equal(rpc.alive,false);
}));
test('ACP subprocess preserves unknown phase and declared native compress command',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'polaris-acp-test-'));
 const events=[];let session;
 try { session=await connectACP({connection:connection('gemini-cli'),cwd:directory,mcp:{command:'',args:[],env:{}},onSession:()=>{},onRun:()=>{},onEvent:event=>events.push(event),permission:async()=>''});
 assert.equal(session.capabilities.nativeCommands[0].name,'compress');assert.equal((await session.prompt('hello')).status,'completed');
 assert.equal(events.find(item=>item.type==='text').phase,undefined);
 } finally {await session?.close();await rm(directory,{recursive:true,force:true});}
});

test('Codex full access covers ordinary tools on new and resumed sessions',async()=>fixture(async(runtime,store,directory)=>{
 const file=await variant(directory,'codex-permissions'),trace=path.join(directory,'wire.jsonl');
 await writeFile(file+'.json',JSON.stringify({trace}));runtime.connections.set('chatgpt-codex',{...connection(),executable:file});
 for(let i=0;i<2;i++){
  const id=runtime.send('permission-fixture');await wait(()=>runtime.active.size===0&&runtime.data.job(id).state==='completed');
  assert.equal(runtime.snapshot().permissions.length,0);
 }
 const wire=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
 assert.deepEqual(wire.map(v=>v.method),['thread/start','thread/unsubscribe','thread/resume','thread/unsubscribe']);
 assert.equal(wire[0].excludeTurns,undefined);assert.equal(wire[2].excludeTurns,true);
 assert.equal(new Set(wire.map(v=>v.pid)).size,1,'The idle process is reused.');
 for(const request of wire.filter(v=>v.method!=='thread/unsubscribe')){assert.equal(request.approvalPolicy,'never');assert.equal(request.sandbox,'danger-full-access');assert.equal(request.mcpApproval,'approve');}
}));
test('native mandatory approval still waits for the exact user selection',async()=>fixture(async runtime=>{
 const id=runtime.send('forced-permission-fixture');await wait(()=>runtime.snapshot().permissions.length===1);
 assert.equal(runtime.data.job(id).state,'running');const request=runtime.snapshot().permissions[0];
 assert.equal(request.options.find(option=>option.id==='accept').labelKey,'permissions.allowOnce');
 assert.equal(request.title,'Allow Polaris get_context?','Provider-authored content stays intact.');
 assert.throws(()=>runtime.permission(request.id,'acceptForSession'));runtime.permission(request.id,'accept');
 await wait(()=>runtime.data.job(id).state==='completed');assert.equal(runtime.snapshot().permissions.length,0);
}));
test('unsupported native input receives an error and the Agent can reply in chat',async()=>fixture(async runtime=>{
 const id=runtime.send('question-fixture');
 await wait(()=>runtime.data.job(id).state==='completed'&&runtime.active.size===0);
 assert.equal(runtime.snapshot().permissions.length,0);
 assert.equal(runtime.conversation().messages.at(-1).body,'Which route?');
}));

test('ACP applies declared full access on new and loaded sessions, with read-only probes',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'polaris-acp-permissions-'));
 const priorTest=process.env.POLARIS_TEST,priorAgents=process.env.POLARIS_TEST_NATIVE_AGENTS;
 try {for(const provider of ['claude-code','gemini-cli']){
  const file=await variant(directory,provider),trace=path.join(directory,provider+'.jsonl');await writeFile(file+'.json',JSON.stringify({trace}));
  process.env.POLARIS_TEST='1';process.env.POLARIS_TEST_NATIVE_AGENTS=JSON.stringify({[provider]:file});
  const conn={...connection(provider),executable:file};await inspectConnection({...conn});
  for(const sessionID of [undefined,'native-session']){
   let session;const events=[],pending=[];
   try {
    session=await connectACP({connection:conn,sessionID,cwd:directory,mcp:{command:'',args:[],env:{}},onSession:()=>{},onRun:()=>{},onEvent:e=>events.push(e),permission:request=>new Promise(resolve=>pending.push({request,resolve}))});
    assert.equal((await session.prompt('permission-fixture')).status,'completed');assert.equal(pending.length,0);
    const forced=session.prompt('forced-permission-fixture');await wait(()=>pending.length===1);
    assert.equal(pending[0].request.options.find(option=>option.id==='accept').labelKey,'permissions.allowOnce');
    assert.equal(pending[0].request.options.find(option=>option.id==='decline').labelKey,'permissions.decline');
    pending[0].resolve('accept');assert.equal((await forced).status,'completed');
    assert.equal(events.find(e=>e.data?.permissionMode)?.data.permissionMode,provider==='claude-code'?'bypassPermissions':'yolo');
   }finally{await session?.close();}
  }
  const wire=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(wire.map(v=>v.method),['session/new','session/new','session/set_mode','session/load','session/set_mode']);
  assert.equal(wire[0].args.includes('--approval-mode=yolo'),false);
  for(const request of [wire[1],wire[3]])assert.equal(request.args.includes('--approval-mode=yolo'),provider==='gemini-cli');
  for(const request of [wire[2],wire[4]])assert.equal(request.modeId,provider==='claude-code'?'bypassPermissions':'yolo');
 }}finally{
  if(priorTest===undefined)delete process.env.POLARIS_TEST;else process.env.POLARIS_TEST=priorTest;
  if(priorAgents===undefined)delete process.env.POLARIS_TEST_NATIVE_AGENTS;else process.env.POLARIS_TEST_NATIVE_AGENTS=priorAgents;
  await rm(directory,{recursive:true,force:true});
 }
});
test('ACP respects unavailable or rejected native permission modes',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'polaris-acp-policy-'));let session;
 try {
  const file=await variant(directory,'gemini-policy'),trace=path.join(directory,'wire.jsonl'),requests=[];
  const options={connection:{...connection('gemini-cli'),executable:file},cwd:directory,mcp:{command:'',args:[],env:{}},onSession:()=>{},onRun:()=>{},onEvent:()=>{},permission:async request=>{requests.push(request);return 'accept';}};
  await writeFile(file+'.json',JSON.stringify({trace,noFullMode:true}));session=await connectACP(options);
  await session.prompt('permission-fixture');assert.equal(requests.length,1);await session.close();session=undefined;
  assert.equal((await readFile(trace,'utf8')).includes('session/set_mode'),false);
  await writeFile(file+'.json',JSON.stringify({rejectFullMode:true}));await assert.rejects(connectACP(options),/Mode restricted by native policy/);
 }finally{await session?.close();await rm(directory,{recursive:true,force:true});}
});

async function variant(directory, name) {
 const file=path.join(directory,name+'.mjs');await writeFile(file,`#!/usr/bin/env node
import ${JSON.stringify(new URL('./fixtures/native-agent.mjs',import.meta.url).href)};
`,{mode:0o755});return file;
}
test('ending a native run does not undo disconnect or a model change',async()=>fixture(async runtime=>{
 const first=runtime.send('hold-fixture');await wait(()=>runtime.data.job(first).delivery==='accepted');
 runtime.disconnect('chatgpt-codex');await wait(()=>runtime.active.size===0);
 assert.equal(runtime.snapshot().connections[0].connected,false);assert.equal(runtime.snapshot().connections[0].enabled,false);
 const next=connection();next.models=[{id:'second-model',name:'Second'}];runtime.saveConnection(next);
 const second=runtime.send('hold-fixture');await wait(()=>runtime.data.job(second).delivery==='accepted');
 await runtime.chooseModel('chatgpt-codex','second-model');await runtime.cancel(second);await wait(()=>runtime.active.size===0);
 assert.equal(runtime.snapshot().connections[0].model,'second-model');
}));
test('a run cannot restore the prior identity after a connection refresh',async()=>fixture(async(runtime,store,directory)=>{
 const oldTest=process.env.POLARIS_TEST,oldPath=process.env.POLARIS_TEST_NATIVE_CODEX;
 try {
  const id=runtime.send('hold-fixture');await wait(()=>runtime.data.job(id).delivery==='accepted');
  process.env.POLARIS_TEST='1';process.env.POLARIS_TEST_NATIVE_CODEX=await variant(directory,'different-account');
  await runtime.refresh('chatgpt-codex');assert.equal(runtime.snapshot().connections[0].account,'other@example.test');
  await runtime.cancel(id);await wait(()=>runtime.active.size===0);
  assert.equal(runtime.snapshot().connections[0].account,'other@example.test');assert.equal(runtime.snapshot().connections[0].verified.cancel,false);
 }finally{if(oldTest===undefined)delete process.env.POLARIS_TEST;else process.env.POLARIS_TEST=oldTest;if(oldPath===undefined)delete process.env.POLARIS_TEST_NATIVE_CODEX;else process.env.POLARIS_TEST_NATIVE_CODEX=oldPath;}
}));
test('background sources stay independent when card outcomes are coordinated by main',async()=>fixture(async(runtime,store)=>{
 const first=runtime.send('combo-fixture');await wait(()=>store.query('SELECT count(*) n FROM decision_source')[0].n===2);
 await wait(()=>runtime.active.size===0);
 const main=runtime.data.job(first),a=store.query("SELECT * FROM agent_work WHERE title='Work A'")[0],b=store.query("SELECT * FROM agent_work WHERE title='Work B'")[0];
 assert.notEqual(a.sessionKey,main.sessionKey);assert.notEqual(a.sessionKey,b.sessionKey);assert.equal(store.query('SELECT count(*) n FROM agent_work')[0].n,2);
 const decision=store.snapshot().decisions.find(d=>d.title==='Decision A'),outcome=store.decide(decision.id,'a','',decision.version);runtime.pump();
 await wait(()=>store.query('SELECT state FROM agent_job WHERE outcomeID=?',outcome.id)[0]?.state==='completed');
 const coordinator=store.query('SELECT * FROM agent_job WHERE outcomeID=?',outcome.id)[0];assert.equal(coordinator.kind,'main');assert.equal(coordinator.sessionKey,main.sessionKey);
 assert.equal(runtime.data.executions.results().find(item=>item.workID===b.id),undefined);assert.equal(runtime.data.decisionCards(runtime.data.work(b.id)).length,1);assert.equal(store.query('SELECT sessionKey FROM agent_work WHERE id=?',a.id)[0].sessionKey,a.sessionKey);
}));
test('an old executor assignment stays historical when a new confirmation creates native work', () => fixture(async (runtime, store) => {
  const data = runtime.data, decision = store.snapshot().decisions.find(item => !item.outcome);
  const old = data.createWork(decision.strategyID, 'Old assignment', 'Preserve this history');
  data.setWork(old.id, 'waiting_decision', '', decision.id);
  const approved = store.decide(decision.id, decision.options[0].id, '', decision.version);
  const jobID = store.query('SELECT id FROM agent_job WHERE outcomeID=?', approved.id)[0].id;
  await wait(() => data.job(jobID).state === 'completed');
  assert.notEqual(data.job(jobID).workID, old.id);
  assert.equal(data.work(old.id).state, 'waiting_decision');
}));
test('ACP exposes declared models and applies both native model controls',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'polaris-acp-model-'));
 try {for(const executablePath of [executable,await variant(directory,'config-model')]){
  const conn={...connection('gemini-cli'),executable:executablePath,model:'second-model'};const events=[];
  const probed=await inspectConnection({...conn});assert.equal(probed.models.length,2);assert.equal(probed.capabilities.nativeCommands.length,3);
  const session=await connectACP({connection:conn,cwd:directory,mcp:{command:'',args:[],env:{}},onSession:()=>{},onRun:()=>{},onEvent:e=>events.push(e),permission:async()=>''});
  try{await session.prompt('model-fixture');assert.equal(events.find(e=>e.type==='text').text,'Native model: second-model');}finally{await session.close();}
 }}finally{await rm(directory,{recursive:true,force:true});}
});
test('ACP preserves native message IDs before considering local boundaries',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'polaris-acp-ids-'));const events=[];
 const session=await connectACP({connection:connection('gemini-cli'),cwd:directory,mcp:{command:'',args:[],env:{}},onSession:()=>{},onRun:()=>{},onEvent:e=>events.push(e),permission:async()=>''});
 try{await session.prompt('ids-fixture');assert.deepEqual(events.filter(e=>e.type==='text').map(e=>e.nativeID),['native-first','native-first','native-second']);}finally{await session.close();await rm(directory,{recursive:true,force:true});}
});
test('slow initialize and authentication processes are closed when their probe is aborted',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'polaris-slow-probe-'));
 try{for(const name of ['slow-init','slow-auth']){
  const file=await variant(directory,name),controller=new AbortController();const promise=inspectConnection({...connection('gemini-cli'),executable:file},controller.signal);
  await wait(()=>{try{return !!readFileSyncForTest(file+'.pid')}catch{return false}});controller.abort();await promise;
  const pid=Number(await readFile(file+'.pid','utf8'));await wait(()=>{try{process.kill(pid,0);return false;}catch{return true;}});
 }}finally{await rm(directory,{recursive:true,force:true});}
});

test('a slow provider probe leaves another platform running and shutdown closes the probe',async()=>fixture(async(runtime,store,directory)=>{
 const oldTest=process.env.POLARIS_TEST,oldPath=process.env.POLARIS_TEST_NATIVE_CODEX;
 try {
  runtime.connections.set('gemini-cli',connection('gemini-cli'));runtime.select('gemini-cli');
  const job=runtime.send('hold-fixture');await wait(()=>runtime.data.job(job).delivery==='sent');
  const file=await variant(directory,'slow-init-codex');process.env.POLARIS_TEST='1';process.env.POLARIS_TEST_NATIVE_CODEX=file;
  const refresh=runtime.refresh('chatgpt-codex');await wait(()=>{try{return !!readFileSyncForTest(file+'.pid')}catch{return false;}});
  assert.equal(runtime.data.job(job).state,'running');
  runtime.disconnect('chatgpt-codex');await refresh;assert.equal(runtime.data.job(job).state,'running');
  const previousPID=String(readFileSyncForTest(file+'.pid'));const again=runtime.connect('chatgpt-codex');await wait(()=>String(readFileSyncForTest(file+'.pid'))!==previousPID);
  const start=Date.now();await runtime.stop();await again;assert.ok(Date.now()-start<2500);
  assert.equal(runtime.active.size,0);assert.equal(runtime.probes.size,0);
 }finally{if(oldTest===undefined)delete process.env.POLARIS_TEST;else process.env.POLARIS_TEST=oldTest;if(oldPath===undefined)delete process.env.POLARIS_TEST_NATIVE_CODEX;else process.env.POLARIS_TEST_NATIVE_CODEX=oldPath;}
}));
test('stop closes a native run still waiting for initialization',async()=>fixture(async(runtime,store,directory)=>{
 runtime.connections.set('chatgpt-codex',{...connection(),executable:await variant(directory,'slow-init-run')});
 const id=runtime.send('hello');await wait(()=>{try{return !!readFileSyncForTest(path.join(directory,'slow-init-run.mjs.pid'));}catch{return false;}});
 const start=Date.now();await runtime.stop();assert.ok(Date.now()-start<2500);assert.equal(runtime.active.size,0);assert.equal(runtime.data.job(id).state,'queued','An unsent message waits for the next launch instead of being cancelled by quitting.');assert.equal(runtime.data.job(id).delivery,'not_sent');
}));

test('ACP commands keep their native argument string',async()=>fixture(async runtime=>{
 runtime.connections.set('gemini-cli',connection('gemini-cli'));runtime.select('gemini-cli');const id=runtime.send('/help detail');await wait(()=>runtime.data.job(id).state==='completed');
 assert.equal(runtime.data.snapshot().messages.find(m=>m.id===id+':assistant').body,'Native command arguments preserved');
}));

test('stream deltas do not persist connections and message writes stay throttled',async()=>fixture(async(runtime,store)=>{
 const writes={connection:0,message:0};const query=store.query.bind(store);
 store.query=(sql,...args)=>{if(sql.startsWith('INSERT INTO agent_connection'))writes.connection++;if(sql.startsWith('INSERT INTO agent_message'))writes.message++;return query(sql,...args);};
 let streamed=false,finish;const ending=new Promise(resolve=>{finish=resolve;});
 runtime.driver=async options=>{
  options.onSession('stream-session');
  const capabilities=structuredClone(options.connection.capabilities);
  return {id:'stream-session',capabilities,cancel:async()=>{},close:async()=>{},prompt:async()=>{
   options.onRun('stream-turn');
   const commands=[{name:'help',description:'Native help'}];capabilities.nativeCommands=commands;
   options.onEvent({type:'commands',data:commands});options.onEvent({type:'commands',data:structuredClone(commands)});
   capabilities.nativeCommands=[...commands,{name:'status',description:'Native status'}];options.onEvent({type:'commands',data:capabilities.nativeCommands});
   const models={models:[{id:'stream-model',name:'Stream model'}],modelControl:{method:'session/set_model'}};
   options.onEvent({type:'models',data:models});options.onEvent({type:'models',data:structuredClone(models)});
   const before={...writes};assert.equal(before.connection,3,'Only changed command/model observations are persisted.');
   options.onEvent({type:'tool',nativeID:'stream-tool',data:{type:'commandExecution'}});
   for(let i=0;i<150;i++){
    options.onEvent({type:'text',nativeID:'stream-message',text:'x'});
    options.onEvent({type:'tool',nativeID:'stream-tool',data:{outputDelta:'y'}});
   }
   assert.equal(writes.connection,before.connection,'300 text/output deltas must not write agent_connection.');
   assert.ok(writes.message-before.message<5,'Burst deltas must share the 50 ms message timer.');
   streamed=true;await ending;return{status:'completed'};
  }};
 };
 const id=runtime.send('stream fixture');await wait(()=>streamed);await new Promise(resolve=>setTimeout(resolve,70));
 assert.equal(writes.connection,3);assert.ok(writes.message<8);finish();
 await wait(()=>runtime.active.size===0);
 assert.equal(runtime.data.job(id).state,'completed');assert.equal(writes.connection,4,'Completion persists the changed verification state once.');
 const message=runtime.data.snapshot().messages.find(item=>item.id===id+':assistant');assert.equal(message.body,'x'.repeat(150));
 assert.equal(message.parts.find(part=>part.type==='activity').calls[0].output,'y'.repeat(150));
}));
test('quitting interrupts running work, and the next launch resumes it in the same native session',async()=>fixture(async(runtime,store)=>{
 const work=runtime.data.createWork(store.snapshot().strategies[0].id,'招募商家','hold-fixture');
 const id=runtime.queueWork('hold-fixture',work.id);runtime.pump();await wait(()=>runtime.data.job(id).delivery==='accepted');
 const session=runtime.data.job(id).sessionKey,nativeSession=store.query('SELECT nativeSessionID FROM agent_session WHERE id=?',session)[0].nativeSessionID;
 await runtime.stop();
 assert.equal(runtime.data.job(id).state,'cancelled');assert.equal(runtime.data.job(id).error,'app_quit');
 const resume=store.query("SELECT * FROM agent_job WHERE workID=? AND origin='resume'",work.id);assert.equal(resume.length,1);
 assert.equal(resume[0].sessionKey,session);assert.equal(resume[0].state,'queued');assert.equal(runtime.data.work(work.id).state,'queued');
 assert.match(resume[0].input,/do not repeat them/);
 const next=new AgentCoordinator(store);next.connections.set('chatgpt-codex',connection());
 try {
  next.pump();await wait(()=>next.data.job(String(resume[0].id)).state==='completed');
  assert.equal(store.query('SELECT nativeSessionID FROM agent_session WHERE id=?',session)[0].nativeSessionID,nativeSession,'The resumed turn continues the same native conversation.');
  assert.ok(next.data.workSnapshot(work.id).messages.some(m=>m.role==='user'&&m.body.startsWith('Polaris was quit while this task was running')));
  assert.equal(store.query("SELECT count(*) n FROM agent_job WHERE workID=? AND origin='resume'",work.id)[0].n,1,'A completed resume is not resumed again.');
 } finally { await next.stop(); }
}));
