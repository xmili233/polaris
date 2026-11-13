import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,open,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PolarisStore} from '../dist-service/store.js';
import {AgentStore} from '../dist-service/agent-store.js';
import {AgentAttachments} from '../dist-service/agent-attachments.js';
import {AgentCoordinator} from '../dist-service/agent-coordinator.js';
import {emptyCapabilities} from '../dist-service/agents/types.js';
import {validateCall} from '../electron/host.mjs';
const executable=fileURLToPath(new URL('./fixtures/native-agent.mjs',import.meta.url));
const wait=async predicate=>{const deadline=Date.now()+10000;while(!predicate()&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));assert.ok(predicate());};
async function fixture(fn){const dir=await mkdtemp(path.join(tmpdir(),'polaris-files-')),store=new PolarisStore(path.join(dir,'data/db.sqlite'));new AgentStore(store);try{await fn(dir,store,new AgentAttachments(store));}finally{store.close();await rm(dir,{recursive:true,force:true});}}
test('attachment copies survive source removal and are scoped to their workspace',async()=>fixture(async(dir,store,files)=>{
 const source=path.join(dir,'文件.txt');await writeFile(source,'source content');const [file]=await files.import([source]);await rm(source);
 const manifest=JSON.parse(files.prompt([file.id]).split('\n')[3]);assert.equal(await readFile(manifest[0].path,'utf8'),'source content');
 assert.deepEqual(files.resolve([file.id]).map(item=>({...item})),[file]);assert.throws(()=>files.resolve(['../../secret']));
 const other=new PolarisStore(path.join(dir,'other/db.sqlite'));try{assert.throws(()=>new AgentAttachments(other).resolve([file.id]));}finally{other.close();}
 const data=new AgentStore(store);const id=data.send('',undefined,[file]);assert.equal(data.job(id).input,'');
 assert.equal(data.send('',id,[file]),id);assert.throws(()=>data.send('changed',id,[file]));
 await files.discard([file.id]);assert.equal(files.resolve([file.id]).length,1,'Sent attachment cannot be removed by draft cleanup.');
 assert.equal(data.snapshot().messages[0].attachments[0].name,'文件.txt');
}));
test('attachment import rolls back partial batches, rejects directories and oversized files',async()=>fixture(async(dir,store,files)=>{
 const source=path.join(dir,'small');await writeFile(source,'ok');const large=path.join(dir,'large');const handle=await open(large,'w');await handle.truncate(20*1024*1024+1);await handle.close();
 await assert.rejects(files.import([source,large]),{code:'attachment_limit'});assert.equal(store.query('SELECT * FROM agent_attachment').length,0);
 assert.deepEqual(await readdir(path.join(dir,'data/agent-attachments')),[]);await assert.rejects(files.import([dir]),{code:'attachment_file'});
 await assert.rejects(files.import(Array(11).fill(source)),{code:'attachment_limit'});
 const [file]=await files.import([source]);await files.discard([file.id]);assert.throws(()=>files.resolve([file.id]));
 assert.throws(()=>validateCall('agentAttachmentImport',{paths:[source]}),'Renderer cannot choose arbitrary filesystem paths.');
}));
test('all native providers receive readable local attachments; retries keep attachment identity',async()=>fixture(async(dir,store,files)=>{
 const oldTest=process.env.POLARIS_TEST,oldAgents=process.env.POLARIS_TEST_NATIVE_AGENTS;
 process.env.POLARIS_TEST='1';process.env.POLARIS_TEST_NATIVE_AGENTS=JSON.stringify({'claude-code':executable,'gemini-cli':executable});
 const runtime=new AgentCoordinator(store);const source=path.join(dir,'note.txt');await writeFile(source,'native attachment');const [file]=await files.import([source]);
 try{
  for(const provider of ['chatgpt-codex','claude-code','gemini-cli']){
   runtime.connections.set(provider,{provider,label:provider,installed:true,executable,version:'0.162.1',compatible:true,protocol:provider==='chatgpt-codex'?'app-server':'acp',protocolReady:true,authenticated:true,connected:true,enabled:true,account:'fixture',error:'',instructions:'',model:'',models:[],capabilities:{...emptyCapabilities(),resume:true},verified:{turn:false,tools:false,resume:false,cancel:false}});
   runtime.select(provider);assert.throws(()=>runtime.send('/compact',undefined,[file.id]),{code:'attachment_command'});
   const id=runtime.send('',undefined,[file.id]);assert.equal(runtime.send('',id,[file.id]),id);assert.throws(()=>runtime.send('',id,[]));
   await wait(()=>runtime.data.job(id).state==='completed'&&runtime.active.size===0);
   assert.equal(runtime.data.snapshot().messages.find(m=>m.id===id+':assistant').body,'Read attachment: native attachment');
  }
 }finally{await runtime.stop();if(oldTest===undefined)delete process.env.POLARIS_TEST;else process.env.POLARIS_TEST=oldTest;if(oldAgents===undefined)delete process.env.POLARIS_TEST_NATIVE_AGENTS;else process.env.POLARIS_TEST_NATIVE_AGENTS=oldAgents;}
}));
