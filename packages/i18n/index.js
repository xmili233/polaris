import i18next from 'i18next';
import en from './locales/en.json' with { type: 'json' };
import zhHans from './locales/zh-Hans.json' with { type: 'json' };
import zhHant from './locales/zh-Hant.json' with { type: 'json' };
import ja from './locales/ja.json' with { type: 'json' };
import ko from './locales/ko.json' with { type: 'json' };
import fr from './locales/fr.json' with { type: 'json' };
import de from './locales/de.json' with { type: 'json' };
import es from './locales/es.json' with { type: 'json' };
import ptBR from './locales/pt-BR.json' with { type: 'json' };

export { languages, supportedLanguages, matchLanguage, isLanguagePreference, resolveLanguage } from './languages.js';
import { supportedLanguages, matchLanguage } from './languages.js';
export const catalogs = { en, 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, fr, de, es, 'pt-BR': ptBR };
export function createI18n(language) {
  const instance = i18next.createInstance();
  instance.init({ lng: matchLanguage(language) ?? 'en', fallbackLng: 'en', supportedLngs: supportedLanguages,
    resources: Object.fromEntries(Object.entries(catalogs).map(([code, translation]) => [code, { translation }])),
    initAsync: false, keySeparator: false, interpolation: { escapeValue: false } });
  return instance;
}
const instances = new Map();
export function translator(language) {
  const locale = matchLanguage(language) ?? 'en';
  if (!instances.has(locale)) instances.set(locale, createI18n(locale));
  return instances.get(locale).getFixedT(locale);
}
const errorCodes = { invalid_input: 'invalid_input', usage: 'invalid_input', conflict: 'conflict', not_found: 'not_found',
  schema: 'schema', migration: 'migration', empty: 'empty', connection: 'connection', keychain: 'storage',
  authentication: 'authentication', EACCES: 'permission', EPERM: 'permission', ENOENT: 'not_found', storage: 'storage' };
export function errorMessage(error, language) {
  const key = error?.messageKey && Object.hasOwn(en, error.messageKey) ? error.messageKey : `errors.${errorCodes[error?.code] ?? 'unknown'}`;
  return translator(language)(key, error?.params ?? {});
}
