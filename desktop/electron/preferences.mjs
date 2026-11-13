import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isLanguagePreference } from '../dist-i18n/index.mjs';

export const appearances = ['system', 'light', 'dark'];
export const isAppearance = value => appearances.includes(value);

async function readPreferences(file) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}
// Each write keeps the other saved choices, so changing the language never resets the appearance.
async function writePreference(file, change) {
  const saved = await readPreferences(file).catch(() => ({}));
  const next = {};
  if (isLanguagePreference(saved.language)) next.language = saved.language;
  if (isAppearance(saved.appearance)) next.appearance = saved.appearance;
  Object.assign(next, change);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(next) + '\n', { mode: 0o600 });
  await rename(temporary, file);
}

export async function readLanguagePreference(file) {
  const value = (await readPreferences(file)).language;
  return isLanguagePreference(value) ? value : 'auto';
}
export async function writeLanguagePreference(file, language) {
  if (!isLanguagePreference(language)) throw new Error('Invalid language preference.');
  await writePreference(file, { language });
}
export async function readAppearancePreference(file, fallback = 'system') {
  const value = (await readPreferences(file)).appearance;
  return isAppearance(value) ? value : fallback;
}
export async function writeAppearancePreference(file, appearance) {
  if (!isAppearance(appearance)) throw new Error('Invalid appearance preference.');
  await writePreference(file, { appearance });
}
