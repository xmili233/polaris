import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAvatar } from 'open-bot-avatar';
const core = import.meta.resolve('open-bot-avatar');
const { analyzeBody } = await import(new URL('./validate.js', core));
const { faceRoom } = await import(new URL('./volume.js', core));
const { silhouetteSeams } = await import(new URL('./seams.js', core));
const catalog = JSON.parse(readFileSync(new URL('../src/agent-avatars.json', import.meta.url), 'utf8'));

test('all 20 shipped avatars match the approved preview and pass upstream geometry checks', () => {
  const approved = JSON.parse(readFileSync(new URL('./fixtures/approved-avatars.json', import.meta.url), 'utf8'));
  assert.deepEqual(catalog, approved.map(({ color, depth, definition }) => ({ color, depth, definition })));
  assert.equal(catalog.length, 20);
  assert.equal(new Set(catalog.map(a => a.definition.id)).size, 20);
  const theme = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  for (const { definition, color } of catalog) {
    const check = validateAvatar(definition); assert.equal(check.ok, true, JSON.stringify(check));
    const body = analyzeBody(definition.body.path);
    assert.equal(faceRoom(definition, body).ok, true, definition.id);
    assert.deepEqual(silhouetteSeams(body.polys), [], definition.id);
    assert.ok(theme.includes(`${color}:`), `Missing palette token: ${color}`);
  }
});
