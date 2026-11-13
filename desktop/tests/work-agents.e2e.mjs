import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile,copyFile,chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=await mkdtemp(path.join(tmpdir(),'polaris-task-ui-')),database=path.join(dir,'db.sqlite');
const store=new PolarisStore(database);seedDemo(store);
const out=path.join(root,'test-results'),executable=path.join(dir,'native-agent.mjs'),release=path.join(dir,'release');
await mkdir(out,{recursive:true});await copyFile(path.join(root,'tests/fixtures/native-agent.mjs'),executable);await chmod(executable,0o755);await writeFile(executable+'.json',JSON.stringify({taskReleaseFile:release,noSteer:true}));
const claude=path.join(dir,'claude-fixture.mjs');await copyFile(executable,claude);await chmod(claude,0o755);
const env={...process.env,POLARIS_TEST:'1',POLARIS_TEST_NATIVE_CODEX:executable,POLARIS_TEST_NATIVE_AGENTS:JSON.stringify({'claude-code':claude})};delete env.ELECTRON_RUN_AS_NODE;
let app;const errors=[];
const wait=async f=>{const end=Date.now()+20000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,50));}assert.fail('Timed out waiting for task state');};
async function launch() {
 app=await electron.launch({executablePath:process.env.POLARIS_APP??electronExecutable,args:[...(process.env.POLARIS_APP?[]:[root]),'--database',database,'--language','zh-Hans'],env});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
 await page.waitForSelector('.app[data-ready="true"]');
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isFocusable()||w.isFocused()||(process.env.POLARIS_TEST_VISIBLE !== '1' && w.isVisible()))),false);
 return page;
}
try{
 let page=await launch();
 await page.evaluate(async()=>{await window.polaris.call('agentNative',{action:'connect',provider:'chatgpt-codex'});await window.polaris.call('agentSend',{text:'work-rail-fixture'});});
 await wait(()=>store.query("SELECT count(*) AS n FROM agent_work WHERE provider IS NOT NULL")[0]?.n===2);
 const works=store.query('SELECT * FROM agent_work ORDER BY rowid'),a=works.find(w=>w.title==='检查客户反馈'),b=works.find(w=>w.title==='研究竞品变化');
 await wait(()=>store.query('SELECT delivery FROM agent_job WHERE workID=?',a.id)[0]?.delivery==='accepted');
 const ring=page.locator('.background-work-items .work-item.running .work-ring').first();
 await ring.waitFor();
 assert.ok(await ring.evaluate(async svg=>{
  await Promise.all(svg.parentElement.getAnimations().map(animation=>animation.finished));
  const list=svg.closest('.background-work-items').getBoundingClientRect(), bounds=svg.getBoundingClientRect();
  const centerX=(bounds.left+bounds.right)/2,centerY=(bounds.top+bounds.bottom)/2,radius=svg.clientWidth/2;
  return centerX-radius>=list.left&&centerX+radius<=list.right&&centerY-radius>=list.top&&centerY+radius<=list.bottom;
 }), 'The first running ring fits inside the scroll area throughout its rotation');
 await page.locator(`[data-work-id="${a.id}"]`).hover();await page.getByRole('tooltip').waitFor();const hint=(await page.getByRole('tooltip').innerText()).split('\n');assert.equal(hint[0],a.title);assert.match(hint[1],/^执行中|^排队中/,'R-D169: the hint names the task state');
 await page.locator(`[data-work-id="${a.id}"]`).click();
 assert.equal(await page.locator('.child-chat textarea').count(),0);
 const face=page.locator(`[data-work-id="${a.id}"] .work-face`),headerFace=page.locator('.work-chat-title .work-face');
 await face.locator('[data-avatar-scene],svg').first().waitFor();
 const avatarID=await face.getAttribute('data-avatar-id');assert.ok(avatarID.startsWith('polaris-'));
 assert.equal(await headerFace.getAttribute('data-avatar-id'),avatarID,'List and conversation use the same task avatar.');
 assert.equal(await face.evaluate(n=>getComputedStyle(n).getPropertyValue('--avatar-ink').trim()),'#fff');
 await page.emulateMedia({reducedMotion:'reduce'});await face.locator(':scope > svg').waitFor();await headerFace.locator(':scope > svg').waitFor();
 await page.emulateMedia({reducedMotion:'no-preference'});await face.locator('[data-avatar-scene]').waitFor();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await face.locator(':scope > svg').waitFor();
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await face.locator('[data-avatar-scene]').waitFor();
 await page.locator('.background-work-items').evaluate(n=>{n.style.height='1px';n.scrollTop=n.scrollHeight;});
 await face.locator(':scope > svg').waitFor();
 await page.locator('.background-work-items').evaluate(n=>{n.style.height='';n.scrollTop=0;});
 await face.locator('[data-avatar-scene]').waitFor();
 assert.equal(await face.getAttribute('data-avatar-id'),avatarID);

 const dialog=page.locator('.work-chat-dialog');
 for(const language of ['en','zh-Hant','ja','ko','fr','de','es','pt-BR','zh-Hans']){
  await page.evaluate(l=>window.polaris.setLanguage(l),language);
  await page.waitForFunction(l=>document.documentElement.lang===l,language);
  assert.ok(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth));
 }
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(980,620));
 assert.ok(await dialog.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
 await writeFile(release,'continue');
 const jobA=store.query('SELECT id FROM agent_job WHERE workID=?',a.id)[0].id;
 const jobB=store.query('SELECT id FROM agent_job WHERE workID=?',b.id)[0].id;
 const resultA=page.locator(`[data-result-id="${jobA}"]`), resultB=page.locator(`[data-result-id="${jobB}"]`);
 await wait(()=>store.query('SELECT state FROM agent_job WHERE id=?',jobA)[0]?.state==='completed');
 await wait(()=>store.query('SELECT state FROM agent_job WHERE id=?',jobB)[0]?.state==='completed');
 await resultA.waitFor({state:'detached'});
 await resultB.waitFor({state:'detached'});
 await page.locator(`[data-work-id="${a.id}"]`).waitFor({state:'detached'});
 await dialog.waitFor({state:'detached'});
 await page.waitForFunction(()=>document.activeElement?.classList.contains('main-agent-entry'));
 const card=store.query('SELECT decisionID FROM decision_source WHERE sourceJobID=?',jobA)[0];
 assert.ok(card);
 assert.equal(store.outcomes().some(o=>o.decisionID===card.decisionID),false);
 const source=await page.evaluate(workID=>window.polaris.call('agentWorkSnapshot',{workID}),a.id);
 assert.ok(source.result?.artifacts.some(artifact=>artifact.title==='阶段产物'&&artifact.body==='已整理公开资料'));
 assert.equal(source.result?.decisionCards[0].id,card.decisionID);
 await page.locator(`[data-decision-id="${card.decisionID}"]`).waitFor();
 const completed=await page.evaluate(workID=>window.polaris.call('agentWorkSnapshot',{workID}),b.id);
 assert.ok(completed.result?.messages.some(message=>message.role==='assistant'&&message.body==='已完成竞品信息检查。'));
 await app.close();
 page=await launch();
 const pending=page.locator(`[data-result-id="${jobA}"]`);
 await pending.waitFor({state:'detached'});
 await page.locator(`[data-decision-id="${card.decisionID}"]`).click();
 const modal=page.locator('.modal-content'),submit=modal.getByRole('button',{name:/^确定/});
 await modal.getByRole('heading',{name:'请提供产品网址'}).waitFor();
 assert.equal(await modal.locator('.option,.alternative').count(),0);
 assert.equal(await submit.isEnabled(),false);
 const answer='https://example.test/product';
 await modal.getByRole('textbox',{name:'你的回答'}).fill(answer);
 await submit.click();
 await wait(()=>store.query('SELECT state FROM agent_job WHERE outcomeID=(SELECT id FROM outcome WHERE decision_id=?)',card.decisionID)[0]?.state==='completed');
 const continuation=store.query('SELECT * FROM agent_job WHERE outcomeID=(SELECT id FROM outcome WHERE decision_id=?)',card.decisionID);
 assert.equal(continuation.length,1);
 assert.notEqual(continuation[0].sessionKey,a.sessionKey);
 assert.equal(store.outcomes().find(o=>o.decisionID===card.decisionID).note,answer);
 await wait(()=>store.query("SELECT body FROM agent_artifact WHERE title='调研结果'")[0]?.body===`已收到网址 ${answer}`);assert.equal(continuation[0].kind,'main');
 await pending.waitFor({state:'detached'});

 await page.evaluate(async()=>{
  await window.polaris.call('agentNative',{action:'connect',provider:'claude-code'});
  await window.polaris.call('agentNative',{action:'select',provider:'claude-code'});
  await window.polaris.call('agentSend',{text:'work-retry-fixture'});
 });
 const quotaResult=page.getByRole('button',{name:/^额度耗尽的调研 · /});
 await quotaResult.click();
 const quotaDialog=page.locator('.work-chat-dialog');
 const retry=quotaDialog.locator('.agent-recovery').getByRole('button',{name:'重试',exact:true});
 await retry.click();
 const quotaJobs=()=>store.query("SELECT j.* FROM agent_job j JOIN agent_work w ON w.id=j.workID WHERE w.title='额度耗尽的调研' ORDER BY j.seq");
 await wait(()=>quotaJobs()[1]?.state==='completed');
 const [interrupted,resumed]=quotaJobs();
 assert.equal(interrupted.state,'failed');assert.equal(interrupted.error,'native_protocol');assert.equal(resumed.sessionKey,interrupted.sessionKey);
 assert.equal(resumed.provider,'claude-code');assert.equal(resumed.origin,'retry');
 assert.equal(quotaJobs().length,2);

 // One transaction: an active strategy with an empty column would otherwise be prepared before its card arrives.
 const {strategy,lastCard}=store.transaction(()=>{
  const strategy=store.mutate('strategy','create','auto-advance-test',{requestID:randomUUID(),goalID:store.get('strategy',a.strategyID).goalID,
   title:'按需推进试用',body:'检查当前信息，必要时提请决定。',origin:'User'});
  const lastCard=store.mutate('decision','submit',undefined,{requestID:randomUUID(),strategyID:strategy.id,
   title:'采用当前方向吗？',body:'按当前方向继续调研。',options:[{id:'go',label:'采用'}]});
  return {strategy,lastCard};
 });
 const automaticJobs=()=>store.query("SELECT j.state FROM agent_job j JOIN agent_work w ON w.id=j.workID WHERE w.strategyID=? AND j.origin='auto_advance'",strategy.id);
 assert.equal(automaticJobs().length,0);
 await page.locator(`[data-decision-id="${lastCard.id}"]`).click();
 await modal.locator('.option').getByText('采用',{exact:true}).click();
 await submit.click();
 await wait(()=>automaticJobs()[0]?.state==='completed');
 const lane=page.locator('.lane').filter({has:page.getByRole('heading',{name:strategy.title,exact:true})});
 await lane.getByRole('button',{name:/先调研哪个渠道/}).waitFor();
 await lane.getByRole('button',{name:/先接触哪类商家/}).waitFor();
 assert.equal(await lane.locator('.decision-card').count(),2);
 assert.equal(automaticJobs().length,1);
 await page.waitForFunction(()=>document.querySelectorAll('.background-work-items button').length===0);
 assert.deepEqual(errors,[]);
 console.log('PASS hidden background tasks: read-only details, pending cards across restart, scoped follow-up, stable avatars, nine locales, manual retry and auto advance after the last card.');
}finally{await app?.close();store.close();await rm(dir,{recursive:true,force:true});}
