import { defineConfig } from 'i18next-cli';
import { supportedLanguages } from './packages/i18n/languages.js';
export default defineConfig({
  locales: supportedLanguages,
  extract: {
    input: ['desktop/src/**/*.{ts,tsx}', 'desktop/electron/**/*.mjs', 'desktop/service/**/*.ts', 'web/app/**/*.{ts,tsx}'],
    output: 'packages/i18n/locales/{{language}}.json', defaultNS: 'translation', keySeparator: false,
    primaryLanguage: 'en', removeUnusedKeys: false,
  },
});
