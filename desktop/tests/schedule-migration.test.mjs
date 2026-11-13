import test from 'node:test';
import { legacySchema } from './fixtures/legacy-schema.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { StrategyScheduler } from '../dist-service/strategy-schedule.js';

test('old schedules migrate without activating proposals or paused plans, or losing historical runs',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-schedule-migration-')), file=path.join(dir,'db.sqlite');
 let store=new PolarisStore(file), data=new AgentStore(store);
 let scheduler;
 try {
  const create=(kind,id,values)=>store.mutate(kind,'create',id,{requestID:id,...values});
  create('goal','goal',{title:'Test',milestone:'Verify migration',symbol:'target'});
  legacySchema(store,2);
  store.db.exec(`
   DROP TABLE schedule_run; DROP TABLE schedule_revision; DROP TABLE strategy_schedule;
   CREATE TABLE strategy_schedule(strategyID TEXT PRIMARY KEY REFERENCES strategy(id),version INTEGER NOT NULL DEFAULT 0,revisionID TEXT,enabled INTEGER NOT NULL DEFAULT 0,nextAt TEXT,pendingAt TEXT);
   CREATE TABLE schedule_revision(id TEXT PRIMARY KEY,strategyID TEXT NOT NULL REFERENCES strategy(id),baseVersion INTEGER NOT NULL,config TEXT NOT NULL,decisionID TEXT UNIQUE NOT NULL REFERENCES decision(id),decisionVersion INTEGER NOT NULL,decisionHash TEXT NOT NULL,status TEXT NOT NULL,outcomeID TEXT,review TEXT,createdAt TEXT NOT NULL);
   CREATE TABLE schedule_run(id TEXT PRIMARY KEY,strategyID TEXT NOT NULL REFERENCES strategy(id),revisionID TEXT NOT NULL REFERENCES schedule_revision(id),plannedAt TEXT NOT NULL,workID TEXT UNIQUE REFERENCES agent_work(id),jobID TEXT REFERENCES agent_job(id),skipReason TEXT,reviewedAt TEXT,createdAt TEXT NOT NULL,UNIQUE(strategyID,revisionID,plannedAt));`);
  const config={timezone:'Asia/Taipei',rule:{frequency:'daily',time:'09:00'},missed:'latest',maxDelayMinutes:120,expiresAt:null,instructions:'LEGACY PRIVATE PROMPT',mode:'monitor'};
  let proposalID;
  for(const id of ['active','paused','proposal']){
   store.persist('strategy',{id,goalID:'goal',title:id,body:'Current scope',origin:'User',version:1,status:'active',createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z'});
   const d=store.mutate('decision','submit',undefined,{requestID:'decision-'+id,strategyID:id,title:'Old timing',body:'09:00\n\nOld private instructions',options:[{id:'approve',label:'Enable'},{id:'reject',label:'Reject'}]});
   const outcome=id==='proposal'?null:store.decide(d.id,'approve','',d.version);
   store.query('INSERT INTO schedule_revision VALUES(?,?,?,?,?,?,?,?,?,?,?)','revision-'+id,id,0,JSON.stringify(config),d.id,d.version,'old-hash',id==='proposal'?'proposed':'approved',outcome?.id??null,null,'2026-11-02T00:00:00Z');
   store.query('INSERT INTO strategy_schedule VALUES(?,?,?,?,?,?)',id,id==='proposal'?0:1,id==='proposal'?null:'revision-'+id,id==='active'?1:0,id==='active'?'2026-11-03T01:00:00Z':null,null);
   if(id==='proposal') proposalID=d.id;
  }
  const work=data.createWork('active','Previous occurrence','Old task'),jobID=data.queue('work','Old task',work.id);
  data.setJob(jobID,'completed');data.setWork(work.id,'completed','Historical result');
  store.query('INSERT INTO schedule_run(id,strategyID,revisionID,plannedAt,workID,jobID,createdAt) VALUES(?,?,?,?,?,?,?)','old-run','active','revision-active','2026-11-02T01:00:00Z',work.id,jobID,'2026-11-02T01:00:00Z');
  for(const row of store.query('SELECT id,payload FROM decision')){const card=JSON.parse(row.payload);card.summary='09:00';card.background=card.body;card.agent='Polaris';delete card.body;store.query('UPDATE decision SET payload=? WHERE id=?',JSON.stringify(card),row.id);}
  store.db.exec('PRAGMA user_version=2');
  store.close();store=new PolarisStore(file);data=new AgentStore(store);
  const make=()=>new StrategyScheduler(store,data,w=>data.queue('work',w.instructions,w.id),()=>{},()=>new Date('2026-11-03T01:00:00Z'));
  scheduler=make();
  assert.equal(store.query('PRAGMA table_info(strategy_schedule)').some(c=>c.name==='enabled'),false);
  assert.equal(store.query('PRAGMA foreign_keys')[0].foreign_keys,1);assert.deepEqual(store.query('PRAGMA foreign_key_check'),[]);
  assert.equal(scheduler.snapshot('active').tasks[0].id,'revision-active');assert.equal(scheduler.snapshot('paused').tasks.length,0);assert.equal(scheduler.snapshot('proposal').tasks.length,0);
  assert.equal(store.get('decision',proposalID).status,'cancelled');
  assert.equal(store.outcomes().length,2);
  scheduler.start();assert.equal(store.query('SELECT * FROM schedule_run').length,2);assert.equal(store.query("SELECT * FROM schedule_run WHERE strategyID!='active'").length,0);
  assert.equal(store.query("SELECT config FROM scheduled_task WHERE id='revision-proposal'")[0].config.includes('PRIVATE'),false);
  scheduler.stop();scheduler=make();assert.equal(store.get('decision',proposalID).status,'cancelled');assert.deepEqual(store.query('PRAGMA foreign_key_check'),[]);
  scheduler.save('proposal',{title:'Check',instructions:'Use current context',config:{rule:config.rule,timezone:config.timezone}});assert.equal(scheduler.snapshot('proposal').tasks.length,1);assert.equal(store.query('SELECT * FROM scheduled_task').length,4);assert.equal(store.outcomes().length,2);
 } finally {scheduler?.stop();store.close();await rm(dir,{recursive:true,force:true});}
});

test('v3 migration preserves questions, approved choices and waits with a verified original backup',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-v3-')),file=path.join(dir,'db.sqlite');let store=new PolarisStore(file);
 try{
  const create=(kind,id,body)=>store.mutate(kind,'create',id,{requestID:id,...body});
  create('goal','g',{title:'Goal',milestone:'Original milestone',symbol:'Target'});create('strategy','s',{goalID:'g',title:'Strategy',body:'Work',origin:'User'});
  const card=create('decision','d',{strategyID:'s',title:'Adopt new milestone?',body:'Choose\n\nFacts',options:[{id:'yes',label:'Adopt'}]});
  const outcome=store.decide(card.id,'yes','',card.version),data=new AgentStore(store),work=data.createWork('s','Previous task','Do not repeat');
  const job=data.queue('work','previous input',work.id,outcome.id);store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey='old' WHERE id=?",job);
  legacySchema(store,3);
  const raw=JSON.parse(store.query("SELECT payload FROM decision WHERE id='d'")[0].payload);raw.options[0].changes=[{kind:'goal',action:'update',field:'milestone',id:'g',before:'Original milestone',after:'New milestone'}];
  store.query("UPDATE decision SET payload=? WHERE id='d'",JSON.stringify(raw));
  store.query("INSERT INTO strategy_loop VALUES('s','2030-01-01T00:00:00Z','Check the actual reply',2,'2026-11-11T00:00:00Z')");
  store.close();store=new PolarisStore(file);
  assert.equal(store.get('goal','g').milestone,'Original milestone');assert.match(store.get('decision','d').options[0].detail,/Original milestone → New milestone/);
  assert.equal(store.get('decision','d').options[0].changes,undefined);assert.equal(store.outcomes()[0].optionID,'yes');
  assert.equal(store.query('SELECT nextAt FROM scheduled_task')[0].nextAt,'2030-01-01T00:00:00Z');
  assert.equal(store.query('SELECT kind FROM agent_job WHERE id=?',job)[0].kind,'main');assert.deepEqual(store.query('PRAGMA foreign_key_check'),[]);
  const {readdir}=await import('node:fs/promises'),{DatabaseSync}=await import('node:sqlite');const backups=(await readdir(dir)).filter(x=>x.includes('.before-v5-'));assert.equal(backups.length,1);
  const backup=new DatabaseSync(path.join(dir,backups[0]),{readOnly:true});try{assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(backup.prepare('PRAGMA user_version').get().user_version,3);assert.match(backup.prepare("SELECT payload FROM decision WHERE id='d'").get().payload,/changes/);}finally{backup.close();}
  store.close();store=new PolarisStore(file);assert.equal((await readdir(dir)).filter(x=>x.includes('.before-v5-')).length,1);
 }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
