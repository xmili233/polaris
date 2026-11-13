import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, chmod, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { PolarisStore } from '../dist-service/store.js';
import { codexModel, acpModelOptions, validateModelSettings } from '../dist-service/agents/models.js';
import { applyModelCatalog } from '../dist-service/agents/model-catalog.js';
import { discover, inspectConnection } from '../dist-service/agents/discovery.js';
import { acpSessionCatalog, connectACP } from '../dist-service/agents/acp.js';
import { connectCodex } from '../dist-service/agents/codex.js';
import { emptyCapabilities } from '../dist-service/agents/types.js';
process.env.POLARIS_TEST = '1';
const raw = { id:'picker-id', model:'model-id', displayName:'Model', isDefault:true, defaultReasoningEffort:'medium', supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'medium'},{reasoningEffort:'high'}], serviceTiers:[{id:'priority',name:'Fast'},{id:'ultrafast',name:'Ultrafast'}] };
const effort = {id:'effort',category:'thought_level',type:'select',name:'Effort',currentValue:'default',options:[{value:'default',name:'Default'},{value:'low',name:'Low'},{value:'high',name:'High'}]};
const speed = {id:'fast',category:'model_config',type:'select',name:'Fast',currentValue:'off',options:[{value:'off',name:'Off'},{value:'on',name:'On'}]};
const wait = async f => {const end=Date.now()+5000;while(!f()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert.ok(f());};
async function fixture(provider, config, fn) {
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-model-options-')),file=path.join(dir, provider==='chatgpt-codex'?'codex.mjs':'claude-config-model.mjs');
 await copyFile(new URL('./fixtures/native-agent.mjs',import.meta.url),file);await chmod(file,0o755);await writeFile(file+'.json',JSON.stringify(config));
 const old=process.env.POLARIS_TEST_NATIVE_AGENTS;process.env.POLARIS_TEST_NATIVE_AGENTS=JSON.stringify({[provider]:file});
 try {const connection=await inspectConnection(await discover(provider));await fn({connection,file,dir});}finally{if(old===undefined)delete process.env.POLARIS_TEST_NATIVE_AGENTS;else process.env.POLARIS_TEST_NATIVE_AGENTS=old;await rm(dir,{recursive:true,force:true});}
}
const options = connection => ({connection,cwd:tmpdir(),mcp:{command:'',args:[],env:{}},onSession(){},onRun(){},onEvent(){},permission:async()=>''});

test('Codex catalog keeps native model IDs, default reasoning and both speed protocols',()=>{
 const model=codexModel(raw);assert.equal(model.id,'model-id');assert.equal(model.options[0].defaultValue,'medium');assert.equal(model.options[1].choices[1].fast,true);
 assert.deepEqual(codexModel({...raw,serviceTiers:undefined,additionalSpeedTiers:['fast']}).options[1].choices.map(c=>c.value),['default','fast']);
 assert.throws(()=>validateModelSettings(model,{serviceTier:'made-up'}),{code:'native_models'});
 assert.throws(()=>validateModelSettings(model,[]),{code:'invalid_input'});
 assert.deepEqual(validateModelSettings(model,{reasoningEffort:'high',serviceTier:'priority'}),{reasoningEffort:'high',serviceTier:'priority'});
});
test('ACP options belong only to the selected model and preserve per-model observations',()=>{
 const model={id:'model',type:'select',category:'model',currentValue:'a',options:[{value:'a',name:'A'},{value:'b',name:'B'}]};
 const first=acpSessionCatalog({configOptions:[model,effort,speed]});assert.equal(first.models[0].options.length,2);assert.equal(first.models[1].options,undefined);
 const second=acpSessionCatalog({configOptions:[{...model,currentValue:'b'}]},first.models);assert.equal(second.models[0].options.length,2);assert.deepEqual(second.models[1].options,[]);
 assert.equal(acpModelOptions([{...speed,type:'boolean',currentValue:false}])[0].choices[1].value,true);
});
test('T3 metadata supplements advertised Claude models but cannot invent native options or models',()=>{
 const connection={provider:'claude-code',version:'2.1.312'};
 const fallback=applyModelCatalog(connection,[{id:'claude-opus-5-5',name:'Opus'}]);assert.ok(fallback[0].options.some(o=>o.id==='fast'));
 assert.deepEqual(applyModelCatalog(connection,[{id:'claude-opus-5-5',name:'Opus',options:[]}])[0].options,[]);
 assert.equal(applyModelCatalog({...connection,version:'2.1.100'},[{id:'claude-opus-5-5',name:'Opus'}])[0].options,undefined);
 assert.deepEqual(applyModelCatalog(connection,[]),[]);
});
test('discovery reads all Codex pages and actual turn requests carry reasoning and standard speed override',()=>fixture('chatgpt-codex',{modelPages:[[raw],[{...raw,id:'b',model:'b'}]],codexConfig:{service_tier:'priority'}},async({connection,file,dir})=>{
 assert.equal(connection.connected,true);assert.deepEqual(connection.models.map(m=>m.id),['model-id','b']);assert.equal(connection.models[0].options[1].currentValue,'priority');
 const trace=path.join(dir,'trace');await writeFile(file+'.json',JSON.stringify({trace,traceTurns:true}));
 const session=await connectCodex(options({...connection,model:'model-id',modelSettings:{reasoningEffort:'high',serviceTier:'default'}}));
 try {await session.prompt('hello');}finally{await session.close();}
 const events=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);const turn=events.find(e=>e.method==='turn/start');assert.equal(turn.effort,'high');assert.equal(turn.serviceTierForTurn,'default');assert.equal(turn.model,'model-id');
}));
test('ACP applies model-specific options before the prompt and rejects a setting the runtime does not apply',()=>fixture('claude-code',{acpOptions:{'first-model':[effort,speed],'second-model':[]}},async({connection,file,dir})=>{
 assert.equal(connection.connected,true);assert.equal(connection.models[0].options.length,2);
 const trace=path.join(dir,'trace');await writeFile(file+'.json',JSON.stringify({trace,acpOptions:{'first-model':[effort,speed]}}));
 const choice={...connection,model:'first-model',modelSettings:{effort:'high',fast:'on'}};
 const session=await connectACP(options(choice));try{await session.prompt('hello');}finally{await session.close();}
 const events=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(events.filter(e=>e.method==='session/set_config_option').map(e=>[e.configId,e.value]),[['agent-model','first-model'],['effort','high'],['fast','on']]);
 await writeFile(file+'.json',JSON.stringify({rejectOptions:true,acpOptions:{'first-model':[effort,speed]}}));
 await assert.rejects(connectACP(options(choice)),{code:'native_models'});
}));
test('queued messages retain options across later selection; changed options do not steer',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'polaris-pinned-options-')),store=new PolarisStore(path.join(dir,'db'));seedDemo(store);
 let finish;const turns=[],steers=[];
 const driver=async o=>({id:'session',capabilities:emptyCapabilities(),canSteer:()=>true,steer:async()=>{steers.push(true);return true;},prompt:async text=>{o.onSession('session');o.onRun('turn');turns.push(structuredClone(o.connection.modelSettings));if(text.endsWith('hold'))await new Promise(r=>finish=r);return{status:'completed'};},cancel:async()=>finish?.(),close:async()=>finish?.()});
 const runtime=new AgentCoordinator(store,()=>{},(driver));
 const connection={provider:'chatgpt-codex',connected:true,enabled:true,model:'model-id',models:[codexModel(raw)],version:'0.162.1',account:'fixture',executable:'fixture',capabilities:emptyCapabilities(),verified:{},protocol:'app-server'};
 runtime.connections.set('chatgpt-codex',connection);
 runtime.modelOptions=async(provider,model)=>runtime.connections.get(provider).models.find(item=>item.id===model);
 try {
  await runtime.chooseModel('chatgpt-codex','model-id',undefined,{reasoningEffort:'low',serviceTier:'default'});
  runtime.send('hold');await wait(()=>turns.length===1);
  await runtime.chooseModel('chatgpt-codex','model-id',undefined,{reasoningEffort:'high',serviceTier:'priority'});
  const queued=runtime.send('next');assert.equal(runtime.data.job(queued).state,'queued');assert.equal(steers.length,0);
  await runtime.chooseModel('chatgpt-codex','model-id',undefined,{reasoningEffort:'medium',serviceTier:'default'});
  finish();await wait(()=>turns.length===2);assert.deepEqual(turns[1],{reasoningEffort:'high',serviceTier:'priority'});
  await wait(()=>runtime.active.size===0);
  await runtime.selectSubModel('chatgpt-codex','model-id',{reasoningEffort:'high',serviceTier:'priority'});
  const work=runtime.data.createWork(store.snapshot().strategies[0].id,'Background','Pinned background settings');
  runtime.queueWork(work.instructions,work.id);
  await runtime.selectSubModel('chatgpt-codex','model-id',{reasoningEffort:'low',serviceTier:'default'});
  runtime.pump();await wait(()=>turns.length===3&&runtime.active.size===0);
  assert.deepEqual(turns[2],{reasoningEffort:'high',serviceTier:'priority'});

 }finally{await runtime.stop();store.close();await rm(dir,{recursive:true,force:true});}
});
