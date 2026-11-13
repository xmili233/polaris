import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PolarisStore } from '../dist-service/store.js';
import { AgentOnboarding, onboardingState } from '../dist-service/agent-onboarding.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { onboardingTurnIdle } from '../src/agent-turn.ts';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { discover, inspectConnection } from '../dist-service/agents/discovery.js';
const connection = (provider, extra={}) => ({ provider, installed:true, compatible:true, connected:true, authenticated:true, protocolReady:true, error:'', enabled:false, capabilities:emptyCapabilities(), ...extra });
test('onboarding state distinguishes missing, unknown authentication and failed version checks',()=>{
 assert.equal(onboardingState(connection('claude-code',{installed:false})), 'missing');
 assert.equal(onboardingState(connection('claude-code',{compatible:false,connected:false})), 'outdated');
 assert.equal(onboardingState(connection('claude-code',{connected:false,authenticated:false})), 'signed_out');
 assert.equal(onboardingState(connection('claude-code',{connected:false,authenticated:null,error:'native_timeout'})), 'failed');
 assert.equal(onboardingState(connection('claude-code',{compatible:false,error:'native_version_check'})), 'failed');
});
test('production onboarding service constructs before starting any subprocess',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-onboarding-default-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 try { const flow=new AgentOnboarding(store,()=>{});assert.equal(flow.timeout,10000);assert.deepEqual(flow.snapshot().agents.map(a=>a.state),['checking','checking','checking','checking']);await flow.stop(); }
 finally {store.close();await rm(dir,{recursive:true,force:true});}
});
test('native probes distinguish signed-out CC exit status, Gemini manual auth and unreadable versions',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-onboarding-protocol-'));const previous={test:process.env.POLARIS_TEST,agents:process.env.POLARIS_TEST_NATIVE_AGENTS};
 const paths=Object.fromEntries(['claude-code','chatgpt-codex','gemini-cli'].map(id=>[id,path.join(dir,id+'.mjs')]));
 try {
  for(const file of Object.values(paths))await writeFile(file,`#!/usr/bin/env node\nimport ${JSON.stringify(new URL('./fixtures/native-agent.mjs',import.meta.url).href)};\n`,{mode:0o755});
  process.env.POLARIS_TEST='1';process.env.POLARIS_TEST_NATIVE_AGENTS=JSON.stringify(paths);
  await writeFile(paths['claude-code']+'.json',JSON.stringify({signedOut:true}));
  assert.equal(onboardingState(await inspectConnection(await discover('claude-code'))),'signed_out');
  await writeFile(paths['gemini-cli']+'.json',JSON.stringify({manualAuth:true}));
  assert.equal(onboardingState(await inspectConnection(await discover('gemini-cli'))),'signed_out');
  await writeFile(paths['chatgpt-codex']+'.json',JSON.stringify({version:'broken'}));
  assert.equal(onboardingState(await discover('chatgpt-codex')),'failed');
  await writeFile(paths['chatgpt-codex']+'.json',JSON.stringify({version:'0.1.0'}));
  assert.equal(onboardingState(await discover('chatgpt-codex')),'outdated');
 } finally {
  for(const [key,value] of [['POLARIS_TEST',previous.test],['POLARIS_TEST_NATIVE_AGENTS',previous.agents]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await rm(dir,{recursive:true,force:true});
 }
});
test('empty and archived workspaces do not turn understanding requests into goal creation',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-request-guidance-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 const prompts=[],catalogs=[];
 const runtime=new AgentCoordinator(store,()=>{},(async options=>{
  options.onSession('fixture-session');
  return {id:'fixture-session',capabilities:emptyCapabilities(),cancel:async()=>{},close:async()=>{},prompt:async text=>{
   prompts.push(text);
   const response=await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+options.mcp.env.POLARIS_MCP_TOKEN},body:JSON.stringify({id:1,method:'tools/list'})});
   catalogs.push((await response.json()).result.tools.map(t=>t.name));return {status:'completed'};
  }};
 }));
 runtime.connections.set('chatgpt-codex',{...connection('chatgpt-codex'),enabled:true,version:'fixture',executable:'fixture',protocol:'app-server',account:'fixture',model:'',models:[],verified:{turn:false,tools:false,resume:false,cancel:false}});
 const send=async text=>{runtime.send(text);for(let i=0;i<300&&runtime.active.size;i++)await new Promise(r=>setTimeout(r,10));assert.equal(runtime.active.size,0);};
 try {
  await send('理解本机的 repos/formlore 项目');
  assert.doesNotMatch(prompts[0],/First-use goal onboarding|then create 1–3|one sentence describing what was created/);
  assert.match(prompts[0],/An empty workspace is where goal clarification starts/);
  assert.match(prompts[0],/at least three active strategies per goal/);
  assert.match(prompts[0],/Current turn scope: main conversation/);
  assert.equal(store.snapshot().goals.length,0);
  assert.ok(catalogs[0].includes('manage_context'),'Explicitly requested planning remains available.');
  assert.ok(catalogs[0].includes('request_decisions'),'Main coordination can request missing execution facts by card.');
  await send('讨论一下产品增长的几条路径');
  assert.match(prompts[1],/Current turn scope: main conversation/);
  assert.doesNotMatch(prompts[1],/completed onboarding replies/);
  seedDemo(store);await send('理解已有项目，不修改目标');
  store.query("UPDATE goal SET status='archived',payload=json_set(payload,'$.status','archived')");
  await send('继续分析');
  assert.doesNotMatch(prompts[3],/First-use goal onboarding|do not ask further setup questions/);
 }finally{await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
test('choosing the default Codex provider still persists the preference for the next launch',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-onboarding-preference-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 const runtime=new AgentCoordinator(store);
 try {runtime.select('chatgpt-codex');assert.equal(store.query("SELECT value FROM metadata WHERE key='agent_provider'")[0].value,'chatgpt-codex');}
 finally {await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
test('onboarding waits for native termination even after business work is paused',()=>{
 const job={id:'one',kind:'main',state:'waiting_decision'};
 const snapshot={jobs:[job],messages:[],native:{activeJobIDs:['one']}};
 assert.equal(onboardingTurnIdle(snapshot),false);
 assert.equal(onboardingTurnIdle({...snapshot,native:{activeJobIDs:[]}}),true);
 assert.equal(onboardingTurnIdle({...snapshot,native:{activeJobIDs:[]},messages:[{id:'one:assistant',state:'running'}]}),false);
 assert.equal(onboardingTurnIdle({...snapshot,jobs:[{...job,state:'queued'}],native:{activeJobIDs:[]}}),false);
  assert.equal(onboardingTurnIdle({...snapshot,jobs:[{...job,state:'waiting_connection'},{id:'latest',kind:'main',state:'completed'}],native:{activeJobIDs:[]}}),true,'An old disconnected legacy prompt must not block a completed native onboarding turn');
});
test('a slow probe expires independently and leaving the page cannot publish late readiness',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-onboarding-deadline-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 let aborted=false,release;const late=new Promise(resolve=>{release=resolve;});
 const flow=new AgentOnboarding(store,()=>{},async(provider,_saved,signal)=>{if(provider==='gemini-cli'){signal.addEventListener('abort',()=>{aborted=true;});await late;}return connection(provider);},30);
 try {
  await flow.check();assert.equal(aborted,true);assert.deepEqual(flow.snapshot().agents.map(a=>a.state),['ready','ready','failed','ready']);
  release();await new Promise(r=>setTimeout(r,5));assert.equal(flow.snapshot().agents[2].state,'failed');
  let calls=0;let finish;const waiting=new Promise(r=>{finish=r;});
  const first=flow.continue(async()=>{calls++;await waiting;return true;}),second=flow.continue(async()=>{calls++;return true;});
  finish();await Promise.all([first,second]);assert.equal(calls,1,'Double continue does not activate twice');
 }finally{await flow.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
test('the single decision tool validates batches atomically and deduplicates cards',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-onboarding-batch-')),store=new PolarisStore(path.join(dir,'db.sqlite'));seedDemo(store);const data=new AgentStore(store);
 const strategy_id=store.snapshot().strategies[0].id,round=data.createWork(strategy_id,'Prepare the first batch','Prepare the first batch');
 const job=data.job(data.queue('work','Prepare the first batch',round.id));let active=true;
 const actions=new AgentActions(store,data,{assertActive:()=>{if(!active)throw new Error('paused');},cancelWork:()=>{},retry:()=>{},queueWork:()=>{}},()=>{});
 const defs=actions.definitions(job,data.work(round.id)),batch=defs.find(item=>item.name==='request_decisions');
 assert.ok(actions.definitions(data.job(data.send('Set up my first goal')),undefined).find(item=>item.name==='request_decisions'));
 const decision=title=>({strategy_id,issue_key:title,title,body:'Two alternatives',options:[{id:'a',label:'A',detail:'First'},{id:'b',label:'B',detail:'Second'}]});
 const initial=store.snapshot().decisions.length;
 try {
  assert.deepEqual(defs.filter(item=>item.name.startsWith('request_decision')).map(item=>item.name),['request_decisions']);
  assert.throws(()=>batch.execute({decisions:[{...decision('First'),depends_on_decisions:['old-card']}]}));
  assert.throws(()=>batch.execute({decisions:[decision('First'),{...decision('Second'),strategy_id:'missing'}]}));
  assert.equal(store.snapshot().decisions.length,initial);assert.equal(store.query('SELECT count(*) n FROM agent_work')[0].n,1);
  const excerpt='  Exact draft line\nSecond line\n';
  const args={decisions:[{...decision('First'),excerpt},decision('Second')]};batch.execute(args);batch.execute(args);
  assert.equal(store.records('decision').find(item=>item.title==='First').excerpt,excerpt);
  assert.equal(store.snapshot().decisions.length,initial+2);assert.equal(store.query('SELECT count(*) n FROM decision_source')[0].n,2);
  active=false;assert.throws(()=>batch.execute(args));
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
test('probes update independently, deduplicate polling and never enable queued work',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-onboarding-unit-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 let release, calls=0;const slow=new Promise(resolve=>{release=resolve;});
 const flow=new AgentOnboarding(store,()=>{},async provider=>{calls++;if(provider==='gemini-cli')await slow;return connection(provider);});
 try {
  assert.equal(flow.snapshot().preferred,undefined);
  const checking=flow.check();await new Promise(resolve=>setTimeout(resolve,20));
  assert.deepEqual(flow.snapshot().agents.map(a=>a.state),['ready','ready','checking','ready']);
  const again=flow.check();assert.equal(calls,4);release();await Promise.all([checking,again]);
  assert.equal(store.query('SELECT * FROM agent_connection').length,0);
  let selected;assert.equal(await flow.continue(async provider=>{selected=provider;return true;}),true);assert.equal(selected,'claude-code');
  store.query("INSERT INTO metadata(key,value) VALUES('agent_provider','gemini-cli')");
  assert.equal(flow.snapshot().preferred,'gemini-cli','A restored launch knows which Agent to wait for');
  await flow.continue(async provider=>{selected=provider;return true;});assert.equal(selected,'gemini-cli');
  assert.equal(await flow.continue(async()=>false),false);assert.equal(flow.snapshot().agents[2].state,'failed');
 }finally{await flow.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
test('sub model routes new background work to its own platform and model, and decisions stay with their session',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-sub-model-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 seedDemo(store);const strategy=store.snapshot().strategies[0].id;const runs=[];
 const runtime=new AgentCoordinator(store,()=>{},(async options=>{
  options.onSession('fixture-'+options.connection.provider);
  return {id:'fixture',capabilities:emptyCapabilities(),cancel:async()=>{},close:async()=>{},prompt:async text=>{
   runs.push({provider:options.connection.provider,model:options.connection.model,work:text.includes('Queued work')});
   if(!text.includes('Queued work'))await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT,{method:'POST',headers:{authorization:'Bearer '+options.mcp.env.POLARIS_MCP_TOKEN},
    body:JSON.stringify({id:1,method:'tools/call',params:{name:'start_work',arguments:{strategy_id:strategy,title:'Draft',instructions:'Queued work'}}})});
   return {status:'completed'};
  }};
 }));
 const ready=(provider,models)=>runtime.connections.set(provider,{...connection(provider),enabled:true,version:'fixture',executable:'fixture',protocol:provider==='chatgpt-codex'?'app-server':'acp',account:'fixture',model:'',models,verified:{turn:false,tools:false,resume:false,cancel:false}});
 ready('chatgpt-codex',[{id:'main-model',name:'Main'}]);ready('claude-code',[{id:'sub-model',name:'Sub'}]);
 try {
  runtime.select('chatgpt-codex');await runtime.chooseModel('chatgpt-codex','main-model');
  assert.equal(runtime.snapshot().sub,null,'Background work follows the main model by default');
  await assert.rejects(()=>runtime.selectSubModel('claude-code','unknown'));
  await runtime.selectSubModel('claude-code','sub-model');assert.deepEqual(runtime.snapshot().sub,{provider:'claude-code',model:'sub-model'});
  runtime.send('Plan the launch');
  for(let i=0;i<300&&runs.length<2;i++)await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(runs,[{provider:'chatgpt-codex',model:'main-model',work:false},{provider:'claude-code',model:'sub-model',work:true}]);
  const work=store.query("SELECT provider,sessionKey FROM agent_work ORDER BY rowid DESC LIMIT 1")[0];
  assert.equal(work.provider,'claude-code');assert.match(String(work.sessionKey),/^native:claude-code:work:/);
  runtime.selectSubModel(null);assert.equal(runtime.snapshot().sub,null);
 }finally{await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}
});

test('ready model lists refresh after their cache expires without disappearing during the probe',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-model-refresh-')),store=new PolarisStore(path.join(dir,'db.sqlite'));
 let revision=0,release;const flow=new AgentOnboarding(store,()=>{},async provider=>{if(revision&&provider==='chatgpt-codex')await new Promise(resolve=>release=resolve);return connection(provider,{models:[{id:String(revision),name:`Model ${revision}`}]});});
 try {
  await flow.check();revision=1;flow.checkedAt.set('chatgpt-codex',0);const refresh=flow.check();await new Promise(resolve=>setTimeout(resolve,0));
  const before=flow.snapshot().agents.find(agent=>agent.provider==='chatgpt-codex');assert.equal(before.state,'ready');assert.equal(before.models[0].id,'0');
  release();await refresh;assert.equal(flow.snapshot().agents.find(agent=>agent.provider==='chatgpt-codex').models[0].id,'1');
 }finally{await flow.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
