import test from 'node:test';
import { legacySchema } from './fixtures/legacy-schema.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PolarisStore } from '../dist-service/store.js';
import { AgentCoordinator } from '../dist-service/agent-coordinator.js';
import { activeDatabase } from '../dist-service/workspaces.js';
import { parseInputs } from '../dist-service/execution-inputs.js';
import { seedDemo } from './fixtures/seed.mjs';

async function workspace(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-cleanup-')), file = path.join(dir, 'polaris.sqlite');
  try { await fn({ dir, file }); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('local launch preserves the selected former account workspace without moving its data', () => workspace(async ({ dir, file }) => {
  const first = '11111111-1111-1111-1111-111111111111', second = '22222222-2222-2222-2222-222222222222';
  const accounts = path.join(dir, 'accounts'), selected = path.join(accounts, second, 'polaris.sqlite');
  await mkdir(path.dirname(selected), { recursive: true });
  const registry = JSON.stringify({ legacyOwner: first, activeUser: second });
  await writeFile(path.join(accounts, 'workspaces.json'), registry); await writeFile(selected, 'selected'); await writeFile(file, 'first');
  assert.equal(activeDatabase(file), selected);
  assert.equal(await readFile(selected, 'utf8'), 'selected'); assert.equal(await readFile(file, 'utf8'), 'first');
  assert.equal(await readFile(path.join(accounts, 'workspaces.json'), 'utf8'), registry);
  await writeFile(path.join(accounts, 'workspaces.json'), 'old registry no longer read');
  assert.equal(activeDatabase(file), selected);
  await writeFile(path.join(dir, 'workspace.json'), JSON.stringify({ database: '../outside.sqlite' }));
  assert.throws(() => activeDatabase(file), error => error.code === 'storage');
}));
test('version two is backed up once and retired dependencies never become permission to run', () => workspace(async ({ dir, file }) => {
  let store = new PolarisStore(file); seedDemo(store);
  let runtime = new AgentCoordinator(store);
  const strategy = store.snapshot().strategies[0], work = runtime.data.createWork(strategy.id, 'Dependent task', 'Await an old dependency');
  const id = runtime.queueWork(work.instructions, work.id);
  store.query('INSERT OR REPLACE INTO agent_job_inputs(jobID,payload) VALUES(?,?)', id, JSON.stringify({ artifactIDs: [], knowledgeIDs: [], dependsOnDecisionIDs: ['old-card'] }));
  legacySchema(store, 2); store.db.exec('CREATE TABLE agent_job_dependency(jobID TEXT,decisionID TEXT)');
  await runtime.stop(); store.close();
  store = new PolarisStore(file);
  assert.equal(store.query('PRAGMA user_version')[0].user_version, 5);
  assert.equal(store.query('SELECT state FROM agent_job WHERE id=?', id)[0].state, 'needs_review');
  assert.equal(store.query("SELECT name FROM sqlite_master WHERE name='agent_job_dependency'").length, 0);
  assert.deepEqual(JSON.parse(store.query('SELECT payload FROM agent_job_inputs WHERE jobID=?', id)[0].payload), { artifactIDs: [], knowledgeIDs: [] });
  store.close(); store = new PolarisStore(file); store.close();
  assert.equal((await readdir(dir)).filter(name => name.includes('.before-v5-')).length, 1);
  assert.throws(() => parseInputs({ dependsOnDecisionIDs: ['old-card'] }), error => error.code === 'invalid_input');
}));
test('board and plan derive connection and wait states from the same data', () => workspace(async ({ file }) => {
  const store = new PolarisStore(file); seedDemo(store); const runtime = new AgentCoordinator(store);
  try {
    const strategy = store.snapshot().strategies[0];
    store.query("UPDATE decision SET status='cancelled',payload=json_set(payload,'$.status','cancelled')");
    const until = new Date(Date.now() + 3_600_000).toISOString(); runtime.schedules.save(strategy.id, {title:'Check reply', instructions:'Check reply', config:{rule:{frequency:'once',at:until}}});
    assert.equal(runtime.loopStates()[strategy.id].state, 'scheduled');
    const plan = runtime.executionPlan().items.find(item => item.id === strategy.id);
    assert.equal(plan.phase, 'scheduled'); assert.equal(plan.nextAt, until);
    const work = runtime.data.createWork(strategy.id, 'Offline task', 'Continue work'), id = runtime.queueWork(work.instructions, work.id);
    runtime.data.setJob(id, 'waiting_connection');
    assert.equal(runtime.loopStates()[strategy.id].state, 'waiting_connection');
    assert.equal(runtime.executionPlan().items.find(item => item.id === strategy.id).phase, 'waiting_connection');
  } finally { await runtime.stop(); store.close(); }
}));
