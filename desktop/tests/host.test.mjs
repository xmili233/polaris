import { seedDemo } from './fixtures/seed.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { LocalHost, externalURL, validateCall } from '../electron/host.mjs';
import { PolarisStore } from '../dist-service/store.js';
import { milliseconds } from '../src/theme.ts';

const native = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin');
test('motion durations retain their length when the CSS minifier changes milliseconds to seconds', () => {
  assert.equal(milliseconds('3000ms'), 3000);
  assert.equal(milliseconds('3s'), 3000);
  assert.equal(milliseconds(' .22s '), 220);
  assert.equal(milliseconds('460ms'), 460);
});
test('private local process shares CLI data, rejects stale decisions, and survives restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polaris-host-test-'));
  const database = path.join(directory, 'polaris.sqlite');
  const cli = (...args) => {
    const result = spawnSync(path.join(native, 'polaris'), ['--database', database, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const host = new LocalHost(path.join(native, 'polaris-host'), database);
  try {
    assert.deepEqual((await host.call('snapshot')).board, { goals: [], strategies: [], decisions: [] });
    const fixture = new PolarisStore(database);
    seedDemo(fixture);
    const oldCard = fixture.snapshot().decisions.find(item => !item.outcome);
    const historical = fixture.decide(oldCard.id, oldCard.options[0].id, '', oldCard.version);
    fixture.close();
    const first = await host.call('snapshot');
    assert.ok((await host.call('strategyRecords',{strategyID:first.board.decisions.find(d=>d.id===historical.decisionID).strategyID})).decisions.some(d=>d.outcome.id===historical.id));
    const parallel = await Promise.all(Array.from({ length: 8 }, () => host.call('snapshot')));
    assert.ok(parallel.every(item => item.board.goals.length === first.board.goals.length));
    const decision = first.board.decisions.find(item => !item.outcome);
    assert.ok(decision);
    const result = await host.call('decide', { decisionID: decision.id, expectedVersion: decision.version, note: 'Use **my own** decision.' });
    assert.equal(result.optionID, undefined);
    assert.equal(result.note, 'Use **my own** decision.');
    await assert.rejects(host.call('decide', { decisionID: decision.id, expectedVersion: decision.version, optionID: decision.options[0].id }), { code: 'conflict' });
    await assert.rejects(host.call('withdraw', { decisionID: decision.id, outcomeID: result.id }), { code: 'invalid_input' });
    assert.equal(cli('outcomes', '--unacknowledged').some(item => item.id === result.id), true);
    assert.equal('historicalOutcomeIDs' in await host.call('snapshot'),false);
    assert.equal((await host.call('snapshot')).board.decisions.find(item => item.id === decision.id).outcome.id, result.id);
    const restart = new LocalHost(path.join(native, 'polaris-host'), database);
    try {
      const snapshot = await restart.call('snapshot');
      assert.notEqual(snapshot.changeToken, first.changeToken, 'A restarted service must invalidate previously cached snapshots');
      assert.equal(snapshot.board.decisions.find(item => item.id === decision.id).outcome.id, result.id);
      assert.ok(snapshot.board.decisions.some(d=>d.outcome?.id===historical.id));
      const check = new PolarisStore(database);
      try {
        assert.equal(check.query('SELECT count(*) AS n FROM agent_job WHERE outcomeID=?', historical.id)[0].n, 0);
        assert.equal(check.query('SELECT count(*) AS n FROM agent_job WHERE outcomeID=?', result.id)[0].n, 1);
      } finally { check.close(); }
    }
    finally { restart.stop(); }
    await assert.rejects(host.call('shell', { command: 'touch dangerous' }), { code: 'invalid_input' });
    await assert.rejects(host.call('probeSend', { endpoint: 'https://example.com/automations/webhook/secret', message: 'test', secret: 'never-send' }), { code: 'invalid_input' });
  } finally { host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('renderer bridge exposes only current app operations and safe link schemes', () => {
  for (const method of ['withdraw', 'handoff', 'probeConfig', 'probeSend', 'probeReply', 'shell', 'cli', 'readFile', 'acknowledge', 'decision.create']) assert.throws(() => validateCall(method, {}));
  assert.throws(() => validateCall('decide', null));
  assert.throws(() => validateCall('decide', { note: 'x'.repeat(1_048_577) }));
  assert.doesNotThrow(() => validateCall('snapshot', {}));
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'resolve://shell', 'data:text/html,hi']) assert.equal(externalURL(value), null);
  assert.equal(externalURL('https://example.com/info'), 'https://example.com/info');
});

test('a timed out provider check does not kill the task service',async context=>{
 const {EventEmitter}=await import('node:events');let killed=0;const child=new EventEmitter();child.stderr={resume(){}};child.postMessage=()=>{};child.kill=()=>killed++;
 const host=new LocalHost('',':memory:',()=>child);
 context.mock.timers.enable({apis:['setTimeout']});
 const pending=assert.rejects(host.call('agentNative',{action:'refresh',provider:'gemini-cli'}),/timed out/);
 context.mock.timers.tick(40001);await pending;assert.equal(killed,0);context.mock.timers.reset();host.stop();
});
