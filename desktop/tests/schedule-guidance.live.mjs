// Opt-in: verifies a real Agent proposes timing when asked to create an ongoing strategy.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
assert.equal(process.env.POLARIS_LIVE_TEST,'1','Explicit opt-in required; uses real model quota.');delete process.env.POLARIS_TEST;
const dir=await mkdtemp(path.join(tmpdir(),'polaris-schedule-guidance-')),store=new PolarisStore(path.join(dir,'test.sqlite')),runtime=new AgentCoordinator(store);
const report={startedAt:new Date().toISOString()},output=path.resolve('test-results/schedule-guidance-live.json');
try{
 const g=store.mutate('goal','create',undefined,{requestID:randomUUID(),title:'持续了解客户反馈',milestone:'及时发现值得处理的新问题',symbol:'CircleCheck',constraints:'依据已有反馈，只向用户提交必要取舍。'});
 const connected=await runtime.connect('chatgpt-codex');assert.ok(connected.connections.find(c=>c.provider==='chatgpt-codex').connected);
 const jobID=runtime.send('这是隔离联调，只使用 Polaris MCP，不使用 shell、网络或其他工具。请在现有目标的方针下创建一条持续性策略：长期整理项目已有客户反馈文档，识别新增问题，有重要取舍再交给我。现在只完成这条策略的创建与后续安排，不启动实际检查，不创建额外目标。资料路径等执行细节留到首次执行时补充。');
 const end=Date.now()+180000;while(Date.now()<end&&!(runtime.active.size===0&&['completed','failed','needs_review'].includes(runtime.data.job(jobID).state)))await new Promise(r=>setTimeout(r,250));
 assert.equal(runtime.active.size,0);assert.equal(runtime.data.job(jobID).state,'completed');
 const board=store.snapshot();assert.equal(board.strategies.length,1);assert.equal(board.goals.length,1);
 const reply=runtime.conversation().messages.filter(m=>m.role==='assistant').at(-1)?.body;
 assert.ok(/时间|多久|频率|时区|每[天周月日]|定时/.test(reply),'Agent did not ask for timing before scheduling the strategy');
 assert.equal(store.query('SELECT * FROM scheduled_task').length,0);assert.equal(store.query('SELECT * FROM schedule_run').length,0);assert.equal(store.query('SELECT * FROM agent_job WHERE kind=\'work\'').length,0);
 report.reply=reply;
 const answerID=runtime.send('请把这条策略设为每周三上午 9 点（Asia/Taipei）运行。现在不要执行检查。');
 const answerEnd=Date.now()+180000;while(Date.now()<answerEnd&&!(runtime.active.size===0&&['completed','failed','needs_review'].includes(runtime.data.job(answerID).state)))await new Promise(r=>setTimeout(r,250));
 assert.equal(runtime.data.job(answerID).state,'completed');assert.equal(runtime.active.size,0);
 const strategies=store.snapshot().strategies;assert.equal(strategies.length,1);report.strategy=strategies[0].title;
 const saved=runtime.schedules.snapshot(strategies[0].id);assert.equal(saved.tasks.length,1);assert.ok(saved.nextAt);assert.deepEqual(saved.tasks[0].config.rule,{frequency:'weekly',days:[3],time:'09:00'});
 assert.equal(store.query('SELECT * FROM scheduled_task').length,1);assert.equal(store.snapshot().decisions.length,0);assert.equal(store.query('SELECT * FROM schedule_run').length,0);
 report.scheduleAfterAnswer=saved.tasks[0].config;report.passed=true;
 console.log('PASS real Codex: strategy is saved while timing still needs agreement; actual text answer creates one schedule, no approval card or execution');
}catch(error){report.passed=false;report.error=String(error);report.jobs=store.query('SELECT state,error,delivery FROM agent_job');throw error;}
finally{report.finishedAt=new Date().toISOString();await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}