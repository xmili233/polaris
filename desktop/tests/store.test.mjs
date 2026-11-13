import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PolarisStore } from '../dist-service/store.js';

function fixture(fn) {
  const directory = mkdtempSync(path.join(tmpdir(), 'polaris-node-core-'));
  const file = path.join(directory, 'polaris.sqlite');
  const store = new PolarisStore(file);
  try { return fn(store, file, directory); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}
const rejected = code => error => error.code === code;
function write(store, kind, action, value, id) { return store.mutate(kind, action, id, { requestID: randomUUID(), ...value }); }
function populate(store) {
  write(store, 'goal', 'create', { id: 'growth', title: '增长', milestone: '找到 10 位用户', constraints: '优先访谈' });
  write(store, 'strategy', 'create', { id: 'interviews', goalID: 'growth', title: '用户访谈', body: '联系 5 人', origin: '实验' });
  write(store, 'decision', 'submit', { id: 'community', strategyID: 'interviews', title: '哪个社区？', body: '**背景**', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
}
test('idempotency, replacement updates, history and concurrent connections preserve one another', () => fixture((store, file) => {
  populate(store);
  const second = new PolarisStore(file), token = store.changeToken;
  try {
    const input = { requestID: 'update', expectedVersion: 1, title: '新目标', milestone: '访谈十人' };
    const updated = second.mutate('goal', 'update', 'growth', input);
    assert.deepEqual(second.mutate('goal', 'update', 'growth', input), updated);
    assert.throws(() => second.mutate('goal', 'update', 'growth', { ...input, title: 'different' }), rejected('conflict'));
    assert.notEqual(store.changeToken, token);
    assert.deepEqual(store.history('goal', 'growth').map(record => record.version), [1, 2]);
    store.decide('community', undefined, '**先访谈**', 1);
    assert.equal(second.get('goal', 'growth').title, '新目标');
    assert.equal(second.snapshot().decisions[0].outcome.note, '**先访谈**');
  } finally { second.close(); }
}));
test('a confirmed decision stays immutable and its outcome remains available', () => fixture(store => {
  populate(store);
  const confirmed = store.decide('community', 'a', '', 1);
  assert.throws(() => store.decide('community', 'b', '', 2), rejected('conflict'));
  assert.throws(() => write(store, 'decision', 'cancel', { expectedVersion: 2 }, 'community'), rejected('conflict'));
  assert.equal(typeof store.withdraw, 'undefined');
  assert.deepEqual(store.outcomes(), [confirmed]);
  assert.equal(store.snapshot().decisions[0].outcome.id, confirmed.id);
}));

test('validation rolls back changes and enforces exclusive human responses', () => fixture(store => {
  populate(store);
  for (const [option, note] of [[undefined, ''], [undefined, ' \n'], ['missing', ''], ['a', '自己的决定'], [undefined, '字'.repeat(20001)]]) {
    assert.throws(() => store.decide('community', option, note, 1), rejected('invalid_input'));
    assert.equal(store.outcomes().length, 0);
    assert.equal(store.get('decision', 'community').version, 1);
  }
  assert.throws(() => write(store, 'goal', 'update', { id: 'different', expectedVersion: 1, title: 'G', milestone: 'M' }, 'growth'), rejected('invalid_input'));
  assert.throws(() => write(store, 'strategy', 'create', { id: 'bad', goalID: 'missing', title: 'P', body: 'B', origin: 'O' }), rejected('not_found'));
  const value = { requestID: 'repairable', id: 'new', strategyID: 'interviews', title: 'T', body: 'B', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommendedOptionID: 'a' };
  assert.throws(() => store.mutate('decision', 'submit', undefined, {...value, recommendedOptionID:'missing'}), rejected('invalid_input'));
  store.mutate('decision', 'submit', undefined, { ...value });
  store.decide('community', 'a', ' \n', 1);
  assert.throws(() => write(store, 'decision', 'cancel', { expectedVersion: 2 }, 'community'), rejected('conflict'));
}));
for (const kind of ['goal', 'strategy']) test(`archive ${kind} blocks unresolved descendants and permits acknowledged ones`, () => fixture(store => {
  populate(store); const id = { goal: 'growth', strategy: 'interviews' }[kind];
  assert.throws(() => write(store, kind, 'archive', { expectedVersion: 1 }, id), rejected('conflict'));
  const outcome = store.decide('community', 'a', '', 1);
  assert.throws(() => write(store, kind, 'archive', { expectedVersion: 1 }, id), rejected('conflict'));
  store.persistOutcome({ ...outcome, acknowledgedAt: outcome.decidedAt });
  write(store, kind, 'archive', { expectedVersion: 1 }, id);
  assert.equal(store.snapshot().decisions.length, 0);
  assert.equal(store.snapshot(true).decisions.length, 1);
}));
test('cancellation preserves history and permits archiving the parent', () => fixture(store => {
  populate(store);
  write(store, 'decision', 'cancel', { expectedVersion: 1 }, 'community');
  assert.equal(store.snapshot().decisions.length, 0);
  assert.equal(store.history('decision', 'community').at(-1).status, 'cancelled');
  write(store, 'strategy', 'archive', { expectedVersion: 1 }, 'interviews');
}));
test('unsupported schemas do not overwrite user data', () => fixture((store, file) => {
  for (const version of [1, 999]) {
    store.db.exec(`PRAGMA user_version=${version}`);
    assert.throws(() => new PolarisStore(file), error => error.code === 'schema' && error.messageKey === 'errors.databaseVersion');
    assert.equal(store.query('PRAGMA user_version')[0].user_version, version);
  }
}));
test('strategy saves reject nested timing and never create work or schedules', () => fixture(store => {
  write(store, 'goal', 'create', { id:'goal', title:'Research', milestone:'Learn' });
  const input={requestID:'strategy',goalID:'goal',title:'Interviews',body:'Compare needs',origin:'User'};
  assert.throws(()=>store.mutate('strategy','create',undefined,{...input,schedule:{rule:{frequency:'once',at:'2099-01-01T00:00:00Z'}}}),rejected('invalid_input'));
  const saved=store.mutate('strategy','create',undefined,input);
  assert.deepEqual(store.mutate('strategy','create',undefined,input),saved);
  assert.equal(store.query('SELECT * FROM scheduled_task').length,0);
  assert.equal(store.query('SELECT * FROM agent_job').length,0);
}));
test('CLI returns stable error codes and JSON', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'polaris-'));
  const cli = fileURLToPath(new URL('../dist-service/cli.js', import.meta.url));
  const file = path.join(directory, 'polaris.sqlite');
  const run = (args, input) => spawnSync(process.execPath, ['--no-warnings', cli, '--database', file, ...args], { encoding: 'utf8', input: input && JSON.stringify(input) });
  try {
    assert.equal(run(['decision', 'decide']).status, 2);
    const status = run(['status']); assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).pending, 0); assert.equal(JSON.parse(status.stdout).schemaVersion, 5);
    for (const args of [['handoff','prepare'], ['acknowledge',randomUUID()], ['goal','create','--input','-'], ['strategy','create','--input','-'], ['decision','submit','--input','-'], ['demo','seed']]) {
      const rejected = run(args, {});
      assert.equal(rejected.status, 2);
      assert.equal(JSON.parse(rejected.stderr).code, 'usage');
    }
    assert.deepEqual(JSON.parse(run(['decision', 'list']).stdout), []);
    const link = path.join(directory, 'linked-cli.js'); symlinkSync(cli, link);
    const linked = spawnSync(process.execPath, ['--no-warnings', link, '--database', file, 'status'], { encoding: 'utf8' });
    assert.equal(linked.status, 0); assert.equal(JSON.parse(linked.stdout).pending, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('goal constraints are optional, preserved on partial updates and explicitly clearable', () => fixture(store => {
  populate(store);
  const original=store.get('goal','growth');assert.equal(original.constraints,'优先访谈');
  const update=(fields,version)=>write(store,'goal','update',{title:'Goal',milestone:'Outcome',expectedVersion:version,...fields},'growth');
  assert.equal(update({},1).constraints,original.constraints);
  assert.equal(update({constraints:'Budget: 1000\nNo outreach'},2).constraints,'Budget: 1000\nNo outreach');
  assert.throws(()=>update({constraints:'x'.repeat(20001)},3),rejected('invalid_input'));
  assert.equal(update({constraints:''},3).constraints,'');
  assert.equal(store.snapshot().strategies[0].goalID,'growth');
  assert.equal(store.snapshot().decisions.length,1);
  assert.equal(store.history('goal','growth')[0].constraints,'优先访谈');
  assert.equal(store.query("SELECT name FROM sqlite_master WHERE name='policy'").length,0);
  assert.deepEqual(store.query('PRAGMA foreign_key_check'),[]);
}));
