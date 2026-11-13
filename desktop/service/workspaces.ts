import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PolarisError } from './model.js';

// Keep the selected database in place; never merge account workspaces or move their files.
export function activeDatabase(base: string) {
  const directory = path.dirname(base), file = path.join(directory, 'workspace.json');
  const valid = (value: unknown): value is string => typeof value === 'string' && /^(polaris\.sqlite|accounts\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/polaris\.sqlite)$/i.test(value);
  if (existsSync(file)) {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (!valid(value.database)) throw new PolarisError('storage', 'Invalid local workspace selection.');
    return path.join(directory, value.database);
  }
  const registry = path.join(directory, 'accounts', 'workspaces.json');
  if (!existsSync(registry)) return base;
  const { legacyOwner, activeUser } = JSON.parse(readFileSync(registry, 'utf8'));
  const userID = activeUser ?? legacyOwner;
  if (typeof legacyOwner !== 'string' || !valid(`accounts/${legacyOwner}/polaris.sqlite`) || !valid(`accounts/${userID}/polaris.sqlite`))
    throw new PolarisError('storage', 'Invalid previous workspace selection.');
  const database = userID === legacyOwner ? 'polaris.sqlite' : `accounts/${userID}/polaris.sqlite`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ database }), { mode: 0o600 });
  renameSync(temporary, file);
  return path.join(directory, database);
}
