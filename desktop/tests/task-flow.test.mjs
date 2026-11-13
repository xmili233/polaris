import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';

const milestone = '到 2027-01-19：至少 5 家中国跨境家具卖家发布教程';
const wait = async fn => { const end = Date.now() + 5000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail('Loop did not settle'); };

async function workspace(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-loop-')), store = new PolarisStore(path.join(dir, 'test.sqlite'));
  const goal = store.mutate('goal', 'create', undefined, { requestID: randomUUID(), title: 'Formlore 增长', milestone, symbol: 'Target' });
  // A strategy without timing, so its loop state comes only from cards, tasks and waits.
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const strategy = { id: 'founder-led', version: 1, status: 'active', createdAt: at, updatedAt: at, goalID: goal.id, title: '创始人亲自带首批商家', body: '通过 1688 联系产业带工厂', origin: 'user' };
  store.persist('strategy', strategy);
  try { await fn({ store, goal, strategy }); } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
}
const card = (store, strategy, options, extra = {}) => store.mutate('decision', 'submit', undefined, { requestID: randomUUID(), strategyID: strategy.id, title: '自己做说明书的工厂算不算进 5 家', body: '工厂发布教程，看教程的是下游卖家的顾客。', options, ...extra });
async function tool(options, name, args) {
  const response = await fetch(options.mcp.env.POLARIS_MCP_ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${options.mcp.env.POLARIS_MCP_TOKEN}` }, body: JSON.stringify({ id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const result = (await response.json()).result;
  return result.isError ? { error: result.content?.[0]?.text ?? 'error' } : JSON.parse(result.content[0].text);
}
/** A fixture Agent that runs `script` for each prompt it receives and then gives a final reply. */
function loop(script, fn) {
  return workspace(async ({ store, goal, strategy }) => {
    const prompts = [];
    const runtime = new AgentCoordinator(store, () => {}, async options => {
      options.onSession(randomUUID());
      return { id: 'loop', capabilities: emptyCapabilities(), cancel: async () => {}, close: async () => {}, prompt: async text => {
        options.onRun(randomUUID());
        if (runtime.data.job(options.mcp.env.POLARIS_REQUEST_ID).origin === 'auto_advance') return { status: 'completed' };
        prompts.push(text);
        await script(options, text, prompts.length);
        options.onEvent({ type: 'text', localID: `reply-${prompts.length}`, text: '已完成这一步。', phase: 'final_answer', complete: true });
        return { status: 'completed' };
      } };
    });
    runtime.connections.set('chatgpt-codex', { provider: 'chatgpt-codex', connected: true, enabled: true, version: 'fixture', protocol: 'app-server', executable: 'mock', model: '', models: [], capabilities: emptyCapabilities(), verified: {} });
    const start = (title = '联系第一批工厂') => { const work = runtime.data.createWork(strategy.id, title, `${title}。`); runtime.queueWork(work.instructions, work.id); runtime.pump(); return work; };
    const works = () => store.query("SELECT id,title,sessionKey FROM agent_work w WHERE strategyID=? AND NOT EXISTS(SELECT 1 FROM agent_job j WHERE j.workID=w.id AND j.origin='auto_advance') ORDER BY rowid", strategy.id);
    try { await fn({ store, goal, strategy, runtime, prompts, start, works }); } finally { await runtime.stop(); }
  });
}


test('one card supports optional options or a written answer; confirmation never edits the plan',()=>workspace(({store,goal,strategy})=>{
 const text=card(store,strategy,[]);assert.throws(()=>store.decide(text.id,undefined,'',text.version));
 assert.equal(store.decide(text.id,undefined,'Use 8 factories',text.version).note,'Use 8 factories');
 const choice=card(store,strategy,[{id:'yes',label:'Use 8 factories',detail:'Count factories as customers.'}]);
 store.decide(choice.id,'yes','',choice.version);assert.equal(store.get('goal',goal.id).milestone,milestone);
 assert.throws(()=>store.decide(choice.id,'yes','',choice.version));
 assert.throws(()=>card(store,strategy,[],{responseMode:'text'}));
 assert.throws(()=>card(store,strategy,[{id:'yes',label:'Yes',changes:[]} ]));
}));
test('pending business questions are reused across manual and timed tasks with no placeholder work',()=>workspace(({store,strategy})=>{
 const runtime=new AgentCoordinator(store);const make=()=>{const w=runtime.data.createWork(strategy.id,'Research','Research');const id=runtime.queueWork(w.instructions,w.id);return new AgentActions(store,runtime.data,{assertActive(){}},()=>{}).definitions(runtime.data.job(id),w).find(x=>x.name==='request_decisions');};
 const args={decisions:[{strategy_id:strategy.id,issue_key:'factory-count',title:'Count factories?',body:'Factories publish instructions.',options:[]}]};
 const a=make().execute(args)[0],b=make().execute(args)[0];assert.equal(a.id,b.id);
 const context=new AgentActions(store,runtime.data,{assertActive(){}},()=>{}).context(runtime.data.job(store.query('SELECT id FROM agent_job ORDER BY seq LIMIT 1')[0].id));assert.equal(context.pendingQuestions[0].issueKey,'factory-count');assert.equal(store.query('SELECT * FROM agent_work').length,2);
 store.decide(a.id,undefined,'Yes',1);const next=make().execute(args)[0];assert.notEqual(next.id,a.id);
 const reuse=make();assert.equal(reuse.execute(args)[0].id,next.id);store.mutate('decision','cancel',next.id,{requestID:randomUUID(),expectedVersion:1});assert.throws(()=>reuse.execute(args),/cancelled/);return runtime.stop();
}));
test('a finished task ends with no mandatory handoff, extra prompt or six-step chain',()=>loop(async()=>{},async({runtime,strategy,prompts,start,works})=>{
 const work=start();await wait(()=>runtime.active.size===0);assert.equal(prompts.length,1);assert.equal(works().length,1);assert.equal(runtime.data.work(work.id).state,'completed');
 assert.equal(runtime.loopStates()[strategy.id].state,'stalled');assert.equal(runtime.store.query("SELECT name FROM sqlite_master WHERE name='strategy_loop'").length,0);
}));
test('confirmed cards reach main exactly once; main applies accepted wording and delegates remaining work',()=>{
 let goalID,strategyID,cardID;const revised='At least 5 sellers or factories publish tutorials';
 return loop(async(options,text,count)=>{
   if(count===1){const context=await tool(options,'get_context',{});goalID=context.board.goals[0].id;strategyID=context.board.strategies[0].id;
     cardID=(await tool(options,'request_decisions',{decisions:[{strategy_id:strategyID,issue_key:'count',title:'Count factories?',body:'Factories publish tutorials.',options:[{id:'yes',label:'Include factories',detail:revised}]}]}))[0].id;
   }else if(count===2){
     assert.match(text,/## Main Agent/);assert.match(text,/Include factories/);
     const context=await tool(options,'get_context',{goal_id:goalID}),goal=context.board.goals[0];
     assert.ok(await tool(options,'manage_context',{kind:'goal',action:'update',id:goal.id,expected_version:goal.version,goal:{title:goal.title,milestone:revised,symbol:goal.symbol},strategy:null}));
     await tool(options,'start_work',{strategy_id:strategyID,title:'Remaining work',instructions:'Find additional factories. Do not repeat initial research.'});
   }else {assert.match(text,/## Background Agent/);assert.match(text,/Do not repeat initial research/);}
 },async({runtime,store,prompts,start})=>{
   start();await wait(()=>runtime.active.size===0&&cardID);const card=store.get('decision',cardID),outcome=store.decide(cardID,'yes','',card.version);
   assert.equal(store.get('goal',goalID).milestone,milestone);
   await wait(()=>runtime.active.size===0&&prompts.length===3);
   assert.equal(store.get('goal',goalID).milestone,revised);const jobs=store.query('SELECT * FROM agent_job WHERE outcomeID=?',outcome.id);
   assert.equal(jobs.length,1);assert.equal(jobs[0].kind,'main');assert.equal(jobs[0].workID,null);assert.ok(store.outcomes().find(o=>o.id===outcome.id).acknowledgedAt);
   runtime.pump();assert.equal(prompts.length,3);
 });
});

test('uncertain background effects trigger one main check and only verified remaining work',()=>workspace(async({store,strategy})=>{
 const calls=[];let original;
 const runtime=new AgentCoordinator(store,()=>{},async options=>({id:'effects',capabilities:emptyCapabilities(),cancel:async()=>{},close:async()=>{},prompt:async text=>{
  const job=runtime.data.job(options.mcp.env.POLARIS_REQUEST_ID);options.onSession('effect-'+job.id);options.onRun('run-'+job.id);
  if(job.origin==='auto_advance')return {status:'completed'};
  calls.push(job.kind);
  if(job.id===original){const {PolarisError}=await import('../dist-service/model.js');throw new PolarisError('native_disconnected','Receipt lost');}
  if(job.kind==='main'){
   assert.match(text,/read-only checks/);const run=await tool(options,'inspect_agent_run',{job_id:original});assert.equal(run.delivery,'unknown');
   const resolved=await tool(options,'resolve_run',{job_id:original,generation:run.generation,completed:false,evidence:'Server receipt confirms the message was sent. Only local notes remain.'});assert.equal(resolved.resolved,true);
   await tool(options,'start_work',{strategy_id:strategy.id,title:'Record receipt',instructions:'Write local notes only. Do not send again.'});
  }else assert.match(text,/Write local notes only/);
  return {status:'completed'};
 }}));
 runtime.connections.set('chatgpt-codex',{provider:'chatgpt-codex',connected:true,enabled:true,version:'fixture',protocol:'app-server',executable:'mock',model:'',models:[],capabilities:emptyCapabilities(),verified:{}});
 try{
  const work=runtime.data.createWork(strategy.id,'Send approved message','Send once');original=runtime.queueWork(work.instructions,work.id);runtime.pump();
  await wait(()=>runtime.active.size===0&&calls.length===3);runtime.pump();assert.deepEqual(calls,['work','main','work']);
  assert.equal(runtime.data.job(original).state,'needs_review','Original evidence remains unchanged');assert.equal(runtime.data.uncertainStrategyRuns(strategy.id).length,0);
  assert.equal(store.query('SELECT * FROM agent_run_review').length,1);assert.throws(()=>runtime.retry(original),{code:'conflict'});
 }finally{await runtime.stop();}
}));
