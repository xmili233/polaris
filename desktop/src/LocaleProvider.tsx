import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { createI18n, type LanguagePreference } from '@polaris/i18n';
import type { Appearance, Config } from './types';
import { applyColorScheme } from './color-scheme';

const instance = createI18n('en');
const LocaleContext = createContext<{ config: Config; changeLanguage: (language: LanguagePreference) => Promise<void>; changeAppearance: (appearance: Appearance) => Promise<void> } | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>();
  useEffect(() => {
    let alive = true;
    const receive = (value: Config) => {
      if (!alive) return;
      void instance.changeLanguage(value.language);
      document.documentElement.lang = value.language;
      document.documentElement.classList.toggle('reduce-motion', value.reducedMotion);
      applyColorScheme(value.dark);
      setConfig(value);
    };
    const stop = window.polaris.onConfig(receive);
    void window.polaris.config().then(receive);
    return () => { alive = false; stop(); };
  }, []);
  return config && <LocaleContext.Provider value={{ config, changeLanguage: async preference => {
    const value = await window.polaris.setLanguage(preference);
    void instance.changeLanguage(value.language); setConfig(value); document.documentElement.lang = value.language;
  }, changeAppearance: async appearance => { const value = await window.polaris.setAppearance(appearance); applyColorScheme(value.dark); setConfig(value); } }}><I18nextProvider i18n={instance}>{children}</I18nextProvider></LocaleContext.Provider>;
}
export function useLocale() {
  useTranslation();
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LocaleProvider is required.');
  return value;
}
