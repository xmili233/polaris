import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { languages, type LanguagePreference, type MessageKey } from '@polaris/i18n';
import { useLocale } from './LocaleProvider';
import { call, type AgentSnapshot, type Appearance } from './types';
import { AgentModelSelector } from './AgentModelSelector';
import { usePresence } from './motion';
import type { translator } from './i18n';
import type { ProviderID } from '../service/agent-store';
import type { ModelSettings } from '../service/agents/types';

type T = ReturnType<typeof translator>;
type Native = NonNullable<AgentSnapshot['native']>;
export type SettingsPage = 'general' | 'model';

// R-D87: anything outside the account menu (the Agent's "去设置") opens settings through this event.
const settingsEvent = 'polaris:settings';
export function openSettings(page: SettingsPage = 'general') { window.dispatchEvent(new CustomEvent(settingsEvent, { detail: page })); }
export function onOpenSettings(callback: (page: SettingsPage) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<SettingsPage>).detail);
  window.addEventListener(settingsEvent, listener);
  return () => window.removeEventListener(settingsEvent, listener);
}


function Icon({ path }: { path: string }) { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={path} /></svg>; }
const close = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" /></svg>;
const down = <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>;
const check = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;

// R-D88–R-D91: left navigation, one white page; changes apply at once.
export function SettingsDialog({ page, onPage, onClose, t, leaving = false }: {
  page: SettingsPage; onPage: (page: SettingsPage) => void; onClose: () => void; leaving?: boolean;
  t: T;
}) {
  const dialog = useRef<HTMLElement>(null);
  const picking = useRef(false), closing = useRef(onClose);
  closing.current = onClose;
  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !picking.current) { event.preventDefault(); event.stopPropagation(); closing.current(); }
      // Keep keyboard focus inside the dialog while it is open.
      if (event.key !== 'Tab' || !dialog.current || (picking.current && (event.target as Element).closest('.language-popover'))) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey ? index <= 0 : index === items.length - 1) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  const pages = ([
    ['general', 'settings.general', 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM3 10h14M10 3c3 4 3 10 0 14-3-4-3-10 0-14Z'],
    ['model', "settings.model", 'M10 3 16 6.5v7L10 17l-6-3.5v-7L10 3ZM4 6.5 10 10l6-3.5M10 10v7'],
  ] as [SettingsPage, MessageKey, string][]);
  return <div className={`settings-layer ${leaving ? 'surface-closing' : ''}`} inert={leaving || undefined} onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className="settings" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
      <nav className="settings-nav" role="tablist" aria-label={t("settings.title")}>
        {pages.map(([id, name, path]) => <button key={id} role="tab" aria-selected={page === id} tabIndex={page === id ? 0 : -1} onClick={() => onPage(id)}
          onKeyDown={event => { if (['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const next = pages[(pages.findIndex(item => item[0] === id) + (event.key === 'ArrowDown' ? 1 : pages.length - 1)) % pages.length][0]; onPage(next); requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()); } }}>
          <Icon path={path} />{t(name)}</button>)}
      </nav>
      <div className="settings-page" role="tabpanel">
        {page === 'general' ? <LanguagePage t={t} picking={picking} /> : <ModelPage t={t} picking={picking} />}
        <button className="settings-close" aria-label={t("common.close")} onClick={onClose}>{close}</button>
      </div>
    </section>
  </div>;
}

function ModelPage({ t, picking }: { t: T; picking: { current: boolean } }) {
  const [native, setNative] = useState<Native>(), [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const read = () => void call('agentSnapshot').then(snapshot => { if (alive) setNative(snapshot.native); }).catch(() => { if (alive) setFailed(true); });
    read(); const stop = window.polaris.onAgent(read); return () => { alive = false; stop(); picking.current = false; };
  }, []);
  async function choose(sub: boolean, provider: ProviderID, model: string, settings: ModelSettings) {
    setBusy(true); setFailed(false);
    try {
      if (sub) {
        if (!native?.connections.find(connection => connection.provider === provider)?.connected) await call('agentNative', { action: 'connect', provider });
        setNative(await call('agentNative', { action: 'subModel', provider, model, settings }));
      } else setNative((await call('agentNative', { action: 'chooseModel', provider, model, settings })).native);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  const sub = native?.sub;
  const subNative = native && { ...native, selected: sub?.provider ?? native.selected, model: sub?.model ?? native.model,
    modelSettings: sub?.settings ?? (sub ? native.connections.find(connection => connection.provider === sub.provider)?.modelPreferences?.[sub.model] : native.modelSettings) };
  return <>
    <h2>{t('settings.model')}</h2>
    {native && <div className="setting"><span className="setting-name">{t('settings.mainModel')}</span><AgentModelSelector native={native} disabled={busy} t={t} onOpenChange={open => { picking.current = open; }} onChange={(provider,model,settings) => void choose(false,provider,model,settings)} /></div>}
    <div className="setting"><span className="setting-name">{t('settings.subAgentModel')}</span></div>
    <label className="model-follow"><input type="checkbox" checked={!sub} disabled={busy || !native} onChange={async event => {
      if (!native) return; setBusy(true); setFailed(false);
      try { setNative(event.target.checked ? await call('agentNative', { action: 'subModel', provider: native.selected, follow: true }) : await call('agentNative', { action: 'subModel', provider: native.selected, model: native.model ?? native.connections.find(c => c.provider === native.selected)?.model ?? '' })); }
      catch { setFailed(true); } finally { setBusy(false); }
    }} />{t('settings.sameAsMainModel')}</label>
    {sub && subNative && <AgentModelSelector native={subNative} disabled={busy} t={t} onOpenChange={open => { picking.current = open; }} onChange={(provider,model,settings) => void choose(true,provider,model,settings)} />}
    {failed && <p role="alert">{t('settings.couldnTSwitchToThisModelTry')}</p>}
  </>;
}

function LanguagePage({ t, picking }: { t: T; picking: { current: boolean } }) {
  const { config, changeLanguage } = useLocale();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const popover = usePresence(open);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [place, setPlace] = useState<CSSProperties>();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const names = new Intl.DisplayNames([config.language], { type: 'language' });
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase(config.language);
  const choices = [{ code: 'auto', name: t('settings.autoDetect') }, ...languages].filter(item =>
    normalize(`${item.name} ${item.code} ${item.code === 'auto' ? '' : names.of(item.code)}`).includes(normalize(query.trim())));
  function closeList() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  useEffect(() => { picking.current = open; return () => { picking.current = false; }; }, [open, picking]);
  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const anchor = trigger.current!.getBoundingClientRect();
      const room = innerHeight - anchor.bottom - 12;
      const below = room >= 210;
      setPlace({ right: Math.max(8, innerWidth - anchor.right), ...(below ? { top: anchor.bottom + 5 } : { bottom: innerHeight - anchor.top + 5 }), maxHeight: Math.max(130, Math.min(360, below ? room : anchor.top - 12)) });
    }
    position(); search.current?.focus({ preventScroll: true });
    window.addEventListener('resize', position);
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => { window.removeEventListener('resize', position); document.removeEventListener('pointerdown', outside, true); };
  }, [open]);
  useEffect(() => { popup.current?.querySelector(`[data-active="true"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  async function choose(preference: LanguagePreference) {
    setBusy(true); setFailed(false);
    try { await changeLanguage(preference); closeList(); } catch { setFailed(true); search.current?.focus(); }
    finally { setBusy(false); }
  }
  const selectedName = config.languagePreference === 'auto' ? t('settings.autoDetect') : languages.find(item => item.code === config.languagePreference)?.name;
  return <>
    <h2>{t('settings.general')}</h2>
    <div className="setting language-setting"><span className="setting-name">{t('settings.language')}<small>{t('settings.languageDescription')}</small></span>
      <button ref={trigger} className="setting-select" aria-label={t('settings.language')} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? 'language-options' : undefined}
        onClick={() => { setQuery(''); setActive(0); setOpen(!open); }}><span>{selectedName}</span>{down}</button>
    </div>
    {failed && <p className="settings-error" role="alert">{t('settings.languageFailed')}</p>}
    <AppearanceSetting t={t} />
    {popover.present && createPortal(<div ref={popup} className={`language-popover ${popover.closing ? 'surface-closing' : ''}`} inert={popover.closing || undefined} style={place} aria-busy={busy} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); closeList(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && choices.length) {
        if (event.target === search.current && ['Home', 'End'].includes(event.key)) return;
        event.preventDefault(); setActive(event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
      }
      if (event.key === 'Enter' && choices[active] && !busy) { event.preventDefault(); void choose(choices[active].code as LanguagePreference); }
    }}>
      <div className="language-search"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input ref={search} role="combobox" aria-expanded="true" aria-controls="language-options" aria-autocomplete="list" aria-activedescendant={choices[active] ? `language-${choices[active].code}` : undefined}
          aria-label={t('settings.searchLanguages')} placeholder={t('settings.searchLanguages')} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} />
      </div>
      <div id="language-options" className="language-options" role="listbox" aria-label={t('settings.language')}>
        {choices.map((item, index) => <button key={item.code} id={`language-${item.code}`} className="language-option" role="option" tabIndex={-1} lang={item.code === 'auto' ? config.language : item.code}
          aria-selected={item.code === config.languagePreference} data-active={index === active} disabled={busy} onPointerMove={() => setActive(index)} onClick={() => void choose(item.code as LanguagePreference)}>
          <span>{item.name}</span>{item.code === config.languagePreference ? check : <span />}</button>)}
        {!choices.length && <p className="language-empty" role="status">{t('settings.noLanguages')}</p>}
      </div>
    </div>, document.body)}
  </>;
}

const appearances: [Appearance, MessageKey][] = [['system', 'settings.appearanceSystem'], ['light', 'settings.appearanceLight'], ['dark', 'settings.appearanceDark']];
// Appearance applies at once; System follows macOS. Native radios keep arrow-key selection.
function AppearanceSetting({ t }: { t: T }) {
  const { config, changeAppearance } = useLocale();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  async function choose(appearance: Appearance) {
    setBusy(true); setFailed(false);
    try { await changeAppearance(appearance); } catch { setFailed(true); } finally { setBusy(false); }
  }
  return <>
    <div className="setting appearance-setting"><span className="setting-name">{t('settings.appearance')}<small>{t('settings.appearanceDescription')}</small></span>
      <div className="setting-segments" role="radiogroup" aria-label={t('settings.appearance')}>
        {appearances.map(([value, key]) => <label key={value}>
          <input type="radio" name="appearance" value={value} checked={config.appearance === value} disabled={busy} onChange={() => void choose(value)} />
          <span>{t(key)}</span>
        </label>)}
      </div>
    </div>
    {failed && <p className="settings-error" role="alert">{t('settings.appearanceFailed')}</p>}
  </>;
}
