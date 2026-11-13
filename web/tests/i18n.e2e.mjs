import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { languages, translator } from '@polaris/i18n';

// The FAQ lists supported client versions; they must match the desktop's compatibility checks.
const discovery = readFileSync(new URL('../../desktop/service/agents/discovery.ts', import.meta.url), 'utf8');
const clients = JSON.parse(readFileSync(new URL('../app/clients.json', import.meta.url), 'utf8'));
for (const client of clients) {
  const found = discovery.match(new RegExp(`'${client.id}': \\{[^}]*minimum: \\[(\\d+), (\\d+), (\\d+)\\]`));
  assert.ok(found, `${client.id}: minimum version in discovery.ts`);
  const [major, minor, patch] = found.slice(1);
  if (client.line) assert.equal(client.line, `${major}.${minor}`, `${client.id}: supported release line`);
  else assert.equal(client.minimum, `${major}.${minor}.${patch}`, `${client.id}: minimum version`);
}
const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; for (const stream of [server.stdout, server.stderr]) stream.on('data', value => { output = (output + value).slice(-8000); });
async function request(path, headers = {}) { return fetch(origin + path, { headers, redirect: 'manual', signal: AbortSignal.timeout(5000) }); }
try {
  const deadline = Date.now() + 20000;
  while (true) {
    try { await request('/en'); break; } catch (error) {
      if (Date.now() > deadline || server.exitCode !== null) throw new Error(`Website did not start: ${output}`, { cause: error });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const detected = await request('/', { 'Accept-Language': 'it-IT,ko-KR;q=0.9,en;q=0.7' });
  assert.ok([307, 308].includes(detected.status)); assert.equal(new URL(detected.headers.get('location'), origin).pathname, '/ko');
  // Regional tags map to the supported scripts and variants: zh-CN to Simplified, zh-TW and zh-HK to Traditional, pt-PT to pt-BR.
  for (const [header, expected] of [['zh-CN,zh;q=0.9,en;q=0.8', '/zh-Hans'], ['zh-TW,zh;q=0.9', '/zh-Hant'], ['zh-HK', '/zh-Hant'], ['pt-PT,pt;q=0.9', '/pt-BR'], ['fr-CA', '/fr'], ['it-IT', '/en']]) {
    const response = await request('/', { 'Accept-Language': header });
    assert.equal(new URL(response.headers.get('location'), origin).pathname, expected, header);
  }
  await Promise.all(languages.map(async ({ code }) => {
    const response = await request('/' + code, { cookie: 'i18next=en' }); assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(`<html lang="${code}"`), `${code}: HTML language`);
    for (const key of ['web.download.mac', 'web.decide.title', 'web.demo.goalCustomers', 'board.decide', 'web.faq.freeQ']) assert.ok(html.includes(translator(code)(key)), `${code}: translated ${key}`);
    // Legal pages name the operator and link the forwarding address in every language.
    for (const [path, title] of [['privacy', 'web.localTitle'], ['terms', 'web.scopeTitle']]) {
      const page = await request(`/${code}/${path}`); assert.equal(page.status, 200);
      const text = await page.text();
      assert.ok(text.includes(translator(code)(title)), `${code}: ${path} translated`);
      assert.ok(text.includes('Zane') && text.includes('href="mailto:hello@polarisboards.com"'), `${code}: ${path} contact`);
    }
  }));
  const legacy = await request('/privacy', { 'Accept-Language': 'ja' });
  assert.equal(new URL(legacy.headers.get('location'), origin).pathname, '/ja/privacy');
  for (const removed of ['/api/me', '/auth/complete']) assert.equal((await fetch(origin + removed)).status, 404);
  console.log('PASS production website: 9 locales, concurrent language isolation, localized legal pages, detection, removed account endpoints and client versions matching the desktop');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve));
}
