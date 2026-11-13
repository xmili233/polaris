import { seedDemo } from './fixtures/seed.mjs';
import { _electron as electron } from 'playwright';
import executable from 'electron';
import assert from 'node:assert/strict';
import {  randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';
import { languages, translator } from '@polaris/i18n';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=await mkdtemp(path.join(tmpdir(),'polaris-native-e2e-')),database=path.join(directory,'test.sqlite');
const store=new PolarisStore(database);seedDemo(store);
const gemini=path.join(directory,'gemini-fixture.mjs');
await writeFile(gemini,`#!/usr/bin/env node\nimport ${JSON.stringify(new URL('./fixtures/native-agent.mjs',import.meta.url).href)};\n`,{mode:0o755});
await symlink(gemini,path.join(directory,'gemini'));
const env={...process.env,PATH:`${directory}:${process.env.PATH}`,POLARIS_TEST:'1',POLARIS_TEST_NATIVE_CODEX:path.join(root,'tests/fixtures/native-agent.mjs')};env.POLARIS_TEST_NATIVE_AGENTS=JSON.stringify({'gemini-cli':gemini});delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app=await electron.launch({executablePath:process.env.POLARIS_APP??executable,args:[...(process.env.POLARIS_APP?[]:[root]),'--user-data-dir',path.join(directory,'profile'),'--database',database,'--language','en'],env});
 const page=await app.firstWindow();await page.waitForSelector('.app[data-ready="true"]');
 assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isFocused()||w.isFocusable())),false);
 const snapshot=()=>page.evaluate(async()=>{const response=await window.polaris.call('agentSnapshot');if(response.error)throw new Error(response.error.message);return response.result;});
 async function until(predicate) { const deadline=Date.now()+15000; while(Date.now()<deadline){const value=await snapshot();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error('Timed out waiting for the specific native job state'); }
 await page.evaluate(()=>window.polaris.call('agentNative',{action:'connect',provider:'chatgpt-codex'}));
 await page.locator('.main-agent-entry').click();
 // The dialog slides in from the rail (R-D169); measure the anchor once it has settled.
 const still=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 const input=page.locator('.agent-input textarea');await input.waitFor();await still();const before=await input.boundingBox();await input.fill('artifact-fixture');
 await page.locator('.agent-welcome').waitFor();
 async function submitted(text, submit=()=>page.locator('.agent-send').click()) {
  const ids=(await snapshot()).jobs.map(job=>job.id);await input.fill(text);await submit();
  await until(s=>s.jobs.some(j=>j.input===text&&!ids.includes(j.id)));
  return (await snapshot()).jobs.find(job=>job.input===text&&!ids.includes(job.id)).id;
 }
 async function settled(id,state) {
  await until(s=>s.jobs.find(j=>j.id===id)?.state===state&&!s.native.activeJobIDs.includes(id));
 }
 const artifact=await submitted('artifact-fixture');await settled(artifact,'completed');console.log('artifact completed',artifact);
 assert.equal((await snapshot()).messages.find(m=>m.id===artifact+':assistant').body,'Native fixture completed.');
 assert.equal(await page.locator('.agent-answer button[title*="Copy"]').count(),0);
 const permission=await submitted('permission-fixture');
 await settled(permission,'completed');assert.equal((await snapshot()).native.permissions.length,0);console.log('full access completed',permission);
 assert.equal((await snapshot()).messages.find(m=>m.id===permission+':assistant').state,'completed');
 const forced=await submitted('forced-permission-fixture');await until(s=>s.native.permissions.some(p=>p.jobID===forced));
 for(const {code} of languages){
  await page.evaluate(language=>window.polaris.setLanguage(language),code);
  await page.waitForFunction(language=>document.documentElement.lang===language,code);
  await page.locator('.agent-permission').getByRole('button',{name:translator(code)('permissions.allowOnce'),exact:true}).waitFor();
  assert.equal((await snapshot()).native.permissions.find(p=>p.jobID===forced).options[0].id,'accept');
 }
 await page.evaluate(()=>window.polaris.setLanguage('en'));await page.waitForFunction(()=>document.documentElement.lang==='en');
 await page.getByRole('button',{name:'Allow once',exact:true}).click();await settled(forced,'completed');
 const hold=await submitted('hold-fixture');
 await until(s=>s.jobs.find(j=>j.id===hold)?.delivery==='accepted');
 await page.locator('.agent-send').click();await settled(hold,'cancelled');console.log('hold cancelled',hold);
 await page.locator(`.agent-answer[data-job-id="${hold}"]`).getByText('Stopped',{exact:true}).waitFor();
 await page.locator(`.agent-answer[data-job-id="${permission}"]`).getByText('Native fixture completed.',{exact:true}).waitFor();
 const held=await snapshot();assert.equal(held.jobs.find(j=>j.id===permission).state,'completed');assert.equal(held.jobs.find(j=>j.id===hold).state,'cancelled');assert.equal(held.native.activeJobIDs.length,0);
 const steered=await submitted('hold-fixture');await until(s=>s.jobs.find(j=>j.id===steered)?.delivery==='accepted');
 await input.fill('finish-steer-fixture');await input.press('Enter');await settled(steered,'completed');
 assert.ok((await snapshot()).messages.some(m=>m.inputKind==='steer'&&m.body==='finish-steer-fixture'&&m.state==='accepted'));
 await page.getByText('Sent to the current task',{exact:true}).waitFor();
 await page.screenshot({path:path.join(root,'test-results/agent-runtime-steering.png')});
 await still();assert.deepEqual(await input.boundingBox(),before,'Native controls must not move the input anchor');
 assert.equal(store.query('SELECT body FROM agent_artifact WHERE jobID=?',artifact)[0].body,'Native MCP result');
 // R-D173: cards come from strategy rounds; this one stands in for a round's card while the user chats.
 const strategy=store.snapshot().strategies.find(item=>item.goalID===store.snapshot().goals[0].id);
 const card=store.mutate('decision','submit',undefined,{requestID:randomUUID(),strategyID:strategy.id,title:'Choose a route',body:'Two routes',excerpt:'Route A draft',
  options:[{id:'a',label:'A',detail:'First route'},{id:'b',label:'B',detail:'Second route'}],recommendedOptionID:'a'});
 const typed=await submitted('A');await settled(typed,'completed');
 assert.ok(!store.outcomes().some(item=>item.decisionID===card.id),'Chat text cannot confirm a card.');
 await page.locator('.agent-input textarea').press('Escape');await page.locator('.work-chat-dialog').waitFor({state:'detached'});
 await page.locator(`[data-decision-id="${card.id}"]`).click();
 const decision=page.getByRole('dialog',{name:'Choose a route'});
 await decision.getByText('Route A draft',{exact:true}).waitFor();
 await decision.getByRole('button',{name:/First route/}).click();
 await decision.locator('button.confirm').click();
 await decision.waitFor({state:'detached'});
 const outcome=store.outcomes().find(item=>item.decisionID===card.id);
 assert.equal(outcome?.optionID,'a');assert.equal(outcome?.decisionVersion,card.version);
 assert.equal(store.query('SELECT id FROM agent_job WHERE outcomeID=?',outcome.id).length,1);
 await mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results/native-agent.png')});await writeFile(path.join(root,'test-results/native-agent-state.json'),JSON.stringify({artifact,permission,hold,jobs:held.jobs,activeJobIDs:held.native.activeJobIDs},null,2));
 await page.locator('.main-agent-entry').click();
 // Native file picking is mocked only at the OS dialog boundary; copying, storage and sending are real.
 const source=path.join(directory,'note.txt');await writeFile(source,'uploaded content');
 await app.evaluate(({dialog},source)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});},source);
 await page.getByRole('button',{name:'Attach files',exact:true}).click();await page.locator('.agent-input .agent-attachment').waitFor();
 await page.getByRole('button',{name:'Remove attachment note.txt',exact:true}).click();await page.locator('.agent-input .agent-attachment').waitFor({state:'detached'});
 await page.getByRole('button',{name:'Attach files',exact:true}).click();await page.locator('.agent-input .agent-attachment').waitFor();
 await rm(source);await input.fill('/compact');await input.press('Enter');
 await page.getByRole('alert').filter({hasText:'Send attachments with a message'}).waitFor();
 assert.equal(await input.inputValue(),'/compact');assert.equal(await page.locator('.agent-input .agent-attachment').count(),1);
 await page.locator('.agent-input').screenshot({path:path.join(root,'test-results/agent-attachments.png')});
 const upload=await submitted('read-upload-fixture',()=>input.press('Enter'));await settled(upload,'completed');
 assert.equal((await snapshot()).messages.find(m=>m.id===upload+':assistant').body,'Read attachment: uploaded content');
 assert.equal((await snapshot()).messages.find(m=>m.id===upload+':user').attachments[0].name,'note.txt');
 assert.equal(await page.locator('.agent-input .agent-attachment').count(),0);
 await writeFile(source,'file only');await page.getByRole('button',{name:'Attach files',exact:true}).click();await page.locator('.agent-input .agent-attachment').waitFor();
 const only=await submitted('');await settled(only,'completed');assert.equal((await snapshot()).messages.find(m=>m.id===only+':assistant').body,'Read attachment: file only');
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 await page.getByRole('button',{name:'Attach files',exact:true}).click();assert.equal(await page.locator('.agent-input .agent-attachment').count(),0);
 // R-D113: model choice is in the composer and Settings, never the chat header.
 assert.equal(await page.locator('.agent-header select, .agent-header [aria-haspopup]').count(),0);
 await input.press('Meta+Comma');const settings=page.getByRole('dialog',{name:'Settings'});
 await settings.getByRole('tab',{name:'Model',exact:true}).click();
 await settings.locator('.agent-model-trigger').first().click();
 await page.getByRole('option',{name:'Second',exact:true}).waitFor();await page.waitForTimeout(250);await page.screenshot({path:path.join(root,'test-results/settings-options.png')});
 await page.getByRole('option',{name:'Second',exact:true}).click();
 await until(s=>s.native.selected==='gemini-cli'&&s.native.connections.find(c=>c.provider==='gemini-cli')?.model==='second-model');console.log('gemini connected');
 assert.match(await settings.locator('.agent-model-trigger').first().textContent(),/Second/);
 await page.keyboard.press('Escape');await settings.waitFor({state:'detached'});
 const model=await submitted('model-fixture');await settled(model,'completed');
 assert.equal((await snapshot()).messages.find(m=>m.id===model+':assistant').body,'Native model: second-model');
 await input.fill('/');await page.getByRole('option').last().waitFor();assert.equal(await page.getByRole('option').count(),3);
 await input.press('ArrowDown');assert.equal(await page.getByRole('option',{selected:true}).locator('.agent-command-name').textContent(),'help');
 await input.press('Tab');assert.equal(await input.inputValue(),'/help');
 const ids=(await snapshot()).jobs.map(job=>job.id);await input.press('Enter');
 await until(s=>s.jobs.some(j=>j.input==='/help'&&!ids.includes(j.id)));
 const command=(await snapshot()).jobs.find(j=>j.input==='/help'&&!ids.includes(j.id));await settled(command.id,'completed');
 await input.fill('/');await input.press('ArrowUp');assert.equal(await page.getByRole('option',{selected:true}).locator('.agent-command-name').textContent(),'status');await input.press('Escape');
 console.log('PASS native hidden Electron: full tool access, preserved mandatory approval, exact job completion, cancellation with no active run, ACP models, all declared commands and keyboard navigation, fixed input anchor.');
} finally {await app?.close();store.close();await rm(directory,{recursive:true,force:true});}
