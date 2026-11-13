#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const settings = () => { try { return JSON.parse(readFileSync(process.argv[1]+'.json','utf8')); } catch { return {}; } };
if (process.argv.includes('--version')) { if(settings().versionDelay)await new Promise(r=>setTimeout(r,settings().versionDelay));console.log(settings().version ?? (process.argv[1].includes('opencode') ? '1.15.5' : process.argv[1].includes('gemini') ? '0.66.0' : process.argv[1].includes('claude') ? '2.1.312' : '0.162.1')); process.exit(); }
if (process.argv.includes('auth') && process.argv.includes('status')) { console.log(JSON.stringify({loggedIn:!settings().signedOut,authMethod:'claude.ai',email:'fixture@example.test'}));process.exit(settings().signedOut ? 1 : 0); }
const opencode = process.argv.includes('acp');
const slowInit = process.argv[1].includes('slow-init'), slowAuth = process.argv[1].includes('slow-auth'), configModel = process.argv[1].includes('config-model') || !!settings().acpOptions;
if (slowInit || slowAuth) writeFileSync(process.argv[1] + '.pid', String(process.pid));
let selectedModel = settings().defaultModel ?? 'first-model';
let permissionMode = 'default', fullAccess = false;
const fullMode = opencode ? 'build' : process.env.CLAUDE_CODE_EXECUTABLE ? 'bypassPermissions' : 'yolo';
const record = data => { if (settings().trace) appendFileSync(settings().trace, JSON.stringify({pid:process.pid,...data}) + '\n'); };
const models = { currentModelId: selectedModel, availableModels: settings().acpModels ?? [{ modelId: 'first-model', name: 'First' }, { modelId: 'second-model', name: 'Second' }] };
const selectedOptions = {};
const configOptions = () => [{ id: 'agent-model', category: 'model', type: 'select', name: 'Model', currentValue: selectedModel, options: models.availableModels.map(model => ({ value: model.modelId, name: model.name })) }, ...(settings().acpOptions?.[selectedModel] ?? []).map(option => ({ ...option, currentValue: selectedOptions[option.id] ?? option.currentValue }))];
const write = message => process.stdout.write(JSON.stringify(message) + '\n');
const notify = (method, params) => write({ jsonrpc: '2.0', method, params });
const responses = new Map();
let session = '', run = '', mcp, child, cancelled = false, acp = opencode || process.argv.includes('--acp');
const tool = async (name, args) => {
  if (!child) {
    child = spawn(mcp.command, mcp.args, { env: { ...process.env, ...mcp.env }, stdio: 'pipe' });
    const lines = createInterface({ input: child.stdout }); child.pending = new Map();
    lines.on('line', line => { const result = JSON.parse(line); child.pending.get(result.id)?.(result.result); });
    child.stderr.resume();
  }
  const id = randomUUID(); return new Promise(resolve => { child.pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n'); });
};
const readContext=async()=>{
  let context=JSON.parse((await tool('get_context',{goal_id:''})).content[0].text);
  if(!context.board && context.goals.length)context=JSON.parse((await tool('get_context',{goal_id:context.goals[0].id})).content[0].text);
  return context;
};
process.on('exit', () => child?.kill());
process.on('SIGTERM', () => { child?.kill(); process.exit(); });
const lines = createInterface({ input: process.stdin });
lines.on('close', () => { child?.kill(); process.exit(); });
lines.on('line', async line => {
  const message = JSON.parse(line), p = message.params ?? {};
  if (!message.method) { responses.get(message.id)?.(message.result ?? message.error); return; }
  const reply = result => write({ jsonrpc: '2.0', id: message.id, result });
  if (message.method === 'initialize' && settings().manualAuth) { process.stdout.write('Please visit the following URL to authorize the application:\n'); return; }
  if (message.method === 'initialize' && slowInit) await new Promise(resolve => setTimeout(resolve, 60_000));
  if (message.method === 'initialize') return reply(acp ? { protocolVersion: 1, agentCapabilities: { loadSession: true } } : { userAgent: 'fixture' });
  if (message.method === 'account/read') return reply({ account: settings().signedOut ? null : { type: 'chatgpt', email: process.argv[1].includes('different-account') ? 'other@example.test' : 'fixture@example.test' } });
  if (message.method === 'model/list') {
    const pages = settings().modelPages;
    return reply(pages ? { data: pages[Number(p.cursor ?? 0)], nextCursor: Number(p.cursor ?? 0) + 1 < pages.length ? String(Number(p.cursor ?? 0) + 1) : null } : { data: settings().models ?? [{ id: 'fixture', displayName: 'Fixture' }] });
  }
  if (message.method === 'config/read') return reply({ config: settings().codexConfig ?? {} });
  if (message.method === 'thread/unsubscribe') { record({method:message.method}); return reply({}); }
  if (['thread/start','thread/resume','session/new','session/load'].includes(message.method)) {
    child?.kill(); child = undefined;
    if (acp && settings().signedOut) return write({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Authentication required'}});
    if (slowAuth) await new Promise(resolve => setTimeout(resolve, 60_000));
    session = p.threadId ?? p.sessionId ?? 'native-session';
    mcp = acp ? { ...p.mcpServers[0], env: Object.fromEntries((p.mcpServers[0]?.env ?? []).map(e => [e.name,e.value])) } : p.config.mcp_servers.polaris;
    permissionMode = 'default';
    fullAccess = opencode ? JSON.parse(process.env.OPENCODE_PERMISSION ?? '{}')['*'] === 'allow' : !acp && p.approvalPolicy === 'never' && p.sandbox === 'danger-full-access' && mcp.default_tools_approval_mode === 'approve';
    record({method:message.method,excludeTurns:p.excludeTurns,approvalPolicy:p.approvalPolicy,sandbox:p.sandbox,mcpApproval:mcp?.default_tools_approval_mode,cwd:p.cwd,permission:process.env.OPENCODE_PERMISSION,args:process.argv.slice(2)});
    if (acp) notify('session/update', { sessionId: session, update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compress', description: 'Compress context' }, { name: 'help', description: 'Show help' }, { name: 'status', description: 'Show status' }] } });
    return reply(acp ? { sessionId: session, modes:{currentModeId:permissionMode,availableModes:[{id:'default',name:'Default'},...(!settings().noFullMode ? [{id:fullMode,name:'Full access'}] : [])]}, ...(configModel ? { configOptions: configOptions() } : { models }) } : { thread: { id: session } });
  }
  if (message.method === 'session/set_mode') {
    record({method:message.method,modeId:p.modeId});
    if (settings().noFullMode || p.modeId !== fullMode) throw new Error('Unsupported mode');
    if (settings().rejectFullMode) return write({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'Mode restricted by native policy'}});
    permissionMode=p.modeId;if(!opencode)fullAccess=true;return reply({});
  }
  if (message.method === 'session/set_model') { selectedModel = p.modelId; return reply({}); }
  if (message.method === 'session/set_config_option') { record({method:message.method,...p});
    if (p.configId === 'agent-model') { selectedModel = p.value; for (const key of Object.keys(selectedOptions)) delete selectedOptions[key]; }
    else if (configOptions().some(option => option.id === p.configId)) { if (!settings().rejectOptions) selectedOptions[p.configId] = p.value; }
    else return write({jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'Unknown option'}});
    return reply({ configOptions: configOptions() }); }
  if (['turn/interrupt','session/cancel'].includes(message.method)) {
    cancelled = true;
    if (!acp) { reply({}); notify('turn/completed', { threadId: session, turn: { id: run, status: 'interrupted' } }); }
    return;
  }
  if (message.method === 'turn/steer') {
    if (settings().noSteer) return write({jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Steering unsupported'}});
    record({method:message.method,...p});
    if (p.expectedTurnId !== run || cancelled) return write({jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'Stale turn'}});
    if (p.input[0].text.includes('lost-steer-fixture')) return process.exit();
    reply({turnId:run});
    if(p.input[0].text.includes('finish-steer-fixture')) { cancelled=true; notify('turn/completed',{threadId:session,turn:{id:run,status:'completed'}}); }
    return;
  }
  if (!['turn/start','session/prompt','thread/compact/start'].includes(message.method)) return;
  if (settings().traceTurns) record({method:message.method,model:p.model,effort:p.effort,serviceTierForTurn:p.serviceTierForTurn});
  cancelled = false; run = randomUUID();
  const prompt = acp ? p.prompt[0].text : p.input?.[0]?.text ?? '/compact';
  if (!acp) { notify('turn/started', { threadId: session, turn: { id: run, status: 'inProgress' } }); reply({ turn: { id: run } }); }
  const requestText = prompt.split(/\n\n(?:User request|Task instructions):\n/).at(-1);
  if (settings().taskReleaseFile && prompt.includes('"work":{')) {
    while (!cancelled && !existsSync(settings().taskReleaseFile)) await new Promise(resolve => setTimeout(resolve, 25));
    if (cancelled) { if (acp) reply({stopReason:'cancelled'}); return; }
  }
  if (requestText.includes('disconnect-fixture')) process.exit();
  if (acp && requestText === 'empty-turn-fixture') return reply({ stopReason: 'end_turn', usage: { totalTokens: 0 } });
  if (acp && requestText === 'late-stream-fixture') {
    reply({ stopReason: 'end_turn', usage: { totalTokens: 0 } });
    await new Promise(resolve => setTimeout(resolve, 150));
    notify('session/update', { sessionId: session, update: { sessionUpdate: 'agent_message_chunk', messageId: 'late-message', content: { type: 'text', text: 'Complete late reply.' } } });
    return;
  }
  if (requestText.includes('hold-fixture')) {
    while (!cancelled) await new Promise(resolve => setTimeout(resolve, 25));
    if (acp) reply({ stopReason: 'cancelled' }); return;
  }
  if (requestText.includes('permission-fixture') && (!fullAccess || requestText.includes('forced-permission-fixture'))) {
    const id='approval-1';const response=new Promise(resolve=>responses.set(id,resolve));
    write(acp ? {jsonrpc:'2.0',id,method:'session/request_permission',params:{sessionId:session,toolCall:{title:'Allow Polaris get_context?',rawInput:{goal_id:''}},options:[{optionId:'accept',name:'Allow once',kind:'allow_once'},{optionId:'decline',name:'Decline',kind:'reject_once'}]}}
      : {jsonrpc:'2.0',id,method:'mcpServer/elicitation/request',params:{threadId:session,serverName:'polaris',mode:'form',message:'Allow Polaris get_context?',requestedSchema:{type:'object',properties:{}}}});
    const decision=await response;if((acp ? decision.outcome?.optionId : decision.action)!=='accept')throw new Error('Permission declined');
  }
  if (requestText === 'question-fixture' && !acp) {
    const id='question-1';const response=new Promise(resolve=>responses.set(id,resolve));
    write({jsonrpc:'2.0',id,method:'item/tool/requestUserInput',params:{threadId:session,questions:[{id:'route',question:'Which route?',options:[{label:'A',description:'First route'},{label:'B',description:'Second route'}]}]}});
    const rejected=await response;if(rejected?.code!==-32603)throw new Error('Native question must be rejected');
  }
  let result;
  if (requestText === 'onboarding-fixture') {
    // Stable rules may already be cached in this native session; the turn scope is always explicit.
    if (!prompt.includes('Current turn scope: main conversation')) throw new Error('Missing current turn scope');
    const definitions = [
      ['manage_context',{kind:'goal',action:'create',id:'growth',expected_version:null,goal:{title:'产品增长',milestone:'11 月 30 日前获得 50 个付费团队',constraints:'先找到愿意付费的团队',symbol:'ChartNoAxesCombined'},strategy:null}],
      ['manage_context',{kind:'strategy',action:'create',id:'reach',expected_version:null,goal:null,strategy:{goal_id:'growth',title:'精准触达',body:'找到目标客户，直接接触',origin:'Agent'}}],
    ];
    for (const [name,args] of definitions) { const value=await tool(name,args);if(value.isError)throw new Error(JSON.stringify(value)); }
    await tool('run_strategies',{strategy_ids:['reach']});
    const release=settings().onboardingReleaseFile;
    if (release) { while (!cancelled && !existsSync(release)) await new Promise(resolve=>setTimeout(resolve,25)); }
    else await new Promise(resolve=>setTimeout(resolve,2200));
  }
  if (prompt.includes('Current turn scope: current task') && requestText.includes('精准触达')) {
    const context = await readContext();
    const decision = title => ({strategy_id:context.work.strategyID,issue_key:title,title,body:'两个路径',options:[{id:'a',label:'A',detail:'First'},{id:'b',label:'B',detail:'Second'}]});
    result = await tool('request_decisions',{decisions:[decision('先进入哪个社区？'),decision('先联系谁？')]});
    if(result.isError)throw new Error(JSON.stringify(result));
    // R-D119: submitted cards do not pause the turn; independent work continues.
    const after=await tool('get_context',{goal_id:''});if(after.isError)throw new Error('Cards paused the turn');
  }
  if (requestText === 'schedule-fixture') {
    const context = await readContext();
    const strategy = { goal_id: context.board.strategies[0].goalID, title: '定时调研', body: '核对公开资料', origin: 'User' };
    const args = { kind: 'strategy', action: 'create', id: 'scheduled-research', expected_version: null, goal: null };
    result = await tool('manage_context', { ...args, strategy });
    if (result.isError) throw new Error('Strategy save failed: ' + result.content[0].text);
    result=await tool('manage_scheduled_task',{action:'save',strategy_id:'scheduled-research',task:{title:'定时调研',instructions:'核对公开资料',config:{timezone:'Asia/Taipei',rule:{frequency:'once',at:new Date(Date.now()+12000).toISOString()}}}});
    if(result.isError || !JSON.parse(result.content[0].text).nextAt)throw new Error('Missing first run time');
  }
  if (requestText === 'work-rail-fixture') {
    const context = await readContext();
    await tool('start_work', {strategy_id:context.board.strategies[0].id,title:'检查客户反馈',instructions:'检查新增客户反馈，整理重要变化，需要取舍时提交决策卡。'});
    await tool('start_work', {strategy_id:context.board.strategies[1].id,title:'研究竞品变化',instructions:'研究同类产品的近期发布与价格变化。'});
  }
  if (requestText === 'work-retry-fixture') {
    const context = await readContext();
    await tool('start_work', { strategy_id: context.board.strategies[0].id, title: '额度耗尽的调研', instructions: 'quota-fixture' });
  }
  if (requestText.startsWith('Prepare the next decision cards for this strategy.')) {
    const context = await readContext();
    if (context.work.strategyID === 'auto-advance-test') {
      result = await tool('request_decisions', { decisions: [
        { strategy_id: context.work.strategyID, issue_key: 'channel', title: '先调研哪个渠道？', body: '渠道会改变调研范围。' },
        { strategy_id: context.work.strategyID, issue_key: 'segment', title: '先接触哪类商家？', body: '两类商家的试做条件不同。' },
      ] });
      if (result.isError) throw new Error(result.content[0].text);
    }
  }
  if (acp && requestText === 'quota-fixture') {
    const text = "You've hit your 5-hour limit";
    notify('session/update', { sessionId: session, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: text } });
    return;
  }
  if (requestText === 'concurrency-fixture') {
    const context = await readContext();
    for (let i = 1; i <= 6; i++) {
      result = await tool('start_work', {strategy_id:context.board.strategies[0].id,title:`并发任务 ${i}`,instructions:`hold-fixture ${i}`});
      if (result.isError) throw new Error('Concurrent work was not created');
    }
  }
  if (requestText === '检查新增客户反馈，整理重要变化，需要取舍时提交决策卡。') {
    const context = await readContext();
    const draft = await tool('write_artifact', { title: '阶段产物', body: '已整理公开资料' });
    const { id } = JSON.parse(draft.content[0].text);
    result = await tool('request_decisions', { decisions: [{ strategy_id: context.work.strategyID, issue_key: 'product-url', title: '请提供产品网址', body: '收到网址后，结合阶段产物完成调研。', options: [], artifact_ids: [id] }] });
    if (result.isError) throw new Error(result.content[0].text);
  }
  if (requestText.startsWith('{') && requestText.includes('"outcome":')) {
    const { decision, outcome } = JSON.parse(requestText);
    if(decision.title==='请提供产品网址') result=await tool('start_work',{strategy_id:decision.strategyID,title:'完成产品调研',instructions:'finish-url:'+outcome.note,artifact_ids:decision.inputs.artifactIDs});
  }
  if(requestText.startsWith('finish-url:')){
    result=await tool('write_artifact',{title:'调研结果',body:'已收到网址 '+requestText.slice('finish-url:'.length)});
  }
  if (requestText === 'combo-fixture') {
    const context = await readContext();
    await tool('start_work', { strategy_id: context.board.strategies[0].id, title: 'Work A', instructions: 'work-a-stage' });
    await tool('start_work', { strategy_id: context.board.strategies[0].id, title: 'Work B', instructions: 'work-b-stage' });
  }
  if (requestText === 'work-b-stage') {
    const context = await readContext();
    await tool('request_decisions', { decisions: [{ strategy_id: context.work.strategyID, issue_key:'decision-b', title: 'Decision B', body: 'Choose B', options: [{id:'a',label:'A',detail:'First'},{id:'b',label:'B',detail:'Second'}] }] });
  }
  if (requestText === 'work-a-stage') {
    const context = await readContext();
    await tool('request_decisions', { decisions: [{strategy_id:context.work.strategyID,issue_key:'decision-a',title:'Decision A',body:'Choose A',options:[{id:'a',label:'A',detail:'First'},{id:'b',label:'B',detail:'Second'}]}] });
  }
  if (requestText.includes('decision-fixture')) { const scope=await readContext(), strategy=scope.work?.strategyID ?? scope.board.strategies[0].id; result = await tool('request_decisions', { decisions: [{ strategy_id: strategy, issue_key:'route', title: 'Choose a route', body: 'Two routes', options: [{ id: 'a', label: 'A', detail: 'First route' }, { id: 'b', label: 'B', detail: 'Second route' }], excerpt: 'Route A draft', recommended_option_id: 'a' }] });
    if (result.isError) throw new Error('Decision was not created');
    const batch = await tool('request_decisions', { decisions: [{ strategy_id: strategy, issue_key:'channel', title: 'Choose a channel', body: 'Two channels', options: [{ id: 'mail', label: 'Mail', detail: 'Send mail' }, { id: 'call', label: 'Call', detail: 'Call them' }] }] });
    const later = await tool('write_artifact', {title:'After cards',body:'The turn continues'});
    if (batch.isError || later.isError) throw new Error('Work after a decision card was rejected');
  }
  else if (requestText.includes('artifact-fixture')) result = await tool('write_artifact', { title: 'Fixture artifact', body: 'Native MCP result' });
  else if (mcp?.command && !['onboarding-fixture','检查新增客户反馈，整理重要变化，需要取舍时提交决策卡。','work-rail-fixture'].includes(requestText)) result = await tool('get_context', { goal_id: '' });
  const attachments = prompt.match(/User-selected attachments \(local copies\):\n([^\n]+)/);
  const text = requestText === 'question-fixture' ? 'Which route?' : requestText === '检查新增客户反馈，整理重要变化，需要取舍时提交决策卡。' ? '请在聊天中给我一个网址？' : requestText === '研究同类产品的近期发布与价格变化。' ? '已完成竞品信息检查。' : attachments ? 'Read attachment: ' + JSON.parse(attachments[1]).map(file=>readFileSync(file.path,'utf8')).join(', ')
    : requestText.startsWith('/') && requestText.includes(' ') ? (prompt.startsWith('/') ? 'Native command arguments preserved' : 'Command was wrapped') : requestText === 'model-fixture' ? `Native model: ${selectedModel}` : result?.isError ? 'Tool was rejected.' : 'Native fixture completed.';
  if (acp && requestText === 'ids-fixture') {
    for (const [messageId,text] of [['native-first','First '],['native-first','message'],['native-second','Second message']]) notify('session/update',{sessionId:session,update:{sessionUpdate:'agent_message_chunk',messageId,content:{type:'text',text}}});
    reply({stopReason:'end_turn'});return;
  }
  if (acp) {
    notify('session/update', { sessionId: session, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
    reply({ stopReason: 'end_turn' });
  } else {
    const item = { type: 'agentMessage', id: 'answer', text, phase: 'final_answer' };
    notify('item/started', { threadId: session, turnId: run, item: { ...item, text: '' }, startedAtMs: Date.now() });
    notify('item/agentMessage/delta', { threadId: session, itemId: 'answer', delta: text });
    notify('item/completed', { threadId: session, turnId: run, item, completedAtMs: Date.now() });
    notify('turn/completed', { threadId: session, turn: { id: run, status: 'completed' } });
  }
});
