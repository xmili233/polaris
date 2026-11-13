import test from 'node:test';
import assert from 'node:assert/strict';
import { symbols } from '../electron/platform.mjs';

test('system symbol adapter caches images and validates requests', () => {
  let calls = 0;
  const image = { createFromNamedImage: name => { calls++; return { isEmpty: () => name === 'missing', toDataURL: () => `data:image/png;base64,${name}` }; } };
  const cache = new Map();
  assert.deepEqual(symbols(['target', 'missing'], image, cache), { target: 'data:image/png;base64,target' });
  symbols(['target', 'missing'], image, cache);
  assert.equal(calls, 2);
  assert.throws(() => symbols(['x'.repeat(101)], image));
  assert.deepEqual(symbols(['../private.png'], image), {});
  assert.equal(calls, 2);
});
