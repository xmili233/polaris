import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
const wait=async f=>{const end=Date.now()+7000;while(!f()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.ok(f(),'timed out');};
const conn=p=>({provider:p,label:p,connected:true,enabled:true,installed:true,compatible:true,authenticated:true,protocolReady:true,version:'fixture',protocol:p==='chatgpt-codex'?'app-server':'acp',executable:'mock',account:'fixture',model:'',models:[],capabilities:emptyCapabilities(),verified:{turn:false,tools:false,resume:false,cancel:false}});
async function fixture(fn){
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-work-tests-')),store=new PolarisStore(path.join(dir,'db.sqlite'));seedDemo(store);
 const calls=[],sessions=[],pending=new Set();let hold=false;
 const runtime=new AgentCoordinator(store,()=>{},(async options=>{
  let finish;const settle=result=>{if(finish){pending.delete(finish);finish(result);finish=undefined;}};
  sessions.push({provider:options.connection.provider,id:options.sessionID,cwd:options.cwd});options.onSession(path.basename(options.cwd));
  return {id:path.basename(options.cwd),capabilities:emptyCapabilities(),prompt:async text=>{
   options.onRun(randomUUID());const response=await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT,{method:'POST',headers:{authorization:`Bearer ${options.mcp.env.POLARIS_MCP_TOKEN}`},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_context',arguments:{goal_id:''}}})});
   const result=await response.json(),context=JSON.parse(result.result.content[0].text);calls.push({text,context});
   options.onEvent({type:'text',localID:'reply',text:`Reply for ${context.work?.id??'main'}`,phase:'final_answer',complete:true});
   return hold?new Promise(r=>{finish=r;pending.add(r);}):{status:'completed'};
  },cancel:async()=>{settle({status:'cancelled'});},close:async()=>{settle({status:'cancelled'});}};
 }));
 runtime.connections.set('chatgpt-codex',conn('chatgpt-codex'));runtime.connections.set('claude-code',conn('claude-code'));
 const create=(title,provider='chatgpt-codex')=>{const w=runtime.data.createWork(store.snapshot().strategies[0].id,title,`${title} instructions`);runtime.queueWork(w.instructions,w.id,provider);return runtime.data.work(w.id);};
 try{await fn({dir,store,runtime,calls,sessions,create,hold:()=>hold=true,release:()=>{hold=false;for(const finish of pending)finish({status:'completed'});pending.clear();}});}finally{await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}
}
test('five background tasks run across providers while main and each session keep separate serial slots',()=>fixture(async({runtime,calls,create,hold,release})=>{
 hold();const works=Array.from({length:7},(_,i)=>create(`Concurrent ${i}`,i%2?'claude-code':'chatgpt-codex'));
 runtime.pump();
 const active=kind=>[...runtime.active.values()].filter(item=>item.job.kind===kind);
 assert.equal(active('work').length,5);
 assert.equal(runtime.data.work(works[5].id).state,'queued');
 const main=runtime.send('Main while five tasks run'),nextMain=runtime.send('Next main message');
 assert.equal(active('main').length,1);assert.equal(runtime.active.size,6);
 assert.equal(runtime.data.job(nextMain).state,'queued');
 await wait(()=>calls.length===6);
 const queued=runtime.data.workList().find(w=>w.id===works[6].id).lastJobID;
 await runtime.cancel(queued);assert.equal(runtime.data.job(queued).state,'cancelled');
 const running=active('work').find(item=>item.job.workID===works[1].id).job.id;
 await runtime.cancel(running);
 await wait(()=>calls.length===7&&runtime.data.work(works[5].id).state==='running');
 assert.equal(active('work').length,5);assert.equal(runtime.data.job(main).state,'running');
 release();await wait(()=>runtime.active.size===0&&runtime.data.job(nextMain).state==='completed');
 assert.equal(runtime.data.job(running).state,'cancelled');assert.equal(runtime.data.job(queued).state,'cancelled');
 assert.equal(runtime.data.work(works[5].id).state,'completed');
}));
test('background tasks have separate read-only histories and card-only input rules',()=>fixture(async({runtime,calls,create})=>{
 const a=create('Work A'),b=create('Work B','claude-code');
 const main=runtime.send('Main question');runtime.pump();
 await wait(()=>runtime.active.size===0&&calls.length===3);
 const aCall=calls.find(c=>c.context.work?.id===a.id),mainCall=calls.find(c=>!c.context.work);
 assert.match(aCall.text,/Everything that needs the user goes through request_decisions/);
 assert.doesNotMatch(aCall.text,/call finish_task/);assert.match(aCall.text,/When time must pass, schedule a task/);
 assert.match(aCall.text,/Research, execute and produce the result yourself/);
 assert.doesNotMatch(aCall.text,/contacting people with their own accounts/);
 assert.doesNotMatch(aCall.text,/Timing is managed in the main chat/);
 assert.doesNotMatch(aCall.text,/Guide each goal through these steps in ordinary chat/);
 assert.match(mainCall.text,/Guide each goal through these steps in ordinary chat/);
 assert.match(mainCall.text,/Do not perform strategy execution or ask its execution choices in chat/);
 assert.equal(runtime.conversation(a.id).canSend,false);
 assert.equal(runtime.conversation().canSend,true);
 assert.ok(runtime.conversation(a.id).messages.some(m=>m.body.includes(a.id)));
 assert.ok(runtime.conversation(a.id).messages.every(m=>!m.body.includes(b.id)));
 assert.ok(runtime.conversation().messages.some(m=>m.id===main+':assistant'));
}));
test('confirmed decisions coordinate through main and leave source task history intact',()=>fixture(async({runtime,store,create,hold,release,calls})=>{
 const source=create('Original task');runtime.pump();await wait(()=>runtime.active.size===0&&runtime.data.work(source.id).state==='completed');
 const sourceJob=store.query('SELECT id FROM agent_job WHERE workID=?',source.id)[0].id;
 const decision=store.mutate('decision','submit',undefined,{requestID:randomUUID(),strategyID:source.strategyID,title:'Choose route',body:'Current facts',options:[{id:'a',label:'A'}]});
 store.query('INSERT INTO decision_source(decisionID,sourceJobID,issueKey) VALUES(?,?,?)',decision.id,sourceJob,'route');
 hold();const outcome=store.decide(decision.id,'a','',decision.version);await wait(()=>calls.length===2);
 const coordinated=store.query('SELECT * FROM agent_job WHERE outcomeID=?',outcome.id)[0];assert.equal(coordinated.kind,'main');assert.equal(coordinated.workID,null);assert.notEqual(coordinated.sessionKey,source.sessionKey);
 assert.match(calls.at(-1).text,/## Main Agent/);assert.equal(runtime.data.work(source.id).title,'Original task');
 assert.ok(runtime.conversation(source.id).messages.some(m=>m.body.includes('Original task instructions')));
 release();await wait(()=>runtime.active.size===0&&runtime.data.job(coordinated.id).state==='completed');assert.ok(store.outcomes().find(o=>o.id===outcome.id).acknowledgedAt);
}));
test('only the selected background task can be stopped',()=>fixture(async({runtime,create,hold})=>{
 hold();const a=create('A'),b=create('B');runtime.pump();
 const id=runtime.data.workList().find(w=>w.id===a.id).lastJobID;
 await wait(()=>runtime.data.job(id).delivery==='accepted');
 await assert.rejects(runtime.stopWork(b.id,id),{code:'conflict'});
 assert.equal(runtime.data.job(id).state,'running');
 await runtime.stopWork(a.id,id);
 assert.equal(runtime.data.job(id).state,'cancelled');
 assert.ok(!runtime.data.workList().some(w=>w.id===a.id));
 assert.equal(runtime.conversation(a.id).canSend,false);
}));
test('each task receives its goal constraints and only its own strategy',()=>fixture(async({store,runtime,calls,create})=>{
 const strategy=store.snapshot().strategies[0],goal=store.get('goal',strategy.goalID);
 store.mutate('goal','update',goal.id,{requestID:randomUUID(),expectedVersion:goal.version,title:goal.title,milestone:goal.milestone,constraints:'Apply this across the whole goal.'});
 const work=create('Read constraints');runtime.pump();await wait(()=>runtime.data.work(work.id).state==='completed');
 const context=calls[0].context;
 assert.equal(context.board.goals[0].id,goal.id);assert.equal(context.board.goals[0].constraints,'Apply this across the whole goal.');
 assert.deepEqual(context.board.strategies.map(s=>s.id),[strategy.id]);
}));
