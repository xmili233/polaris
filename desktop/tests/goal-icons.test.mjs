import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from '../dist-service/store.js';
import { goalIconNames, findGoalIcon, existingGoalIcon } from '../dist-service/goal-icons.js';
import { icons } from 'lucide-react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';

function fixture(run) {
  const directory = mkdtempSync(path.join(tmpdir(), 'polaris-goal-icons-'));
  const store = new PolarisStore(path.join(directory, 'db.sqlite'));
  try { return run(store); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}
const create = (store, symbol) => store.mutate('goal', 'create', undefined, { requestID: randomUUID(), title: 'Goal icon', milestone: 'Always visible', ...(symbol === undefined ? {} : { symbol }) });

test('new goals reject emoji and unknown icon names before writing any records', () => fixture(store => {
  for (const symbol of ['🪑', 'Telescope', 'NotAnInstalledLucideIcon', '<svg onload="alert(1)"/>', '__proto__', '../target', '']) {
    assert.throws(() => create(store, symbol), { code: 'invalid_input' });
    assert.equal(store.snapshot().goals.length, 0);
  }
}));

test('exactly 20 distinct built-in icons render and reach the renderer bundle', async () => {
  assert.equal(goalIconNames.length, 20);
  assert.equal(new Set(goalIconNames).size, 20);
  for (const name of goalIconNames) {
    assert.equal(findGoalIcon(name), name);
    assert.match(renderToStaticMarkup(createElement(icons[name])), /<(path|circle|ellipse|rect|line|polyline|polygon)\b/, name);
  }
  const result = await build({ entryPoints: [new URL('../src/GoalIcon.tsx', import.meta.url).pathname], bundle: true,
    minify: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', metafile: true });
  const included = Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs))
    .filter(([name, entry]) => name.includes('lucide-react/dist/esm/icons/') && entry.bytesInOutput > 0);
  assert.equal(included.length, 20, 'Unused Lucide icons must not enter the bundle.');
});

test('goal writes accept official component names and website names, preserving idempotency', () => fixture(store => {
  assert.equal(create(store).symbol, 'Target');
  assert.equal(create(store, 'Armchair').symbol, 'Armchair');
  assert.equal(create(store, 'chart-no-axes-combined').symbol, 'ChartNoAxesCombined');
  assert.equal(create(store, 'flask-conical').symbol, 'FlaskConical');
  const request = { requestID: randomUUID(), title: 'Shared request', milestone: 'One write', symbol: 'armchair' };
  const first = store.mutate('goal', 'create', undefined, request);
  assert.deepEqual(store.mutate('goal', 'create', undefined, request), first);
  assert.equal(first.symbol, 'Armchair');
}));

test('existing emoji and SF symbols stay visible without rewriting old payloads or allowing invalid updates', () => fixture(store => {
  const goal = create(store, 'Target');
  for (const [old, expected] of [['🪑', 'Armchair'], ['chart.line.uptrend.xyaxis', 'ChartNoAxesCombined'], ['paperplane', 'Send'], ['unknown-icon', 'Target'], ['', 'Target'], ['constructor', 'Target']]) {
    store.query("UPDATE goal SET payload=json_set(payload,'$.symbol',?) WHERE id=?", old, goal.id);
    assert.equal(store.get('goal', goal.id).symbol, expected);
    assert.equal(store.snapshot().goals[0].symbol, expected);
    assert.equal(existingGoalIcon(old), expected);
    assert.equal(store.query("SELECT json_extract(payload,'$.symbol') AS symbol FROM goal WHERE id=?", goal.id)[0].symbol, old);
  }
  assert.throws(() => store.mutate('goal', 'update', goal.id, { requestID: randomUUID(), expectedVersion: 1, title: goal.title, milestone: goal.milestone, symbol: 'unknown-icon' }), { code: 'invalid_input', messageKey: 'errors.goalIconUnknown' });
  assert.equal(store.get('goal', goal.id).version, 1);
}));
