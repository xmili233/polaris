import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { PolarisStore } from '../dist-service/store.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
const wait = async f => { const end=Date.now()+3000; while(!f()&&Date.now()<end) await new Promise(r=>setTimeout(r,10)); assert.ok(f(),'runtime state timed out'); };
async function fixture(fn) {
  const dir=await mkdtemp(path.join(tmpdir(),'polaris-runtime-')), store=new PolarisStore(path.join(dir,'db.sqlite'));seedDemo(store);
  const turns=[], steers=[]; let finish;
  const driver=async options=>{
    options.onSession(options.sessionID??'same-session');
    return {id:'same-session',capabilities:emptyCapabilities(),canSteer:()=>true,
      steer:async(text,id)=>{steers.push({text,id});return true;},
      prompt:async text=>{options.onRun(randomUUID());turns.push(text);if(text.endsWith('hold'))await new Promise(r=>finish=r);return{status:'completed'};},
      cancel:async()=>finish?.(),close:async()=>finish?.()};
  };
  const runtime=new AgentCoordinator(store,()=>{},(driver));
  runtime.connections.set('chatgpt-codex',{provider:'chatgpt-codex',executable:'fixture',version:'0.162.1',protocol:'app-server',connected:true,enabled:true,model:'',models:[],capabilities:emptyCapabilities(),verified:{},account:'fixture'});
  try {await fn({runtime,store,turns,steers,finish:()=>finish?.(),driver});}finally{await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}
}
test('running input steers the same turn once and remains in conversation history',()=>fixture(async({runtime,store,turns,steers,finish})=>{
  const root=runtime.send('hold');await wait(()=>turns.length===1);
  const id=randomUUID();runtime.send('Use the smaller change',id);runtime.send('Use the smaller change',id);
  await wait(()=>steers.length===1);
  assert.equal(runtime.data.job(id),undefined);assert.equal(turns.length,1);
  assert.ok(runtime.conversation().messages.some(m=>m.id===`${id}:user`&&m.body==='Use the smaller change'));
  assert.throws(()=>runtime.send('different',id));finish();await wait(()=>runtime.active.size===0);
  assert.equal(runtime.data.job(root).state,'completed');assert.equal(store.query('SELECT count(*) AS n FROM agent_job')[0].n,1);
}));
test('a definitely rejected steer enters the normal queue once',()=>fixture(async({runtime,turns,finish})=>{
  const first=runtime.send('hold');await wait(()=>turns.length===1);
  runtime.active.get(first).session.steer=async()=>false;
  const id=runtime.send('queued correction');await wait(()=>runtime.data.job(id)?.state==='queued');
  finish();await wait(()=>runtime.active.size===0&&runtime.data.job(id)?.state==='completed');assert.equal(turns.length,2);
}));
test('an uncertain steer is retained for review and never replayed',()=>fixture(async({runtime,store,turns,finish})=>{
  const first=runtime.send('hold');await wait(()=>turns.length===1);let calls=0;
  runtime.active.get(first).session.steer=async()=>{calls++;throw new Error('ack lost');};
  const id=randomUUID();runtime.send('uncertain correction',id);await wait(()=>store.query('SELECT state FROM agent_message WHERE id=?',`${id}:user`)[0]?.state==='unknown');
  runtime.send('uncertain correction',id);assert.equal(calls,1);finish();await wait(()=>runtime.active.size===0);
  assert.equal(runtime.data.job(first).state,'needs_review');assert.equal(runtime.data.job(id),undefined);assert.equal(turns.length,1);
}));
test('a model change queues the message instead of changing the running turn',()=>fixture(async({runtime,turns,steers,finish})=>{
  runtime.connections.get('chatgpt-codex').models=[{id:'other',name:'Other'}];
  runtime.send('hold');await wait(()=>turns.length===1);await runtime.chooseModel('chatgpt-codex','other');
  const next=runtime.send('use the selected model');assert.equal(runtime.data.job(next).state,'queued');assert.equal(steers.length,0);
  finish();await wait(()=>runtime.active.size===0&&runtime.data.job(next).state==='completed');
}));
