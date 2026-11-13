// Builds signed, notarized DMGs for each architecture into macos/release, with SHA256SUMS.
// Usage: node scripts/release.mjs [--tag vX.Y.Z] [--arch arm64 --arch x64] [--no-notarize]
// Credentials come from the environment (see CONTRIBUTING.md); they are never written to the output.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetName, releasePlan } from './release-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(root, '..');
for (const name of ['.env', '.env.local']) if (existsSync(path.join(repository, name))) process.loadEnvFile(path.join(repository, name));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const plan = releasePlan({ env: process.env, args: process.argv.slice(2), version });
const output = path.join(repository, 'macos/release');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', cwd: options.cwd });
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed (${result.status}).`);
  return result.stdout;
}
// Apple's notary service checks the signature and returns a ticket that is stapled for offline first launch.
function notarize(file, stage) {
  let upload = file;
  if (file.endsWith('.app')) { upload = path.join(stage, `${path.basename(file)}.zip`); run('ditto', ['-c', '-k', '--keepParent', file, upload]); }
  const result = JSON.parse(run('xcrun', ['notarytool', 'submit', upload, ...plan.notary, '--wait', '--output-format', 'json'], { capture: true }));
  if (result.status !== 'Accepted') {
    if (result.id) run('xcrun', ['notarytool', 'log', result.id, ...plan.notary]);
    throw new Error(`Notarization of ${path.basename(file)} ended with status ${result.status}.`);
  }
  run('xcrun', ['stapler', 'staple', file]);
}
const sha256 = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  createReadStream(file).on('error', reject).on('data', chunk => hash.update(chunk)).on('end', () => resolve(hash.digest('hex')));
});

run('pnpm', ['run', 'build'], { cwd: root });
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const sums = [];
for (const arch of plan.arches) {
  const stage = await mkdtemp(path.join(tmpdir(), `polaris-release-${arch}-`));
  try {
    console.log(`\n▸ Polaris ${plan.version} for ${arch}`);
    run(process.execPath, [path.join(root, 'scripts/package.mjs'), '--arch', arch, '--out', stage], { cwd: root });
    const app = path.join(stage, 'Polaris.app');
    if (plan.notarize) {
      notarize(app, stage);
      run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
    }
    // The disk image opens to the app beside an Applications link, so installing is a single drag.
    const volume = path.join(stage, 'volume');
    await mkdir(volume);
    run('ditto', [app, path.join(volume, 'Polaris.app')]);
    await symlink('/Applications', path.join(volume, 'Applications'));
    const dmg = path.join(output, assetName(arch));
    run('hdiutil', ['create', '-volname', 'Polaris', '-srcfolder', volume, '-fs', 'HFS+', '-format', 'ULFO', '-ov', dmg]);
    run('codesign', ['--force', '--timestamp', '--sign', plan.identity, dmg]);
    if (plan.notarize) {
      notarize(dmg, stage);
      run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
    }
    sums.push(`${await sha256(dmg)}  ${assetName(arch)}`);
  } finally { await rm(stage, { recursive: true, force: true }); }
}
await writeFile(path.join(output, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(`\n${plan.notarize ? 'Notarized' : 'Signed, not notarized,'} release ${plan.version} in ${output}:\n${sums.join('\n')}`);
