import { packager } from '@electron/packager';
import { sign } from '@electron/osx-sign';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supportedLanguages } from '../dist-i18n/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(root, '..');
for (const name of ['.env', '.env.local']) if (existsSync(path.join(repository, name))) process.loadEnvFile(path.join(repository, name));
// A stable identity keeps the keychain's "Always Allow" valid across rebuilds; ad-hoc signatures change with every build.
const identity = process.env.POLARIS_SIGN_IDENTITY || '-';
// --arch arm64|x64 builds for another architecture (no native modules ship, so either builds on any Mac).
// --out DIR places Polaris.app in DIR instead of macos/build.
const option = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
const arch = option('--arch') ?? process.arch;
if (!['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported architecture: ${arch}`);
const outDirectory = option('--out') ? path.resolve(option('--out')) : undefined;
const stage = await mkdtemp(path.join(tmpdir(), 'polaris-package-'));
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
};
try {
  const source = path.join(stage, 'source');
  const service = path.join(stage, 'service');
  await mkdir(source);
  await cp(path.join(root, 'dist'), path.join(source, 'dist'), { recursive: true });
  await cp(path.join(root, 'dist-i18n'), path.join(source, 'dist-i18n'), { recursive: true });
  await cp(path.join(root, 'electron'), path.join(source, 'electron'), { recursive: true });
  const distService = path.join(root, 'dist-service');
  await mkdir(path.join(source, 'dist-service'));
  for (const file of ['model.js', 'workspaces.js', 'desktop-contract.js']) await cp(path.join(distService, file), path.join(source, 'dist-service', file));
  await mkdir(path.join(service, 'agents'), { recursive: true });
  for (const file of ['package.json', 'host.js', 'cli.js', 'agent-mcp.js', 'claude-acp.mjs', 'agents/model-manifest.LICENSE'])
    await cp(path.join(distService, file), path.join(service, file));
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, license: pkg.license, type: 'module', main: pkg.main }));
  const [output] = await packager({ dir: source, out: path.join(root, 'build'), name: 'Polaris', platform: 'darwin', arch,
    electronVersion: pkg.devDependencies.electron, appBundleId: 'app.polaris.desktop', appVersion: pkg.version,
    icon: path.join(repository, 'macos/Resources/AppIcon.icns'), asar: true, overwrite: true, prune: true,
    appCategoryType: 'public.app-category.productivity', extraResource: [service],
    extendInfo: { CFBundleDevelopmentRegion: 'en', CFBundleLocalizations: supportedLanguages, LSMinimumSystemVersion: '15.0' },
  });
  const app = path.join(output, 'Polaris.app');
  const resources = path.join(app, 'Contents/Resources');
  await cp(path.join(repository, 'LICENSE'), path.join(resources, 'LICENSE'));
  await cp(path.join(repository, 'README.md'), path.join(resources, 'README.md'));
  const dependencies = spawnSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], { encoding: 'utf8', cwd: root, maxBuffer: 16 * 1024 * 1024 });
  if (dependencies.status !== 0) throw new Error('Unable to collect production licenses.');
  const notices = [await readFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), 'utf8')], visited = new Set();
  async function collect(items = {}) {
    for (const [name, metadata] of Object.entries(items)) {
      if (visited.has(metadata.path)) continue;
      visited.add(metadata.path);
      // pnpm lists optional platform binaries that are not installed or shipped on this host.
      if (!existsSync(metadata.path)) continue;
      for (const file of await readdir(metadata.path)) {
        if (/^(license|copying)(\.|-|$)/i.test(file)) {
          const text = await readFile(path.join(metadata.path, file), 'utf8').catch(() => '');
          if (text) notices.push(`${name} ${metadata.version}\n${text}`);
        }
      }
      await collect(metadata.dependencies);
    }
  }
  await collect(JSON.parse(dependencies.stdout)[0].dependencies);
  await writeFile(path.join(resources, 'THIRD_PARTY_LICENSES.txt'), notices.join('\n\n----------------\n\n'));
  // Resource scripts keep portable bundle signatures; scripts signed inside MacOS rely on copy-sensitive xattrs.
  await mkdir(path.join(resources, 'bin'));
  for (const [name, entry] of [['polaris', 'cli'], ['polaris-host', 'host']]) {
    await writeFile(path.join(resources, 'bin', name), `#!/bin/sh
set -eu
launcher=$0
while [ -L "$launcher" ]; do
  link=$(readlink "$launcher")
  case "$link" in /*) launcher=$link ;; *) launcher=$(dirname "$launcher")/$link ;; esac
done
directory=$(CDPATH= cd -- "$(dirname -- "$launcher")" && pwd)
export ELECTRON_RUN_AS_NODE=1
exec "$directory/../../MacOS/Polaris" --no-warnings "$directory/../service/${entry}.js" "$@"
`, { mode: 0o755 });
  }
  for (const language of supportedLanguages) await mkdir(path.join(resources, `${language}.lproj`), { recursive: true });
  if (identity === '-') run('codesign', ['--force', '--deep', '--sign', identity, app]);
  // A Developer ID build is signed inside out with the hardened runtime and a secure timestamp, as notarization requires.
  else await sign({ app, identity, platform: 'darwin', preAutoEntitlements: false,
    optionsForFile: file => path.resolve(file) === path.resolve(app) ? { hardenedRuntime: true, entitlements: path.join(repository, 'macos/Resources/Polaris.entitlements') } : { hardenedRuntime: true } });
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const destination = path.join(outDirectory ?? path.join(repository, 'macos/build'), 'Polaris.app');
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(app, destination, { recursive: true, verbatimSymlinks: true });
  run('codesign', ['--verify', '--deep', '--strict', destination]);
  console.log(destination);
} finally { await rm(stage, { recursive: true, force: true }); }
