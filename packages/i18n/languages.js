export const languages = [
  { code: 'en', name: 'English' }, { code: 'zh-Hans', name: '简体中文' },
  { code: 'zh-Hant', name: '繁體中文' }, { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' }, { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' }, { code: 'es', name: 'Español' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
];
export const supportedLanguages = languages.map(item => item.code);
export function matchLanguage(value) {
  if (typeof value !== 'string') return undefined;
  try {
    const locale = new Intl.Locale(value.replaceAll('_', '-'));
    if (locale.language === 'zh') return locale.script === 'Hant' || (!locale.script && ['TW', 'HK', 'MO'].includes(locale.region)) ? 'zh-Hant' : 'zh-Hans';
    if (locale.language === 'pt') return 'pt-BR';
    return supportedLanguages.find(code => code === locale.language);
  } catch { return undefined; }
}
export const isLanguagePreference = value => value === 'auto' || supportedLanguages.includes(value);
export function resolveLanguage(preference = 'auto', systemLanguages = []) {
  if (preference !== 'auto' && supportedLanguages.includes(preference)) return preference;
  return systemLanguages.map(matchLanguage).find(Boolean) ?? 'en';
}
