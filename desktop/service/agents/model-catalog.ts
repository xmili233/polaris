import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import bundled from './model-manifest.json' with { type: 'json' };
import type { NativeConnection, NativeModel, ModelOption } from './types.js';

const text = z.string().min(1).max(256);
const descriptor = z.object({ id: text, type: z.enum(['select', 'boolean']), options: z.array(z.object({ id: text, label: text, isDefault: z.boolean().optional() })).max(32).optional() });
const catalogSchema = z.object({ version: z.literal(1), updatedAt: z.string().datetime(), providers: z.record(z.string(), z.object({
  profiles: z.record(z.string(), z.object({ capabilities: z.object({ optionDescriptors: z.array(descriptor).max(16) }).optional() })),
  models: z.array(z.object({ slug: text, name: text, aliases: z.array(text).max(32).optional(), status: z.enum(['current', 'legacy']), profile: text.optional(),
    adapter: z.object({ claudeCode: z.object({ minVersion: text.optional(), maxVersionExclusive: text.optional() }).optional() }).optional() })).max(256),
})) });
let current = catalogSchema.parse(bundled), checkedAt = 0, fetchedAt = 0;
let refreshing: Promise<void> | undefined;
const cache = path.join(homedir(), 'Library/Application Support/Polaris Desktop/Workspace/model-manifest.json');

// T3 maintains this public metadata; it never supplies commands, credentials, or account entitlements.
export function refreshModelCatalog() {
  if (process.env.POLARIS_TEST === '1' || process.env.NODE_TEST_CONTEXT || refreshing || Date.now() - fetchedAt < 3_600_000 || Date.now() - checkedAt < 300_000) return;
  const first = !checkedAt; checkedAt = Date.now();
  refreshing = (async () => {
    if (first) try {
      const stored = JSON.parse(await readFile(cache, 'utf8')), parsed = catalogSchema.parse(stored.manifest);
      if (Date.parse(parsed.updatedAt) >= Date.parse(current.updatedAt)) { current = parsed; fetchedAt = Math.min(Number(stored.fetchedAt) || 0, Date.now()); }
      if (Date.now() - fetchedAt < 3_600_000) return;
    } catch { /* Bundled data remains available offline. */ }
    const response = await fetch('https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json', { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) return;
    const body = await response.text(); if (body.length > 262144) return;
    const parsed = catalogSchema.parse(JSON.parse(body));
    if (Date.parse(parsed.updatedAt) < Date.parse(current.updatedAt)) return;
    current = parsed; fetchedAt = Date.now();
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(`${cache}.tmp`, JSON.stringify({ fetchedAt, manifest: current })); await rename(`${cache}.tmp`, cache);
  })().catch(() => {}).finally(() => { refreshing = undefined; });
}

function versionAtLeast(actual: string, minimum: string) {
  const a = actual.match(/\d+\.\d+\.\d+/)?.[0].split('.').map(Number), b = minimum.match(/\d+\.\d+\.\d+/)?.[0].split('.').map(Number);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

export function applyModelCatalog(connection: NativeConnection, models: NativeModel[]): NativeModel[] {
  const catalog = current.providers[connection.provider === 'claude-code' ? 'claudeAgent' : connection.provider === 'chatgpt-codex' ? 'codex' : ''];
  if (!catalog) return models;
  return models.map(model => {
    const id = model.id.replace(/\[[^\]]*\]$/, '');
    const entry = catalog.models.find(entry => entry.slug === id || entry.aliases?.includes(id));
    if (!entry) return model;
    const bounds = entry.adapter?.claudeCode;
    if ((bounds?.minVersion && !versionAtLeast(connection.version, bounds.minVersion)) || (bounds?.maxVersionExclusive && versionAtLeast(connection.version, bounds.maxVersionExclusive))) return model;
    const options: ModelOption[] = [];
    for (const option of catalog.profiles[entry.profile ?? '']?.capabilities?.optionDescriptors ?? []) {
      if (option.id === 'effort' && option.options) {
        const choices = option.options.filter(choice => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(choice.id));
        options.push({ id: 'effort', kind: 'reasoning', name: 'Reasoning', defaultValue: choices.find(choice => choice.isDefault)?.id,
          choices: [{ value: 'default', name: 'Default' }, ...choices.map(choice => ({ value: choice.id, name: choice.label }))] });
      }
      if (option.id === 'fastMode') options.push({ id: 'fast', kind: 'speed', name: 'Speed', defaultValue: 'off', choices: [{ value: 'off', name: 'Standard' }, { value: 'on', name: 'Fast', fast: true }] });
    }
    return { ...model, legacy: entry.status === 'legacy', ...(model.options === undefined && options.length ? { options } : {}) };
  });
}
