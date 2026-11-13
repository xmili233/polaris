import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import { legacySchema } from './fixtures/legacy-schema.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
const wait=async f=>{const end=Date.now()+6000;while(!f()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.ok(f(),'Task did not settle');};
async function fixture(fn){const dir=await mkdtemp(path.join(tmpdir(),'polaris-task-chat-')),store=new PolarisStore(path.join(dir,'db'));seedDemo(store);const data=new AgentStore(store);try{await fn({dir,store,data});}finally{store.close();await rm(dir,{recursive:true,force:true});}}
const native={provider:'chatgpt-codex',connected:true,enabled:true,model:'',models:[],version:'fixture',protocol:'app-server',executable:'fixture',capabilities:emptyCapabilities(),verified:{},account:'fixture'};
function work(store,data){const work=data.createWork(store.snapshot().strategies[0].id,'Find five stores','Find stores and draft messages'),id=data.queue('work',work.instructions,work.id),session=`task:${work.id}`;store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?",session,work.id);store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=?,generation=1 WHERE id=?",session,id);data.setJob(id,'running');return{id,work:data.work(work.id),session};}
test('normal replies and saved artifacts finish without a report or acceptance gate',()=>fixture(async({store,data})=>{
 const task=work(store,data);data.message(task.id,'Five stores found.','completed');data.setJob(task.id,'completed');data.runs.finish(task.id);
 const first=data.runs.inspect(task.id);assert.equal(first.state,'completed');assert.equal(first.result.summary,'Five stores found.');
 assert.equal(data.executions.results().length,0);
 const second=work(store,data),artifact=randomUUID();store.query('INSERT INTO agent_artifact(id,workID,title,body,jobID) VALUES(?,?,?,?,?)',artifact,second.work.id,'Draft','Actual draft',second.id);
 data.setJob(second.id,'completed');data.runs.finish(second.id);assert.deepEqual(data.runs.inspect(second.id).result.artifacts.map(a=>a.id),[artifact]);
 assert.equal(store.query('SELECT * FROM agent_run_review').length,0);
}));
test('completed agents leave the activity list while pending cards remain on the board',()=>fixture(async({store,data})=>{
 const source=work(store,data);
 const actions=new AgentActions(store,data,{assertActive(){}},()=>{}).definitions(data.job(source.id),source.work);
 const request=actions.find(tool=>tool.name==='request_decisions');
 const card={strategy_id:source.work.strategyID,issue_key:'product-url',title:'Which URL?',body:'Continue the existing review',options:[]};
 assert.throws(()=>request.execute({decisions:[{...card,response_mode:'text'}]}));
 assert.throws(()=>request.execute({decisions:[{...card,recommended_option_id:'a'}]}));
 assert.throws(()=>request.execute({decisions:[{...card,issue_key:''}]}));
 const [{id}]=request.execute({decisions:[card]});
 assert.equal(store.get('decision',id).responseMode,undefined);
 const version=store.get('decision',id).version;
 store.mutate('decision','update',id,{requestID:randomUUID(),expectedVersion:version,strategyID:card.strategy_id,title:card.title,body:card.body,options:[]});
 const updated=store.get('decision',id);
 assert.equal(updated.responseMode,undefined);
 assert.throws(()=>store.decide(id,undefined,'  ',updated.version),{code:'invalid_input'});
 store.query('INSERT INTO agent_artifact(id,workID,title,body,jobID) VALUES(?,?,?,?,?)',randomUUID(),source.work.id,'Draft','Draft in progress',source.id);
 data.setJob(source.id,'completed');data.runs.finish(source.id);
 for(let i=0;i<6;i++){
  const task=work(store,data);data.setJob(task.id,'completed');data.runs.finish(task.id);
 }
 assert.deepEqual(data.executions.results(), []);
 assert.equal(data.decisionCards(source.work)[0].id, id);
 assert.ok(store.snapshot().decisions.some(card=>card.id===id&&!card.outcome));
 data.setJob(source.id,'cancelled');
 assert.deepEqual(data.executions.results(), []);

 data.setJob(source.id,'needs_review','native_delivery_unknown');
 assert.equal(data.executions.results().find(item=>item.jobID===source.id).kind,'attention');
 data.executions.dismiss(source.work.id,source.id,1);
 assert.ok(!data.executions.results().some(item=>item.jobID===source.id));
 assert.equal(data.decisionCards(source.work)[0].id,id);
 store.decide(id,undefined,'https://example.test',updated.version);
 assert.ok(!data.executions.results().some(item=>item.jobID===source.id));
}));
test('retired question waits and queued replies end without replaying on upgrade',()=>fixture(async({store,data})=>{
 const pending=work(store,data), reply=data.queue('work','A queued reply from the old flow',pending.work.id);
 store.query("UPDATE agent_job SET state='waiting_answer' WHERE id=?",pending.id);
 store.query("UPDATE agent_work SET state='waiting_answer' WHERE id=?",pending.work.id);
 store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=?,origin='answer' WHERE id=?",pending.session,reply);
 data.message(pending.id,'Which URL should I check?','completed');
 legacySchema(store,2); const migrated=new PolarisStore(store.file); migrated.close();
 let calls=0;
 const runtime=new AgentCoordinator(store,()=>{},(async()=>{calls++;throw new Error('Unexpected dispatch');}));
 runtime.connections.set('chatgpt-codex',{...native});
 try {
  runtime.pump();
  assert.equal(calls,0);
  for(const id of [pending.id,reply]) {
   assert.equal(data.job(id).state,'cancelled');
   assert.throws(()=>runtime.retry(id),{code:'conflict'});
  }
  assert.equal(runtime.works().length,0);
  assert.ok(runtime.conversation(pending.work.id).messages.some(m=>m.body==='Which URL should I check?'));
 } finally {await runtime.stop();}
}));
test('native permission blocks background work even if the native turn reports completion',()=>fixture(async({store,data})=>{
 let permission;
 const runtime=new AgentCoordinator(store,()=>{},(async options=>({
  id:'task',capabilities:emptyCapabilities(),cancel:async()=>{},close:async()=>{},
  prompt:async()=>{
   if (!data.job(options.mcp.env.POLARIS_REQUEST_ID).workID) return {status:'completed'};
   options.onSession('task');options.onRun('turn');
   permission=await options.permission({title:'Permission required',detail:'Fixture',options:[{id:'allow',label:'Allow',kind:'allow_once'}]});
   return {status:'completed'};
  },
 })));
 runtime.connections.set('chatgpt-codex',{...native});
 try {
  const task=data.createWork(store.snapshot().strategies[0].id,'Restricted task','Check a protected resource');
  const id=runtime.queueWork(task.instructions,task.id);runtime.pump();
  await wait(()=>runtime.active.size===0&&data.job(id).state==='needs_review');
  assert.equal(permission,'');
  assert.equal(data.job(id).error,'work_permission');
  assert.deepEqual(runtime.snapshot().permissions,[]);
  assert.equal(data.executions.results().find(item=>item.jobID===id).kind,'attention');
  assert.throws(()=>runtime.retry(id),{code:'conflict'});
 } finally {await runtime.stop();}
}));
