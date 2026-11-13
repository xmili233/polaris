import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { StrategyScheduler } from '../dist-service/strategy-schedule.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), dir=await mkdtemp(path.join(tmpdir(),'polaris-schedule-ui-')), database=path.join(dir,'db.sqlite');
const store=new PolarisStore(database);seedDemo(store);const strategyID='scheduled-research',decisionCount=store.snapshot().decisions.length;
const env={...process.env,POLARIS_TEST:'1',POLARIS_TEST_NATIVE_CODEX:path.join(root,'tests/fixtures/native-agent.mjs')};delete env.ELECTRON_RUN_AS_NODE;
const results=path.join(root,'test-results');await mkdir(results,{recursive:true});
let app;const errors=[];
const wait=async (fn,timeout=25000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.fail('Timed out waiting for schedule state');};
try{
 app=await electron.launch({executablePath:process.env.POLARIS_APP??electronExecutable,args:[...(process.env.POLARIS_APP?[]:[root]),'--database',database,'--language','zh-Hans'],env});
 let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.app[data-ready="true"]');
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isFocusable()||w.isFocused())),false);
 assert.equal(await page.locator('.schedule-button').count(),0,'No separate schedule navigation');
 await page.screenshot({path:path.join(results,'schedule-empty.png')});
 // The Agent saves a strategy and separately creates its agreed timing.
 await page.evaluate(async()=>{await window.polaris.call('agentNative',{action:'connect',provider:'chatgpt-codex'});await window.polaris.call('agentSend',{text:'schedule-fixture'});});
 await wait(()=>store.query('SELECT id FROM scheduled_task').length===1);
 await page.locator(`[data-strategy-id="${strategyID}"]`).waitFor();
 assert.equal(store.get('strategy',strategyID).title,'定时调研');
 const data=new AgentStore(store),scheduler=new StrategyScheduler(store,data,()=>{throw Error('UI fixture does not dispatch')});
 const future=scheduler.save(strategyID,{title:'明天查看回复',instructions:'INTERNAL_TASK_INSTRUCTIONS',config:{rule:{frequency:'once',at:'2099-01-01T09:00:00Z'}}});
 assert.equal(scheduler.snapshot(strategyID).tasks.length,2);
 await page.getByLabel('定时任务',{exact:true}).waitFor();
 assert.equal(store.snapshot().decisions.length,decisionCount);
 assert.equal(store.query('SELECT * FROM agent_job WHERE outcomeID IS NOT NULL').length,0);
 // Close the only hidden window. Execution must still happen without any renderer polling.
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.close()));
 await wait(()=>store.query("SELECT j.state FROM schedule_run r JOIN agent_job j ON j.id=r.jobID")[0]?.state==='completed');
 const result=store.query("SELECT m.body FROM schedule_run r JOIN agent_message m ON m.id=r.jobID||':assistant'")[0];assert.equal(result.body,'Native fixture completed.');
 // Crash the service after completion; a main-process resume must recreate it without repeating completed work.
 const previous=await app.evaluate(({app})=>app.getAppMetrics().find(m=>m.name==='Polaris local service')?.pid);assert.ok(previous);
 await app.evaluate(({},pid)=>process.kill(pid,'SIGKILL'),previous);
 await new Promise(r=>setTimeout(r,200));await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));
 await wait(async()=>await app.evaluate(({app},pid)=>app.getAppMetrics().some(m=>m.name==='Polaris local service'&&m.pid!==pid),previous));
 assert.equal(store.query('SELECT * FROM schedule_run WHERE workID IS NOT NULL').length,1);
 await app.evaluate(({app})=>app.emit('activate'));page=await app.firstWindow();await page.waitForSelector('.app[data-ready="true"]');
 await page.locator(`[data-strategy-id="${strategyID}"]`).click();
 const records=page.locator('.strategy-records');
 await records.getByText('核对公开资料',{exact:true}).waitFor();
 assert.deepEqual(scheduler.snapshot(strategyID).tasks.map(task=>task.id),[future.id],'The future task remains after the first run finishes');
 assert.doesNotMatch(await records.innerText(),/明天查看回复|INTERNAL_TASK_INSTRUCTIONS|Native fixture completed\./);
 for(const language of ['en','zh-Hant','ja','ko','fr','de','es','pt-BR']){
  await page.evaluate(language=>window.polaris.setLanguage(language),language);await page.waitForFunction(l=>document.documentElement.lang===l,language);
  assert.ok(await page.locator('.strategy-records').evaluate(n=>n.scrollWidth<=n.clientWidth),language+' records overflow');
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,620));
 await page.screenshot({path:path.join(results,'strategy-records-compact.png')});
 await page.locator('.strategy-records').press('Tab');assert.ok(await page.locator('.strategy-records').evaluate(n=>n.contains(document.activeElement)));
 // Cancelling a future task leaves the completed run and clears the board clock.
 await page.evaluate(async()=>{await window.polaris.setLanguage('zh-Hans');await window.polaris.call('agentNative',{action:'disconnect',provider:'chatgpt-codex'});});
 await page.getByLabel('定时任务',{exact:true}).waitFor();
 scheduler.cancel(strategyID,future.id,future.version);
 assert.equal(scheduler.snapshot(strategyID).tasks.length,0);
 assert.equal(store.query('SELECT * FROM schedule_run WHERE workID IS NOT NULL').length,1);
 await page.locator('.strategy-records').press('Escape');
 await page.getByLabel('定时任务',{exact:true}).waitFor({state:'detached'});
 const strategy=store.get('strategy',strategyID);store.mutate('strategy','archive',strategyID,{requestID:'archive-schedule-test',expectedVersion:strategy.version});
 await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));await page.locator(`[data-strategy-id="${strategyID}"]`).waitFor({state:'detached'});
 scheduler.stop();
 assert.deepEqual(errors,[]);console.log('PASS hidden schedule UI: separate strategy and timing save → no approval card → window closed → native result → service restart; schedule clock, nine locales and keyboard exits');
}finally{await app?.close();store.close();await rm(dir,{recursive:true,force:true});}
