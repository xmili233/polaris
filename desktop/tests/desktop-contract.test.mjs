import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('desktop methods enforce parameters, reply types and the complete allowlist', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--resolveJsonModule', '--esModuleInterop', 'tests/desktop-contract.types.ts'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
