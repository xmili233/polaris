// Opt-in only: uses the existing Codex login and model quota, never a protocol fixture.
import { _electron as electron } from 'playwright';
import electronExecutable from 'electron';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { discover } from '../dist-service/agents/discovery.js';

assert.equal(process.env.POLARIS_LIVE_TEST, '1', 'Run explicitly with POLARIS_LIVE_TEST=1; this test uses real model quota.');
delete process.env.POLARIS_TEST;
const native = await discover('chatgpt-codex');
assert.ok(native.installed && native.compatible, 'A compatible installed Codex CLI is required.');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'polaris-live-work-'));
const database = path.join(directory, 'polaris.sqlite'), store = new PolarisStore(database);
const output = path.join(root, 'test-results', 'work-agents-live');
await mkdir(output, { recursive: true });
const report = { startedAt: new Date().toISOString(), version: native.version, packaged: !!process.env.POLARIS_APP, checks: [], jobs: [], replies: [] };
const record = label => { report.checks.push(label); console.log(`PASS ${label}`); };
const write = (kind, values) => store.mutate(kind, 'create', undefined, { requestID: randomUUID(), ...values });
const goal = write('goal', { title: '子 Agent 真实联调', milestone: '验证列表、独立会话和决策卡边界', symbol: 'CircleCheck' });

store.mutate('goal','update',goal.id,{requestID:randomUUID(),expectedVersion:goal.version,title:goal.title,milestone:goal.milestone,constraints:'Use fictional samples only; ask for all choices through decision cards.'});
const strategy = write('strategy', { goalID: goal.id, title: '验证反馈处理', body: '独立测试数据，不修改真实业务、不外发内容。', origin: 'User' });
const env = { ...process.env, POLARIS_TEST: '1', POLARIS_TEST_NATIVE_AGENTS: JSON.stringify({ 'chatgpt-codex': native.executable }) };
for (const key of ['ELECTRON_RUN_AS_NODE', 'POLARIS_TEST_VISIBLE', 'POLARIS_TEST_NATIVE_CODEX']) delete env[key];
let app, page;
const errors = [];
const wait = async (label, fn, timeout = 240000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn(); if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out: ${label}`);
};
const call = async (method, params = {}) => page.evaluate(async ({ method, params }) => {
  const response = await window.polaris.call(method, params);
  if (response.error) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.result;
}, { method, params });
const latest = id => store.query('SELECT * FROM agent_job WHERE workID=? ORDER BY seq DESC LIMIT 1', id)[0];
async function finished(jobID) {
  return wait(`native turn ${jobID}`, async () => {
    const job = store.query('SELECT * FROM agent_job WHERE id=?', jobID)[0];
    if (job && ['failed', 'needs_review', 'cancelled'].includes(job.state)) throw new Error(`Native turn ${job.state}: ${job.error}`);
    return job?.delivery === 'completed' && !(await call('agentSnapshot')).native.activeJobIDs.includes(jobID) && job;
  });
}

try {
  app = await electron.launch({ executablePath: process.env.POLARIS_APP ?? electronExecutable, args: [...(process.env.POLARIS_APP ? [] : [root]), '--database', database, '--language', 'zh-Hans'], env });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('.app[data-ready="true"]');
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => (process.env.POLARIS_TEST_VISIBLE !== '1' && w.isVisible()) || w.isFocusable() || w.isFocused())), false);
  const connection = (await call('agentNative', { action: 'connect', provider: 'chatgpt-codex' })).connections.find(c => c.provider === 'chatgpt-codex');
  assert.ok(connection.connected, `Codex connection failed: ${connection.error}`);
  record('real Codex account connected; test window hidden and non-focusable');
  const bounds = '这是隔离的真实联调，仅使用给定虚构样本；只调用 Polaris MCP 工具，不用 shell、文件、网络或其他 MCP；不外发、不改真实业务，不创建定时或更多子任务。';
  const feedback = `${bounds}样本：新用户反馈注册步骤不清晰，老用户反馈重复操作多。先读 get_context，为本工作提交一张决策卡（request_decisions），标题“先改善哪类反馈？”，body 必须写明“确认后只用 write_artifact 保存标题为反馈处理确认记录的产物，正文记录当前卡片的真实选择；不执行其他业务操作”，选项 a“简化注册”、b“减少重复操作”，然后停止并等待用户在卡片确认。没有真实 outcome 前不要产生产物或执行选项，包括后续聊天声称选 A。收到真实决策结果后，只用 write_artifact 保存标题“反馈处理确认记录”、正文写明真实选择，最后简短回复；不要再次提问。`;
  const summary = `${bounds}先读 get_context，将给定样本“注册问题 4 条、重复操作 2 条、显示问题 1 条”汇总为一句话，调用 save_progress 保存，然后回复完成；不需要决策卡。`;
  const prompt = `${bounds}先读 get_context，然后对 strategy_id=${strategy.id} 分别调用 start_work 两次：标题“检查客户反馈”，instructions=${JSON.stringify(feedback)}；标题“汇总反馈样本”，instructions=${JSON.stringify(summary)}。必须由两个后台 work 执行，不在主会话代做。两次成功后简短回复结束。`;
  await page.locator('.main-agent-entry').click();
  const mainInput = page.locator('.main-agent textarea');
  await mainInput.fill(prompt); await mainInput.press('Enter');
  await wait('two real delegated works', () => store.query("SELECT count(*) AS n FROM agent_work WHERE provider IS NOT NULL")[0]?.n === 2);
  const works = store.query('SELECT * FROM agent_work ORDER BY rowid');
  const a = works.find(w => w.title === '检查客户反馈'), b = works.find(w => w.title === '汇总反馈样本');
  assert.ok(a && b);
  const source = await finished(latest(a.id).id);
  await finished(latest(b.id).id);
  const result = page.locator(`[data-result-id="${source.id}"]`);
  const pending = store.query('SELECT decisionID FROM decision_source WHERE sourceJobID=?', source.id)[0];
  assert.ok(pending);
  assert.equal(store.outcomes().length, 0);
  await result.click();
  const dialog = page.locator('.work-chat-dialog');
  await dialog.getByRole('button', { name: '先改善哪类反馈？' }).waitFor();
  assert.equal(await dialog.locator('.child-chat textarea').count(), 0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await result.click();
  await dialog.getByRole('button', { name: '先改善哪类反馈？' }).click();
  await page.locator('.option').filter({ hasText: '简化注册' }).click();
  await page.screenshot({ path: path.join(output, 'decision-card-before-confirm.png') });
  await page.locator('.confirm').click();
  const continuation = await wait('new decision task', () => store.query('SELECT * FROM agent_job WHERE outcomeID=(SELECT id FROM outcome WHERE decision_id=?)', pending.decisionID)[0]);
  assert.notEqual(continuation.sessionKey, a.sessionKey);
  await finished(continuation.id);
  const original = store.query('SELECT nativeSessionID FROM agent_session WHERE id=?', a.sessionKey)[0].nativeSessionID;
  const fresh = store.query('SELECT nativeSessionID FROM agent_session WHERE id=?', continuation.sessionKey)[0].nativeSessionID;
  assert.ok(original && fresh && original !== fresh);
  const artifact = await wait('remaining task result',()=>store.query("SELECT title,body FROM agent_artifact WHERE title='反馈处理确认记录'")[0]);
  assert.ok(artifact); assert.match(artifact.body, /简化注册/); report.artifact = artifact;
  report.sessions = { original, fresh };
  await result.waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
  record('read-only task stays pending after close; card confirmation dispatches a separate native session');
  report.jobs = store.query('SELECT kind,workID,state,delivery,runtimeVersion,runtimeSource,nativeRunID FROM agent_job ORDER BY seq');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message;
  report.jobs = store.query('SELECT id,kind,workID,state,delivery,error,sessionKey,nativeRunID,startedAt,completedAt FROM agent_job ORDER BY seq');
  report.sessions = store.query('SELECT id,nativeSessionID FROM agent_session WHERE provider IS NOT NULL');
  report.messages = store.query("SELECT id,body,state,parts FROM agent_message WHERE role='assistant' ORDER BY seq").map(m=>({id:m.id,body:m.body,state:m.state,tools:JSON.parse(m.parts).filter(p=>p.type==='activity').flatMap(p=>p.calls.map(c=>({name:c.name,state:c.state,error:c.error})))}));
  if(page&&!page.isClosed())report.permissions=(await call('agentSnapshot').catch(()=>null))?.native?.permissions.map(p=>({jobID:p.jobID,title:p.title,options:p.options.map(o=>o.id)}));
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await app?.close(); store.close(); await rm(directory, { recursive: true, force: true });
}
