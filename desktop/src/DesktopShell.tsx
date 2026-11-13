import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { usePresence } from './motion';
import { useLocale } from './LocaleProvider';
import { translator } from './i18n';
import { WorkspaceGate } from './WorkspaceGate';
import { onOpenSettings, SettingsDialog, type SettingsPage } from './Settings';

export function DesktopShell() {
  const { config } = useLocale(), t = translator(config.language);
  const [settings, setSettings] = useState<SettingsPage | undefined>(config.showSettings ? 'general' : undefined);
  const lastPage = useRef<SettingsPage>('general'), button = useRef<HTMLButtonElement>(null);
  const dialog = usePresence(!!settings);
  useEffect(() => { if (settings) lastPage.current = settings; }, [settings]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === ',') { event.preventDefault(); setSettings(lastPage.current); }
    };
    document.addEventListener('keydown', key);
    const stop = onOpenSettings(setSettings), stopNative = window.polaris.onSettings(() => setSettings(lastPage.current));
    return () => { document.removeEventListener('keydown', key); stop(); stopNative(); };
  }, []);
  return <>
    <WorkspaceGate t={t} />
    <button ref={button} className="settings-launcher" aria-label={t('settings.title')} title={t('settings.title')}
      onClick={() => setSettings(lastPage.current)}><SettingsIcon aria-hidden="true" /></button>
    {dialog.present && <SettingsDialog page={settings ?? lastPage.current} leaving={dialog.closing} onPage={setSettings}
      onClose={() => { setSettings(undefined); button.current?.focus({ preventScroll: true }); }} t={t} />}
  </>;
}
