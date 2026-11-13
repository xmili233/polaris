import assert from 'node:assert/strict';
import { catalogs, supportedLanguages, translator } from '../packages/i18n/index.js';
const source = catalogs.en;
const variables = text => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
for (const language of supportedLanguages) {
  const catalog = catalogs[language];
  assert.deepEqual(Object.keys(catalog).sort(), Object.keys(source).sort(), `${language}: missing or extra keys`);
  for (const [key, text] of Object.entries(catalog)) {
    assert.ok(typeof text === 'string' && text.trim(), `${language}:${key}: empty translation`);
    assert.deepEqual(variables(text), variables(source[key]), `${language}:${key}: interpolation mismatch`);
    assert.ok(!/%(?:\d+\$)?(?:@|lld)/.test(text), `${language}:${key}: legacy interpolation`);
  }
  for (const key of ['board.decisionCount', 'board.pendingDecisions', 'goal.moreConstraints']) for (const count of [0, 1, 2, 1000000]) {
    const result = translator(language)(key, { count, title: 'Example' });
    assert.ok(result.includes(String(count)) && !result.includes('{{') && !result.includes(key), `${language}:${key}: plural ${count}`);
  }
  assert.ok(translator(language)('board.chooseOptionByNumber', { number: 3 }).includes('3'), `${language}: option number`);
}
console.log(`PASS ${supportedLanguages.length} languages × ${Object.keys(source).length} keys, variables and plural forms`);
