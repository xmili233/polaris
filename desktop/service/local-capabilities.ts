import { accessSync, constants, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Finds the ego-browser command that ego lite registers after onboarding (R-D174). GUI launches may omit ~/.local/bin from PATH. */
export function findBrowserCLI(env: NodeJS.ProcessEnv = process.env): string | null {
  const directories = [...(env.PATH ?? '').split(path.delimiter).filter(Boolean), path.join(os.homedir(), '.local', 'bin')];
  for (const directory of new Set(directories)) {
    const file = path.join(directory, 'ego-browser');
    try { accessSync(file, constants.X_OK); if (statSync(file).isFile()) return file; } catch { /* keep looking */ }
  }
  return null;
}

/** AI-facing note telling a background task whether it can act in the user's signed-in browser. */
export function capabilityNote(cli: string | null) {
  return cli
    ? `Local capability discovery: found ego-browser at ${cli}. Run \`ego-browser skill\` for its guide and verify readiness when using it. Discovery does not establish that the browser is running or a website is signed in. External actions still need the applicable approval.`
    : 'Local capability discovery: ego-browser was not found on the searched PATH. Other configured browser tools may be available. Check available capabilities before proposing installation; if needed, propose ego lite from https://lite.ego.app/ and perform authorized setup yourself.';
}
