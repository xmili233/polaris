import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { StrategyScheduler, validateSchedule, nextScheduleTime } from '../dist-service/strategy-schedule.js';
const daily = (more = {}) => ({ timezone: 'Asia/Taipei', rule: { frequency: 'daily', time: '09:00' }, ...more });
async function fixture(fn) {
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-schedules-')), store=new PolarisStore(path.join(dir,'db.sqlite'));seedDemo(store);
 const data=new AgentStore(store); let now=new Date('2026-11-02T00:00:00Z');
 const queue = (work, inputs) => {
   const id = data.queue('work', work.instructions, work.id);data.setInputs(id,inputs);
   store.query("UPDATE agent_work SET provider='chatgpt-codex',sessionKey=? WHERE id=?",id,work.id);
   store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=? WHERE id=?",id,id);return id;
 };
 const scheduler=new StrategyScheduler(store,data,queue,()=>{},()=>now), id=store.snapshot().strategies[0].id;
 const save=(config=daily(),title='Check responses',inputs={})=>scheduler.save(id,{title,instructions:'Check actual responses; do not resend messages.',config,inputs});
 const advance=value=>{now=new Date(value);scheduler.tick();};
 const complete=()=>{for(const j of store.query("SELECT id,workID FROM agent_job WHERE state='queued'")){data.setJob(j.id,'completed');data.setWork(j.workID,'completed','');}};
 try {await fn({store,data,scheduler,id,save,advance,queue,complete});}finally{scheduler.stop();store.close();await rm(dir,{recursive:true,force:true});}
}
test('schedule validation and calendar calculation handle time zones, month ends, leap years and DST',()=>{
 assert.throws(()=>validateSchedule(daily({instructions:'A separate task prompt'})));
 assert.throws(()=>validateSchedule(daily({mode:'monitor'})));
 assert.throws(()=>validateSchedule(daily({timezone:'Not/AZone'})));
 assert.throws(()=>validateSchedule(daily({maxDelayMinutes:0})));
 assert.throws(()=>validateSchedule(daily({missed:'skip'})));
 assert.throws(()=>validateSchedule(daily({rule:{frequency:'daily',time:'25:00'}})));
 assert.equal(nextScheduleTime(daily(),new Date('2026-11-02T00:00:00Z')),'2026-11-02T01:00:00.000Z');
 const monthly=daily({rule:{frequency:'monthly',time:'09:00',day:31}});
 assert.equal(nextScheduleTime(monthly,new Date('2026-04-01T00:00:00Z')),'2026-05-31T01:00:00.000Z');
 assert.equal(nextScheduleTime(daily({rule:{frequency:'monthly',time:'09:00',day:29}}),new Date('2028-02-01T00:00:00Z')),'2028-02-29T01:00:00.000Z');
 const dst=daily({timezone:'America/New_York',rule:{frequency:'daily',time:'02:30'}});
 assert.equal(nextScheduleTime(dst,new Date('2026-03-08T05:00:00Z')),'2026-03-08T07:00:00.000Z');
 const fall=daily({timezone:'America/New_York',rule:{frequency:'daily',time:'01:30'}});
 assert.equal(nextScheduleTime(fall,new Date('2026-11-01T04:00:00Z')),'2026-11-01T05:30:00.000Z');
 assert.equal(nextScheduleTime(fall,new Date('2026-11-01T05:30:00Z')),'2026-11-02T06:30:00.000Z');
});

test('independent timers retain their own instructions and inputs and execute exactly once',()=>fixture(({store,scheduler,save,advance,complete})=>{
 const a=save(daily({rule:{frequency:'once',at:'2026-11-02T01:00:00Z'}}),'Check replies');
 const b=save(daily({rule:{frequency:'once',at:'2026-11-02T02:00:00Z'}}),'Check metrics');
 assert.notEqual(a.id,b.id);scheduler.start();advance('2026-11-02T03:00:00Z');
 assert.equal(store.query('SELECT * FROM schedule_run').length,1);complete();scheduler.tick();complete();scheduler.tick();
 assert.deepEqual(store.query('SELECT title FROM agent_work').map(x=>x.title),['Check replies','Check metrics']);
 assert.equal(store.query('SELECT * FROM schedule_run').length,2);scheduler.tick();assert.equal(store.query('SELECT * FROM schedule_run').length,2);
}));
test('sleep coalesces a recurring backlog into one latest run and respects explicit expiry',()=>fixture(({store,scheduler,save,advance,complete})=>{
 save();scheduler.start();advance('2026-11-10T04:00:00Z');
 assert.equal(store.query('SELECT plannedAt FROM schedule_run')[0].plannedAt,'2026-11-10T01:00:00.000Z');complete();scheduler.tick();assert.equal(store.query('SELECT * FROM schedule_run').length,1);
 save(daily({expiresAt:'2026-11-11T03:00:00Z'}),'Expire');advance('2026-11-12T04:00:00Z');
 assert.equal(store.query("SELECT * FROM agent_work WHERE title='Expire'").length,0);
}));
test('editing and cancelling one schedule leaves other schedules unchanged and rejects stale versions',()=>fixture(({store,scheduler,id,save,advance})=>{
 const a=save(),b=save(daily(),'Other');scheduler.start();advance('2026-11-02T01:00:00Z');
 const old=store.query('SELECT workID FROM schedule_run')[0].workID;
 assert.throws(()=>scheduler.save(id,{title:'New',instructions:'Check',config:daily()},a.id,0),/changed/);
 const updated=scheduler.save(id,{title:'New',instructions:'Check new scope',config:daily()},a.id,1);
 assert.equal(updated.version,2);assert.equal(store.query('SELECT state FROM agent_work WHERE id=?',old)[0].state,'cancelled');
 scheduler.cancel(id,a.id,2);assert.deepEqual(scheduler.snapshot(id).tasks.map(x=>x.id),[b.id]);assert.throws(()=>scheduler.cancel(id,a.id,2),/changed/);
}));
test('uncertain effects block all timers until verified without replaying queued work',()=>fixture(({store,data,scheduler,id,save,advance})=>{
 save();scheduler.start();advance('2026-11-02T01:00:00Z');const job=store.query('SELECT * FROM agent_job')[0];data.setJob(job.id,'needs_review');
 advance('2026-11-03T01:00:00Z');assert.equal(store.query('SELECT * FROM agent_job').length,1);assert.equal(scheduler.snapshot(id).blocked,true);
 assert.throws(()=>data.resolveRun(job.id,99,true,'Receipt exists'),/changed/);
 data.resolveRun(job.id,0,true,'Checked server receipt; message was sent.');scheduler.tick();assert.equal(store.query('SELECT * FROM agent_job').length,2);
 advance('2026-11-04T01:00:00Z');assert.equal(store.query('SELECT * FROM agent_job').length,2);
 assert.throws(()=>data.resolveRun(job.id,0,true,'again'),/already/);
}));
test('archiving a strategy cancels its queued occurrences and future timers',()=>fixture(({store,scheduler,id,save,advance})=>{
 store.query("UPDATE decision SET status='cancelled',payload=json_set(payload,'$.status','cancelled')");save();scheduler.start();advance('2026-11-02T01:00:00Z');
 store.mutate('strategy','archive',id,{requestID:'archive',expectedVersion:store.get('strategy',id).version});scheduler.tick();
 assert.equal(scheduler.snapshot(id).tasks.length,0);assert.equal(store.query('SELECT state FROM agent_job')[0].state,'cancelled');
}));
test('two database connections cannot dispatch the same occurrence twice',()=>fixture(({store,scheduler,save,advance})=>{
 save();scheduler.start();advance('2026-11-02T01:00:00Z');const other=new PolarisStore(store.file),data=new AgentStore(other);
 const second=new StrategyScheduler(other,data,()=>{throw Error('Duplicate dispatch');},()=>{},()=>new Date('2026-11-02T01:00:00Z'));
 try{second.start();assert.equal(store.query('SELECT * FROM schedule_run').length,1);}finally{second.stop();other.close();}
}));
test('background schedules cannot cross strategy or artifact scope; failed creates roll back',()=>fixture(({store,data,scheduler,id,queue})=>{
 const work=data.createWork(id,'Source','Check later'),job=data.job(queue(work));const actions=new AgentActions(store,data,{assertActive(){},schedules:scheduler},()=>{}).definitions(job,work);
 const schedule=actions.find(x=>x.name==='manage_scheduled_task');const task={title:'Follow up',instructions:'Check',config:daily()};
 assert.throws(()=>schedule.execute({action:'save',strategy_id:'other',task}));
 assert.throws(()=>schedule.execute({action:'save',strategy_id:id,task:{...task,inputs:{artifactIDs:['foreign']}}}));
 const saved=schedule.execute({action:'save',strategy_id:id,task});assert.equal(schedule.execute({action:'save',strategy_id:id,task}).id,saved.id);
 assert.equal(scheduler.snapshot(id).tasks.length,1);assert.equal(actions.some(x=>x.name==='finish_task'),false);
}));
