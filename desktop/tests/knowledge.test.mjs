import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PolarisStore } from '../dist-service/store.js';
import { KnowledgeStore } from '../dist-service/knowledge.js';
import { AgentStore } from '../dist-service/agent-store.js';
import { AgentActions } from '../dist-service/agent-actions.js';
import { createBusinessMCP } from '../dist-service/agent-mcp.js';
import { validateCall } from '../electron/host.mjs';

async function fixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-knowledge-')), file = path.join(dir, 'test.sqlite'), store = new PolarisStore(file);
  const goals = ['客户增长', '产品交付'].map((title, i) => store.mutate('goal', 'create', undefined, { id: `goal-${i}`, title, milestone: '完成验证', requestID: randomUUID() }));
  const knowledge = new KnowledgeStore(store);
  const input = (extra = {}) => ({ title: '星河客户', category: '客户', body: '# 星河\n\n产品：数据看板\n报价待确认。', tags: ['客户'], aliases: ['Galaxy'], sources: ['用户提供的客户访谈，2026-11-03'], goalIDs: [goals[0].id], expectedVersion: 0, requestID: randomUUID(), ...extra });
  try { await fn({ dir, file, store, goals, knowledge, input }); } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
}
const access = (goalID, rulesVersion = 0) => ({ goalID, jobID: 'test-job', rulesVersion });
const isConflict = error => error.code === 'conflict' && error.messageKey === 'knowledge.conflict';
const isMissing = error => error.code === 'not_found';

test('shared documents survive reopen, are searchable by CJK and aliases, and refresh both goal contexts', () => fixture(({ file, store, goals, knowledge, input }) => {
  const doc = knowledge.save(input({ goalIDs: goals.map(g => g.id) }), access());
  const second = new PolarisStore(file), library = new KnowledgeStore(second);
  try {
    assert.equal(library.list({ query: 'ＧＡＬＡＸＹ' }).documents[0].id, doc.id);
    assert.equal(library.list({ query: '数据 看板' }).total, 1);
    const updated = library.save({ ...doc, body: '当前产品：企业版', expectedVersion: 1, requestID: randomUUID() }, access(goals[1].id));
    assert.equal(updated.version, 2);
    for (const goal of goals) assert.match(knowledge.find({ query: '企业版' }, access(goal.id)).documents[0].excerpt, /企业版/);
    assert.deepEqual(new AgentStore(store).context().knowledge, { total: 1, categories: { 客户: 1 } }, 'Tasks start with the library state, not a catalog.');
  } finally { second.close(); }
}));

test('same-name customers do not cross task scopes; tags and guessed IDs cannot expand access', () => fixture(({ goals, knowledge, input }) => {
  const doc = knowledge.save(input());
  const other = knowledge.save(input({ goalIDs: [goals[1].id], body: '别的客户的机密产品' }));
  const task = access(goals[0].id);
  assert.deepEqual(knowledge.list({ query: '星河' }, task).documents.map(d => d.id), [doc.id]);
  assert.throws(() => knowledge.read(other.id, task), isMissing);
  assert.throws(() => knowledge.list({ goalID: goals[1].id }, task), isMissing);
  assert.throws(() => knowledge.save({ ...other, expectedVersion: other.version, requestID: randomUUID() }, task), isMissing);
  assert.throws(() => knowledge.save(input({ goalIDs: goals.map(g => g.id) }), task), e => e.messageKey === 'knowledge.scope');
  assert.throws(() => knowledge.save({ ...doc, category: goals[1].id, goalIDs: goals.map(g => g.id), expectedVersion: 1, requestID: randomUUID() }, task), e => e.messageKey === 'knowledge.scope');
}));

test('concurrent writes preserve the winner and history; restore creates a version and preserves current links', () => fixture(({ file, goals, knowledge, input }) => {
  const doc = knowledge.save(input()), second = new PolarisStore(file), other = new KnowledgeStore(second);
  try {
    knowledge.save({ ...doc, body: '人工修正价格', goalIDs: [goals[1].id], expectedVersion: 1, requestID: randomUUID() });
    assert.throws(() => other.save({ ...doc, body: '旧上下文覆盖', expectedVersion: 1, requestID: randomUUID() }), isConflict);
    assert.equal(other.read(doc.id).body, '人工修正价格');
    const restored = knowledge.restore({ id: doc.id, expectedVersion: 2, version: 1, requestID: randomUUID() });
    assert.equal(restored.body, doc.body); assert.equal(restored.version, 3); assert.deepEqual(restored.goalIDs, [goals[1].id]);
    assert.deepEqual(knowledge.history(doc.id).map(d => d.version), [3, 2, 1]);
    const archived = knowledge.archive({ id: doc.id, expectedVersion: 3, requestID: randomUUID() });
    assert.equal(knowledge.list().total, 0); assert.equal(knowledge.list({ status: 'archived' }).total, 1);
    assert.throws(() => knowledge.save({ ...archived, expectedVersion: 4, requestID: randomUUID() }), isConflict);
    assert.equal(knowledge.restore({ id: doc.id, expectedVersion: 4, version: 3, requestID: randomUUID() }).status, 'active');
  } finally { second.close(); }
}));

test('write retries are idempotent but never replay cached documents after access was removed', () => fixture(({ goals, knowledge, input }) => {
  const args = input(), task = access(goals[0].id), doc = knowledge.save(args, task);
  assert.equal(knowledge.save(args, task).id, doc.id); assert.equal(knowledge.history(doc.id).length, 1);
  knowledge.save({ ...doc, goalIDs: [goals[1].id], expectedVersion: 1, requestID: randomUUID() });
  assert.throws(() => knowledge.save(args, task), isMissing);
  assert.throws(() => knowledge.save({ ...args, title: 'changed' }, task), isConflict);
}));

test('rules are versioned and read-only to AI tools; sourced writes must use the latest rules', () => fixture(({ store, goals, knowledge, input }) => {
  const rules = knowledge.saveRules({ body: '客户资料必须标注来源；推测标为待确认。', expectedVersion: 0, requestID: randomUUID() });
  assert.equal(rules.version, 1);
  assert.throws(() => knowledge.save(input(), access(goals[0].id, 0)), isConflict);
  assert.throws(() => knowledge.save(input({ sources: [] }), access(goals[0].id, 1)), e => e.messageKey === 'knowledge.sourceRequired');
  const doc = knowledge.save(input(), access(goals[0].id, 1));
  assert.equal(doc.updatedBy, 'agent'); assert.equal(doc.jobID, 'test-job');
  const data = new AgentStore(store), jobID = data.queue('main', '记住客户资料'), job = data.job(jobID);
  const actions = new AgentActions(store, data, { assertActive() {}, cancelWork() {}, retry() {}, queueWork() {} }, () => {});
  const definitions = actions.definitions(job);
  assert.equal(definitions.some(tool => /rules.*(save|write)|(save|write).*rules/.test(tool.name)), false);
  assert.deepEqual(definitions.find(t => t.name === 'read_knowledge_rules').execute({}), rules);
  const context = JSON.parse(definitions.find(t => t.name === 'get_context').execute({ goal_id: goals[0].id }));
  assert.deepEqual(context.knowledge, { total: 1, categories: { 客户: 1 } });
  assert.equal(definitions.find(t => t.name === 'browse_knowledge').execute({ category: '客户' }).documents[0].id, doc.id);
  assert.throws(() => knowledge.saveRules({ body: 'outdated', expectedVersion: 0, requestID: randomUUID() }), isConflict);
}));

test('fresh child tasks and provider switches see shared facts without inheriting other task history', () => fixture(({ store, goals, knowledge, input }) => {
  const doc = knowledge.save(input({ goalIDs: goals.map(g => g.id) })), data = new AgentStore(store);
  const actions = new AgentActions(store, data, { assertActive() {}, cancelWork() {}, retry() {}, queueWork() {} }, () => {});
  for (const [i, goal] of goals.entries()) {
    const strategy = store.mutate('strategy', 'create', undefined, { goalID: goal.id, title: '执行', body: '准备客户资料', origin: 'user', requestID: randomUUID() });
    const work = data.createWork(strategy.id, '读取客户', '复用资料'), jobID = data.queue('work', '读取', work.id);
    store.query("UPDATE agent_work SET provider=?,sessionKey=? WHERE id=?", i ? 'claude' : 'chatgpt-codex', `task:${jobID}`, work.id);
    store.query("UPDATE agent_job SET provider='chatgpt-codex',sessionKey=? WHERE id=?", `task:${jobID}`, jobID);
    const tools = actions.definitions(data.job(jobID), data.work(work.id));
    const ctx = JSON.parse(tools.find(t => t.name === 'get_context').execute({}));
    assert.equal(ctx.knowledge.total, 1); assert.equal(tools.find(t => t.name === 'browse_knowledge').execute({ category: '客户' }).documents[0].id, doc.id);
    assert.equal(tools.find(t => t.name === 'read_knowledge').execute({ id: doc.id }).body, i ? '共享产品更新 0' : doc.body);
    assert.equal(tools.find(t => t.name === 'search_knowledge').execute({ query: 'Galaxy' }).total, 1);
    const latest = knowledge.read(doc.id);
    const args = { ...latest, expectedVersion: latest.version, rulesVersion: 0, body: `共享产品更新 ${i}` };
    const saved = tools.find(t => t.name === 'write_knowledge').execute(args);
    assert.equal(saved.version, i + 2);
    assert.equal(tools.find(t => t.name === 'write_knowledge').execute(args).version, saved.version);
  }
}));

test('Markdown round trips exact body, identity and metadata; stale imports never overwrite', () => fixture(({ knowledge, input }) => {
  const body = '\n# 产品\r\n\r\n| 版本 | 状态 |\r\n| --- | --- |\r\n| 1 | 待确认 |\r\n\n<!-- keep -->\n';
  const doc = knowledge.save(input({ title: '标题 --> <script>', body })), exported = knowledge.exportMarkdown(doc.id);
  assert.ok(exported.markdown.startsWith('<!-- polaris-knowledge:v1 '));
  assert.ok(!exported.filename.includes('>'));
  const imported = knowledge.importMarkdown({ markdown: exported.markdown, filename: '产品.md', requestID: randomUUID() });
  assert.equal(imported.body, body); assert.equal(imported.id, doc.id); assert.equal(imported.title, doc.title); assert.equal(imported.version, 2);
  assert.throws(() => knowledge.importMarkdown({ markdown: exported.markdown, filename: '产品.md', requestID: randomUUID() }), isConflict);
  assert.equal(knowledge.read(doc.id).version, 2);
  const windows = knowledge.exportMarkdown(doc.id).markdown.replace(' -->\n\n', ' -->\r\n\r\n');
  assert.equal(knowledge.importMarkdown({ markdown: windows, filename: '产品.md', requestID: randomUUID() }).body, body);
}));

test('plain and foreign Markdown import create independent scoped documents and never modify rules', () => fixture(async ({ dir, goals, knowledge, input }) => {
  const plain = knowledge.importMarkdown({ markdown: '\ufeff# 客户产品\n\n正文', filename: 'input.md', goalID: goals[0].id, requestID: randomUUID() });
  assert.equal(plain.title, '客户产品'); assert.deepEqual(plain.goalIDs, [goals[0].id]);
  const foreignStore = new PolarisStore(path.join(dir, 'foreign.sqlite')), foreign = new KnowledgeStore(foreignStore);
  try {
    const exported = knowledge.exportMarkdown(knowledge.save(input()).id), imported = foreign.importMarkdown({ ...exported, requestID: randomUUID() });
    assert.deepEqual(imported.goalIDs, []); assert.equal(imported.version, 1);
    assert.equal(knowledge.list().documents.some(d => d.id === imported.id), false);
    assert.deepEqual(foreign.rules(), { version: 0, body: '' });
  } finally { foreignStore.close(); }
  assert.throws(() => knowledge.importMarkdown({ markdown: '<!-- polaris-knowledge:v2 bad -->\n\ntext', filename: 'bad.md', requestID: randomUUID() }), e => e.code === 'invalid_input');
  assert.throws(() => knowledge.importMarkdown({ markdown: '<!-- polaris-knowledge:v1 {} -->\n\ntext', filename: 'bad.md', requestID: randomUUID() }), e => e.code === 'invalid_input');
}));

test('former knowledge exports retain identity and conflict checks after the Polaris rename', () => fixture(({ knowledge, input }) => {
  const doc = knowledge.save(input());
  const current = knowledge.exportMarkdown(doc.id);
  assert.ok(current.markdown.startsWith('<!-- polaris-knowledge:v1 '));
  const markdown = current.markdown.replace('<!-- polaris-knowledge:', '<!-- resolve-knowledge:');
  const imported = knowledge.importMarkdown({ markdown, filename: current.filename, requestID: randomUUID() });
  assert.equal(imported.id, doc.id); assert.equal(imported.body, doc.body);
  assert.equal(imported.version, doc.version + 1);
  assert.throws(() => knowledge.importMarkdown({ markdown, filename: current.filename, requestID: randomUUID() }), isConflict);
  assert.throws(() => knowledge.importMarkdown({ markdown: '<!-- resolve-knowledge:v2 bad -->\n\ntext', filename: 'old.md', requestID: randomUUID() }), error => error.code === 'invalid_input');
}));

test('catalogs are bounded, pagination is stable, input validation rejects bad versions and oversized bodies', () => fixture(({ knowledge, input }) => {
  for (let i = 0; i < 45; i++) knowledge.save(input({ title: `资料 ${i}`, body: '非常长的资料正文。'.repeat(2000), sources: ['x'.repeat(2000)] }));
  const ctx = knowledge.context(); assert.equal(ctx.hasMore, true); assert.equal(ctx.total, 45); assert.ok(JSON.stringify(ctx.documents).length < 6200, 'The CLI context contract keeps its budgeted catalog.');
  const overview = knowledge.overview(); assert.equal(overview.total, 45); assert.ok(JSON.stringify(overview).length < 100, 'The starting state stays one line however large the library grows.');
  const found = knowledge.find({ query: '资料' }); assert.equal(found.documents.length, 20); assert.equal(found.nextOffset, 20); assert.ok(found.documents.every(doc => doc.excerpt.length <= 162 && !('body' in doc)));
  assert.equal(knowledge.list().nextOffset, 40); assert.equal(knowledge.list({ offset: 40 }).documents.length, 5);
  assert.equal('sources' in knowledge.list().documents[0], false);
  assert.throws(() => knowledge.save(input({ body: 'x'.repeat(200001) })), e => e.code === 'invalid_input');
  assert.throws(() => knowledge.save(input({ expectedVersion: -1 })), e => e.code === 'invalid_input');
  assert.throws(() => knowledge.list({ query: 'x'.repeat(301) }), e => e.code === 'invalid_input');
  assert.throws(() => knowledge.save(input({ goalIDs: [randomUUID()] })), e => e.code === 'invalid_input');
}));

test('bundled CLI works without node_modules, preserves raw Markdown, and validates rule versions', () => fixture(async ({ dir, file, knowledge, input }) => {
  const doc = knowledge.save(input()), cli = path.join(dir, 'cli.mjs');
  await copyFile(new URL('../dist-service/cli.js', import.meta.url), cli);
  const run = (...args) => spawnSync(process.execPath, ['--no-warnings', cli, '--database', file, ...args], { encoding: 'utf8', cwd: dir });
  const exported = run('knowledge', 'export', doc.id);
  assert.equal(exported.status, 0, exported.stderr); assert.equal(exported.stdout, knowledge.exportMarkdown(doc.id).markdown);
  assert.equal(JSON.parse(run('knowledge', 'list', '--query', 'Galaxy').stdout).total, 1);
  const source = path.join(dir, 'write.json');
  await writeFile(source, JSON.stringify({ ...doc, expectedVersion: 1, rulesVersion: 0, requestID: randomUUID(), body: 'CLI 更新' }));
  const saved = run('knowledge', 'save', '--input', source); assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).version, 2);
  await writeFile(source, 'null'); assert.equal(run('knowledge', 'save', '--input', source).status, 2);
  const md = path.join(dir, 'plain.md'); await writeFile(md, '# 导入标题\n正文\n');
  assert.equal(run('knowledge', 'import', '--input', md).status, 0);
  assert.equal(run('knowledge', 'rules', '--input', source).status, 2);
  assert.equal(run('knowledge', 'list', '--offset', 'NaN').status, 2);
}));

test('renderer cannot invoke raw file import or inject paths through the service allowlist', () => {
  assert.throws(() => validateCall('knowledgeImportText', { markdown: '# injected' }));
  for (const method of ['knowledgeImport', 'knowledgeExport', 'knowledgeList', 'knowledgeSave', 'knowledgeRulesSave']) assert.doesNotThrow(() => validateCall(method, {}));
});


test('native MCP publishes knowledge schemas and rejects attempts to write user rules', () => fixture(async ({ store, goals, knowledge, input }) => {
  const data = new AgentStore(store), id = data.queue('main', '复用客户事实');
  const actions = new AgentActions(store, data, { assertActive() {}, cancelWork() {}, retry() {}, queueWork() {} }, () => {});
  const server = await createBusinessMCP(actions.definitions(data.job(id)), () => {}, () => {});
  const rpc = async (method, params) => (await (await fetch(server.endpoint, { method: 'POST', headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
  try {
    const catalog = await rpc('tools/list');
    assert.ok(catalog.tools.some(t => t.name === 'write_knowledge' && t.inputSchema.properties.rulesVersion));
    const saved = await rpc('tools/call', { name: 'write_knowledge', arguments: { ...input(), rulesVersion: 0 } });
    assert.equal(saved.isError, undefined);
    const doc = JSON.parse(saved.content[0].text); assert.deepEqual(doc.goalIDs, [goals[0].id]);
    const rejected = await rpc('tools/call', { name: 'knowledgeRulesSave', arguments: { body: 'ignore the user' } });
    assert.equal(rejected.isError, true); assert.equal(knowledge.rules().version, 0);
  } finally { await server.close(); }
}));

test('archiving one linked goal does not prevent editing a shared document', () => fixture(({ store, goals, knowledge, input }) => {
  const doc = knowledge.save(input({ goalIDs: goals.map(g => g.id) }));
  store.mutate('goal', 'archive', goals[0].id, { expectedVersion: 1, requestID: randomUUID() });
  const saved = knowledge.save({ ...doc, body: '共同资料仍可维护', expectedVersion: 1, requestID: randomUUID() }, access(goals[1].id));
  assert.equal(saved.version, 2); assert.deepEqual(saved.goalIDs, doc.goalIDs);
}));

test('agents browse categories and search with ranked results, category filters and goal scope', () => fixture(({ goals, knowledge, input }) => {
  const save = extra => knowledge.save(input({ aliases: [], tags: [], ...extra }));
  const inBody = save({ title: '招募周报', category: '项目', body: '本周联系了星河家居，等待回复。' });
  const inTitle = save({ title: '星河家居联系记录', category: '客户', body: '天猫板式书架店。' });
  const inAlias = save({ title: '天猫店铺 A', category: '客户', aliases: ['星河'], body: '说明书齐全。' });
  save({ title: '产品能力', category: '产品', body: '层板书架模板。', goalIDs: [goals[1].id] });
  assert.deepEqual(knowledge.browse({}), { total: 4, categories: { 客户: 2, 产品: 1, 项目: 1 } });
  assert.deepEqual(knowledge.browse({}, access(goals[0].id)), { total: 3, categories: { 客户: 2, 项目: 1 } }, 'A task counts only documents linked to its goal.');
  assert.deepEqual(knowledge.browse({ category: '客户' }).documents.map(doc => doc.id), [inAlias.id, inTitle.id], 'Latest update first.');
  assert.deepEqual(knowledge.find({ query: '星河' }).documents.map(doc => doc.id), [inTitle.id, inAlias.id, inBody.id], 'Title, then alias, then body matches.');
  assert.deepEqual(knowledge.find({ query: '星河', category: '项目' }).documents.map(doc => doc.id), [inBody.id]);
  assert.match(knowledge.find({ query: '星河', category: '项目' }).documents[0].excerpt, /星河家居/);
  assert.equal(knowledge.find({ query: '层板' }, access(goals[0].id)).total, 0);
}));

test('long documents open with an outline and read one section, or the whole body for rewriting', () => fixture(({ goals, knowledge, input }) => {
  const filler = '记录。'.repeat(2500);
  const doc = knowledge.save(input({ body: `# 商家名单\n\n## 第 1 轮\n家逸家居\n${filler}\n## 第 2 轮\n空间生活\n### 备注\n待确认\n## 结论\n继续` }));
  const outline = knowledge.readPart({ id: doc.id }, access(goals[0].id));
  assert.equal('body' in outline, false); assert.equal(outline.version, doc.version);
  assert.deepEqual(outline.outline.map(item => item.section), ['商家名单', '第 1 轮', '第 2 轮', '备注', '结论']);
  const second = knowledge.readPart({ id: doc.id, section: '## 第 2 轮' }, access(goals[0].id));
  assert.equal(second.text, '## 第 2 轮\n空间生活\n### 备注\n待确认', 'A section runs until the next heading of the same or higher level.');
  assert.equal(knowledge.readPart({ id: doc.id, full: true }).body, doc.body);
  assert.throws(() => knowledge.readPart({ id: doc.id, section: '不存在' }), isMissing);
  const short = knowledge.save(input({ title: '短资料', body: '## 要点\n只有一句。' }));
  assert.equal(knowledge.readPart({ id: short.id }).body, short.body, 'Short documents return the whole body.');
  assert.throws(() => knowledge.readPart({ id: doc.id }, access(goals[1].id)), isMissing);
}));
