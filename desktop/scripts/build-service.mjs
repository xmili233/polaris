import { spawnSync } from 'node:child_process';
import { rm, writeFile, copyFile } from 'node:fs/promises';
import { build } from 'esbuild';

await build({ entryPoints: ['../packages/i18n/index.js'], outfile: 'dist-i18n/index.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24' });

// Deleted service modules must not survive in the packaged app.
await rm('dist-service', { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.service.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
await writeFile('dist-service/package.json', '{"type":"module"}\n');
await build({ entryPoints: ['service/host.ts'], outfile: 'dist-service/host.js', bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });

await build({ entryPoints: ['node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js'], outfile: 'dist-service/claude-acp.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
await build({ entryPoints: ['service/agent-mcp.ts'], outfile: 'dist-service/agent-mcp.js', bundle: true, platform: 'node', format: 'esm', target: 'node24' });

await build({ entryPoints: ['service/cli.ts'], outfile: 'dist-service/cli.js', bundle: true, platform: 'node', format: 'esm', target: 'node24' });

await copyFile('service/agents/model-manifest.LICENSE', 'dist-service/agents/model-manifest.LICENSE');
