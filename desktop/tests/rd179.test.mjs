import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PolarisStore} from '../dist-service/store.js';
import {AgentStore} from '../dist-service/agent-store.js';
import {AgentActions} from '../dist-service/agent-actions.js';
import {StrategyScheduler} from '../dist-service/strategy-schedule.js';
function fixture(fn){
 const dir=mkdtempSync(path.join(os.tmpdir(),'polaris-rd179-')),store=new PolarisStore(path.join(dir,'db.sqlite')),data=new AgentStore(store);
 store.mutate('goal','create','g',{requestID:'g',title:'Goal',milestone:'Outcome',symbol:'Target'});
 store.mutate('strategy','create','s',{requestID:'s',goalID:'g',title:'Strategy',body:'Work',origin:'User'});
 const queue=(w,inputs)=>{const id=data.queue('work',w.instructions,w.id);data.setInputs(id,inputs);store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=? WHERE id=?",id,id);return id;};
 let now=new Date('2030-01-01T00:00:00Z');const scheduler=new StrategyScheduler(store,data,queue,()=>{},()=>now);
 try{fn({store,data,scheduler,queue,advance:()=>{now=new Date('2030-01-01T02:00:00Z');scheduler.start();}});}finally{scheduler.stop();store.close();rmSync(dir,{recursive:true,force:true});}
}
test('resolving A preserves unrelated due timer B and queued work C',()=>fixture(({store,data,scheduler,queue,advance})=>{
 const a=queue(data.createWork('s','A','A'));data.setJob(a,'needs_review');
 const b=scheduler.save('s',{title:'B',instructions:'Read unrelated metrics',config:{rule:{frequency:'once',at:'2030-01-01T01:00:00Z'}}});
 const c=queue(data.createWork('s','C','Unrelated work'));advance();
 data.resolveRun(a,0,true,'A is verified');
 assert.equal(data.job(c).state,'queued');assert.ok(scheduler.snapshot('s').tasks.find(t=>t.id===b.id).pendingAt);
 data.setJob(c,'completed');scheduler.tick();assert.equal(store.query('SELECT * FROM schedule_run WHERE scheduleID=?',b.id).length,1);
}));
test('card tool instructions never request removed fields',()=>fixture(({store,data})=>{
 const defs=new AgentActions(store,data,{assertActive(){}},()=>{}).definitions(data.job(data.queue('main','Plan')));
 const tool=defs.find(t=>t.name==='manage_decision');assert.doesNotMatch(tool.description,/response mode|option.s changes|before text/);
}));
test('v4 migration preserves constraints, exact approval text and original revisions',()=>fixture(({store})=>{
 const original=store.get('goal','g');
 const card=store.mutate('decision','submit','d',{requestID:'d',strategyID:'s',title:'Send?',body:'Unused new fixture',excerpt:'Exact approved message',options:[{id:'a',label:'Send'}]});
 const outcome=store.decide(card.id,'a','',card.version);
 store.db.exec('CREATE TABLE policy(id TEXT PRIMARY KEY,parent_id TEXT,version INTEGER,status TEXT,payload TEXT)');
 for(const [id,status] of [['p','active'],['retired','archived']]){
  const policy={...original,id,goalID:'g',title:id,body:'Original constraint '+id,origin:'User',status};
  store.query('INSERT INTO policy VALUES(?,?,?,?,?)',id,'g',1,status,JSON.stringify(policy));
 }
 const raw={...store.get('decision','d'),summary:'Short summary',background:'Necessary background',agent:'Original author',recommendedOptionID:'a',recommendationReason:'Ready now'};delete raw.body;
 store.query('UPDATE decision SET payload=? WHERE id=?',JSON.stringify(raw),'d');
 store.query("UPDATE revision SET payload=? WHERE kind='decision' AND entity_id='d' AND version=1",JSON.stringify({...raw,version:1}));
 store.db.exec('PRAGMA user_version=4');
 const migrated=new PolarisStore(store.file);
 try{
  assert.match(migrated.get('goal','g').constraints,/Original constraint p/);assert.doesNotMatch(migrated.get('goal','g').constraints,/retired/);
  assert.equal(migrated.get('decision','d').body,'Short summary\n\nNecessary background');
  assert.equal(migrated.get('decision','d').excerpt,'Exact approved message');assert.equal(migrated.get('decision','d').options[0].detail,'Ready now');
  assert.deepEqual(migrated.outcomes(),[outcome]);assert.equal(migrated.history('decision','d')[0].agent,'Original author');
  assert.equal(migrated.query("SELECT * FROM revision WHERE kind='policy'").length,2);
  assert.equal(migrated.query("SELECT name FROM sqlite_master WHERE name='policy'").length,0);
  assert.deepEqual(migrated.query('PRAGMA foreign_key_check'),[]);
 }finally{migrated.close();}
}));
test('get_context has one scoped structure and retired tools are absent',()=>fixture(({store,data})=>{
 const actions=new AgentActions(store,data,{assertActive(){}},()=>{});
 const main=data.job(data.queue('main','Plan')),work=data.createWork('s','Task','Do work'),job=data.job(data.queue('work','Do work',work.id));
 const start=actions.context(main);assert.equal(start.board,null);assert.deepEqual(start.goals,[{id:'g',title:'Goal'}]);
 const scoped=actions.context(main,'g'),child=actions.context(job);
 assert.deepEqual(Object.keys(child).sort(),Object.keys(scoped).sort());assert.equal(child.work.id,work.id);assert.equal(child.board.strategies[0].id,'s');
 assert.equal(child.inputs.artifactIDs.length,0);
 const names=actions.definitions(main).map(t=>t.name);
 for(const old of ['manage_policy','read_execution_inputs','inspect_execution_plan'])assert.ok(!names.includes(old));
 const save=actions.definitions(main).find(t=>t.name==='manage_context');
 save.execute({kind:'strategy',action:'create',id:'plan',expected_version:null,goal:null,strategy:{goal_id:'g',title:'Draft adopted plan',body:'Plan',origin:'User'}});
 assert.equal(store.query('SELECT * FROM agent_work').length,1);assert.equal(store.query('SELECT * FROM scheduled_task').length,0);
}));
test('partial knowledge writes preserve metadata, derive task scope and enforce sources and versions',()=>fixture(({data})=>{
 const access={jobID:'task',goalID:'g',rulesVersion:0},base={title:'Facts',body:'Sourced content',sources:['User evidence'],expectedVersion:0,requestID:'knowledge'};
 const doc=data.knowledge.save(base,access);assert.deepEqual(doc.goalIDs,['g']);assert.deepEqual(doc.tags,[]);
 const patch={id:doc.id,body:'Updated facts',expectedVersion:1,requestID:'patch'};
 const updated=data.knowledge.save(patch,access);assert.equal(updated.title,doc.title);assert.deepEqual(updated.sources,doc.sources);assert.deepEqual(updated.goalIDs,['g']);
 assert.deepEqual(data.knowledge.save(patch,access),updated);
 assert.throws(()=>data.knowledge.save({...patch,requestID:'stale'},access),{code:'conflict'});
 assert.throws(()=>data.knowledge.save({...patch,expectedVersion:2,requestID:'foreign',goalIDs:['elsewhere']},access));
 assert.throws(()=>data.knowledge.save({...base,requestID:'no-source',sources:[]},access),e=>e.messageKey==='knowledge.sourceRequired');
}));
test('past task sessions remain readable without exposing another task',()=>fixture(({store,data,queue})=>{
 const work=data.createWork('s','Original task','Read source'),first=queue(work);
 store.query('UPDATE agent_work SET sessionKey=? WHERE id=?',first,work.id);data.message(first,'Original result','completed');data.setJob(first,'completed');
 const second=queue(work);store.query('UPDATE agent_work SET sessionKey=? WHERE id=?',second,work.id);data.message(second,'Later result','completed');data.setJob(second,'completed');
 const original=data.workSnapshot(work.id,first),current=data.workSnapshot(work.id);
 assert.ok(original.messages.some(m=>m.body==='Original result'));assert.ok(!original.messages.some(m=>m.body==='Later result'));
 assert.ok(current.messages.some(m=>m.body==='Later result'));assert.ok(!current.messages.some(m=>m.body==='Original result'));
 const foreign=queue(data.createWork('s','Another task','Different scope'));
 assert.throws(()=>data.workSnapshot(work.id,foreign),{code:'not_found'});
}));
