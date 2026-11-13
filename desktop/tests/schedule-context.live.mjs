// Opt-in: one real Codex run against an isolated strategy and timing-only schedule.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
assert.equal(process.env.POLARIS_LIVE_TEST,'1','Explicit opt-in required; uses real model quota.');delete process.env.POLARIS_TEST;
const dir=await mkdtemp(path.join(tmpdir(),'polaris-schedule-context-live-')),store=new PolarisStore(path.join(dir,'test.sqlite')),runtime=new AgentCoordinator(store);
const report={startedAt:new Date().toISOString(),checks:[]},output=path.resolve('test-results/schedule-context-live.json');
const record=text=>{report.checks.push(text);console.log('PASS '+text);};
const create=(kind,values)=>store.mutate(kind,'create',undefined,{requestID:randomUUID(),...values});
try{
 const goal=create('goal',{title:'验证定时任务读取当前业务上下文',milestone:'根据当前策略保存一份测试产物后结束，不处理真实业务',symbol:'CircleCheck',constraints:'Use only Polaris MCP. Do not use shell, network or external tools.'});
 const strategy=create('strategy',{ goalID:goal.id,title:'记录当前验证标记',body:'OUTDATED_STRATEGY_MARKER',origin:'User'});
 const connected=await runtime.connect('chatgpt-codex');assert.ok(connected.connections.find(c=>c.provider==='chatgpt-codex').connected);
 let now=new Date();runtime.schedules.clock=()=>now;const at=new Date(now.getTime()+1000).toISOString();
 const config={timezone:'Asia/Taipei',rule:{frequency:'once',at}};
 runtime.schedules.save(strategy.id,{title:'验证当前上下文',instructions:'Read the CURRENT strategy through get_context and carry out its authorized instructions.',config});
 now=new Date(at);runtime.schedules.start();
 store.mutate('strategy','update',strategy.id,{requestID:randomUUID(),expectedVersion:strategy.version,goalID:goal.id,title:strategy.title,body:'这是一次隔离联调。先用 get_context 读取当前目标、约束和策略，再用 write_artifact 保存唯一产物，标题“策略上下文验证”，正文为 CURRENT_STRATEGY_OK。不要调用外部工具、创建子任务、修改其他数据或提交决策卡。产物保存后简短回复并结束。',origin:'User'});
 runtime.pump();const job=store.query('SELECT * FROM agent_job')[0];const end=Date.now()+180000;
 while(Date.now()<end&&!(runtime.active.size===0&&['completed','failed','needs_review'].includes(runtime.data.job(job.id).state)))await new Promise(r=>setTimeout(r,250));
 assert.equal(runtime.data.job(job.id).state,'completed');assert.equal(runtime.active.size,0);
 const artifacts=store.query('SELECT title,body FROM agent_artifact');assert.equal(artifacts.length,1);assert.equal(artifacts[0].title,'策略上下文验证');assert.match(artifacts[0].body,/CURRENT_STRATEGY_OK/);assert.doesNotMatch(artifacts[0].body,/WRONG_RESULT|OUTDATED_STRATEGY_MARKER/);
 assert.equal(store.snapshot().decisions.length,0);assert.equal(runtime.works().length,0);report.artifact=artifacts[0];report.input=runtime.data.job(job.id).input;
 record('real scheduled Agent used updated strategy, produced the requested artifact, ignored retired instructions and ended');report.passed=true;
}catch(error){report.passed=false;report.error=String(error);report.jobs=store.query('SELECT state,error,delivery FROM agent_job');throw error;}
finally{report.finishedAt=new Date().toISOString();await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}