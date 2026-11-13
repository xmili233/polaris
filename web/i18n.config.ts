import type { I18nConfig } from 'next-i18next/proxy';
import { catalogs, supportedLanguages, type Language } from '@polaris/i18n';
const config: I18nConfig = {
  supportedLngs: supportedLanguages, fallbackLng: 'en', localeParamName: 'locale', defaultNS: 'translation', ns: ['translation'],
  resourceLoader: async language => catalogs[language as Language],
  i18nextOptions: { keySeparator: false },
};
export default config;
