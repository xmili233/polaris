import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveLanguage, matchLanguage, translator, errorMessage } from '@polaris/i18n';
import { readAppearancePreference, readLanguagePreference, writeAppearancePreference, writeLanguagePreference } from '../electron/preferences.mjs';
import { PolarisError } from '../dist-service/model.js';

test('matches scripts, regions and ordered system preferences without turning unknown languages into Chinese', () => {
  assert.equal(resolveLanguage('auto', ['it-IT', 'ja-JP', 'en-US']), 'ja');
  assert.equal(resolveLanguage('auto', ['it-IT']), 'en');
  assert.equal(resolveLanguage('fr', ['en-US']), 'fr');
  for (const value of ['zh-TW', 'zh-HK', 'zh-Hant-CN']) assert.equal(matchLanguage(value), 'zh-Hant');
  assert.equal(matchLanguage('zh-Hans-TW'), 'zh-Hans');
  assert.equal(matchLanguage('pt-PT'), 'pt-BR');
  assert.equal(matchLanguage('de_DE'), 'de');
  assert.equal(matchLanguage('../../secrets'), undefined);
});
test('localized formatting keeps interpolation as data, supports plurals', () => {
  assert.equal(translator('en')('board.decisionCount', { count: 1 }), '1 decision');
  assert.equal(translator('fr')('board.decisionCount', { count: 2 }), '2 décisions');
  assert.ok(translator('ja')('board.couldnTRefreshDataValue', { value: '<test@example.com>' }).includes('<test@example.com>'));

});
test('error presentation uses stable metadata without changing error codes or raw diagnostics', () => {
  const error = new PolarisError('conflict', '原始错误', 'errors.versionChanged', { version: 9 });
  assert.ok(errorMessage(error, 'de').includes('Version 9'));
  assert.equal(error.code, 'conflict'); assert.equal(error.message, '原始错误');
  assert.equal(errorMessage({ code: 'new_unknown_error' }, 'ja'), translator('ja')('errors.unknown'));
});
test('language preference survives restart and rejects invalid input without replacing the saved choice', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polaris-i18n-'));
  const file = path.join(directory, 'preferences.json');
  try {
    assert.equal(await readLanguagePreference(file), 'auto');
    await writeLanguagePreference(file, 'ja');
    assert.equal(await readLanguagePreference(file), 'ja');
    await assert.rejects(writeLanguagePreference(file, '../../bad'));
    assert.equal(await readLanguagePreference(file), 'ja');
    await writeLanguagePreference(file, 'auto');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).language, 'auto');
    await writeFile(file, '{broken'); assert.equal(await readLanguagePreference(file), 'auto');
    await writeFile(file, 'null'); assert.equal(await readLanguagePreference(file), 'auto');
    const blocked = path.join(directory, 'blocked'); await writeFile(blocked, 'keep');
    await assert.rejects(writeLanguagePreference(path.join(blocked, 'preferences.json'), 'fr'));
    assert.equal(await readFile(blocked, 'utf8'), 'keep');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('appearance preference keeps the language, falls back safely and rejects invalid input', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polaris-appearance-'));
  const file = path.join(directory, 'preferences.json');
  try {
    assert.equal(await readAppearancePreference(file), 'system');
    assert.equal(await readAppearancePreference(file, 'light'), 'light');
    await writeLanguagePreference(file, 'ja');
    await writeAppearancePreference(file, 'dark');
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { language: 'ja', appearance: 'dark' });
    await writeLanguagePreference(file, 'fr');
    assert.equal(await readAppearancePreference(file), 'dark');
    await assert.rejects(writeAppearancePreference(file, 'neon'));
    assert.equal(await readAppearancePreference(file), 'dark');
    await writeFile(file, JSON.stringify({ language: 'de', appearance: 'neon' }));
    assert.equal(await readAppearancePreference(file), 'system');
    assert.equal(await readLanguagePreference(file), 'de');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
