import { useEffect, useId, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, ChevronDown, Search, Zap } from 'lucide-react';
import { dimension } from './theme';
import { useOnboardingAgents } from './useOnboardingAgents';
import { call, type AgentSnapshot } from './types';
import type { ProviderID } from '../service/agent-store';
import type { ModelOption, ModelSettings, NativeModel, AgentReadiness } from '../service/agents/types';
import type { translator } from './i18n';
import type { MessageKey } from '@polaris/i18n';

const providers: ProviderID[] = ['chatgpt-codex', 'claude-code', 'gemini-cli', 'opencode'];
const states: Partial<Record<AgentReadiness, MessageKey>> = { signed_out: 'onboarding.notSignedIn', missing: 'onboarding.notInstalled', outdated: 'onboarding.updateNeeded', failed: 'onboarding.checkFailed', checking: 'agent.checkingModels' };
const levels: Record<string, MessageKey> = { default: 'settings.default', none: 'agent.reasoningNone', minimal: 'agent.reasoningMinimal', low: 'agent.reasoningLow', medium: 'agent.reasoningMedium', high: 'agent.reasoningHigh', xhigh: 'agent.reasoningXhigh', max: 'agent.reasoningMax', ultra: 'agent.reasoningUltra' };
const keyOf = (provider: ProviderID, model: string) => JSON.stringify([provider, model]);

export function AgentModelSelector({ native, disabled, onChange, t, onOpenChange }: {
  native: NonNullable<AgentSnapshot['native']>; disabled: boolean; onOpenChange?(open: boolean): void;
  onChange(provider: ProviderID, model: string, settings: ModelSettings): void; t: ReturnType<typeof translator>;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [browsed, setBrowsed] = useState('');
  useEffect(() => { onOpenChange?.(open); }, [open]);
  const [details, setDetails] = useState<Record<string, NativeModel>>({}), [failed, setFailed] = useState('');
  const [expanded, setExpanded] = useState<ProviderID>(), [copied, setCopied] = useState('');
  const search = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null), listID = useId();
  const { agents, retry } = useOnboardingAgents(open);
  const groups = providers.map(provider => {
    const agent = agents.find(item => item.provider === provider)!;
    const connected = native.connections.find(item => item.provider === provider);
    const models = agent.state === 'ready' ? agent.models ?? [] : agent.state === 'checking' && connected?.connected ? connected.models : [];
    return { ...agent, models: models.map(model => ({ ...model, options: details[keyOf(provider, model.id)]?.options ?? model.options, provider, key: keyOf(provider, model.id) })) };
  });
  const all = groups.flatMap(group => group.models);
  const connection = native.connections.find(item => item.provider === native.selected);
  const selectedID = native.model || connection?.model || all.find(item => item.provider === native.selected && item.isDefault)?.id || '';
  const selectedKey = keyOf(native.selected, selectedID);
  const selected = all.find(item => item.key === selectedKey) ?? connection?.models.find(item => item.id === selectedID);
  const selectedSettings = native.modelSettings ?? connection?.modelSettings ?? {};
  const filtered = all.filter(model => `${model.name} ${groups.find(group => group.provider === model.provider)?.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const focused = filtered.find(model => model.key === browsed) ?? filtered.find(model => model.key === selectedKey) ?? filtered[0];
  const focusKey = focused?.key;
  const settingsFor = (key: string, provider: ProviderID, model: string) => key === selectedKey ? selectedSettings : native.connections.find(item => item.provider === provider)?.modelPreferences?.[model] ?? {};
  const valueFor = (option: ModelOption, settings: ModelSettings) => settings[option.id] ?? option.currentValue ?? option.defaultValue;
  const label = (option: ModelOption, choice: ModelOption['choices'][number]) => {
    if (option.kind === 'reasoning') return levels[String(choice.value)] ? t(levels[String(choice.value)]) : choice.name;
    if (choice.value === 'ultrafast') return t('agent.speedUltrafast');
    return choice.fast ? t('agent.speedFast') : ['default', 'standard', 'off', false].includes(choice.value) ? t('agent.speedStandard') : choice.name;
  };
  const reasoning = selected?.options?.find(option => option.kind === 'reasoning');
  const chosenReasoning = reasoning?.choices.find(choice => choice.value === valueFor(reasoning, selectedSettings));
  const fast = selected?.options?.some(option => option.kind === 'speed' && option.choices.some(choice => choice.fast && choice.value === valueFor(option, selectedSettings)));
  const name = selected?.name ?? (selectedID || t('settings.default'));

  useEffect(() => {
    if (!open || !focused) return;
    let alive = true;
    const timer = setTimeout(() => {
      void call('agentNative', { action: 'modelOptions', provider: focused.provider, model: focused.id }).then(model => {
        if (alive) { setDetails(previous => ({ ...previous, [focused.key]: model })); setFailed(''); }
      }, () => { if (alive) setFailed(focused.key); });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, focusKey]);

  function choose(model: NonNullable<typeof focused>, override: ModelSettings = {}) {
    const saved = settingsFor(model.key, model.provider, model.id);
    const valid = model.options === undefined ? saved : Object.fromEntries(Object.entries(saved).filter(([id, value]) => model.options?.some(option => option.id === id && option.choices.some(choice => choice.value === value))));
    onChange(model.provider, model.id, { ...valid, ...override }); setOpen(false);
  }
  function move(key: string) {
    const index = filtered.findIndex(model => model.key === focusKey);
    const next = key === 'Home' ? 0 : key === 'End' ? filtered.length - 1 : (index + (key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
    if (filtered[next]) { setBrowsed(filtered[next].key); document.getElementById(`${listID}-${next}`)?.scrollIntoView({ block: 'nearest' }); }
  }
  return <Popover.Root open={open && !disabled} onOpenChange={value => { setOpen(value); if (value) { setQuery(''); setBrowsed(selectedKey); setExpanded(undefined); setFailed(''); } }}>
    <Popover.Trigger asChild><button type="button" className="agent-model-trigger" disabled={disabled} aria-label={t('settings.model')} title={name}
      onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setQuery(''); setOpen(true); setBrowsed(selectedKey); } }}>
      {fast && <Zap className="agent-model-bolt" aria-hidden="true" />}<span className="agent-model-name">{name}</span>
      {reasoning && chosenReasoning && chosenReasoning.value !== 'default' && <span className="agent-model-level">{label(reasoning, chosenReasoning)}</span>}
      <ChevronDown aria-hidden="true" />
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content ref={panel} className="agent-model-menu" data-agent-model-menu="" aria-label={t('settings.model')} side="top" align="end" sideOffset={dimension('--xs')} collisionPadding={dimension('--s')}
      onOpenAutoFocus={event => { event.preventDefault(); search.current?.focus(); }} onEscapeKeyDown={event => event.stopPropagation()}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'ArrowLeft' && event.target !== search.current) { event.preventDefault(); search.current?.focus(); } }}>
      <div className="agent-model-column">
        <div className="agent-model-head agent-model-search"><Search aria-hidden="true" /><input ref={search} value={query} placeholder={t('agent.searchModels')} aria-label={t('agent.searchModels')} role="combobox" aria-expanded="true" aria-controls={listID} aria-activedescendant={focused ? `${listID}-${filtered.indexOf(focused)}` : undefined}
          onChange={event => { setQuery(event.target.value); setBrowsed(''); }} onKeyDown={event => {
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); move(event.key); }
            if (event.key === 'Enter' && focused) { event.preventDefault(); choose(focused); }
            if (event.key === 'ArrowRight') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('.agent-model-settings button')?.focus(); }
          }} /></div>
        <div className="agent-model-list" id={listID} role="listbox" aria-label={t('settings.model')}>
          {groups.map(group => { const models = filtered.filter(model => model.provider === group.provider); return models.length ? <div role="group" aria-label={group.name} key={group.provider}>
            <div className="agent-model-group">{group.name}</div>
            {models.map(model => <button type="button" role="option" tabIndex={-1} id={`${listID}-${filtered.indexOf(model)}`} key={model.key} className="agent-model-option" aria-selected={model.key === selectedKey} data-active={model.key === focusKey}
              onPointerMove={() => setBrowsed(model.key)} onFocus={() => setBrowsed(model.key)} onClick={() => choose(model)} title={model.name}>
              <span>{model.name}</span>{model.key === selectedKey && <Check aria-hidden="true" />}
            </button>)}
          </div> : null; })}
          {!filtered.length && <div className="agent-model-empty" role="status">{t(query ? 'agent.noMatchingModels' : agents.some(agent => agent.state === 'checking') ? 'agent.checkingModels' : 'agent.noAvailableModels')}</div>}
        </div>
        <div className="agent-model-unavailable">{groups.filter(group => !group.models.length && group.state !== 'ready').map(group => <div key={group.provider}>
          <div className="agent-model-offline"><span>{group.name}</span><button type="button" onClick={() => { setExpanded(expanded === group.provider ? undefined : group.provider); if (!group.command) retry(group); }}>{t(states[group.state] ?? 'onboarding.checkFailed')}</button></div>
          {expanded === group.provider && group.command && <div className="agent-model-fix"><code>{group.command}</code><button type="button" onClick={() => { void window.polaris.copyText(group.command!).then(() => setCopied(group.provider), () => setCopied('')); }}>{t(copied === group.provider ? 'onboarding.copied' : 'common.copy')}</button></div>}
        </div>)}</div>
      </div>
      <div className="agent-model-column agent-model-settings">
        <div className="agent-model-head"><strong title={focused?.name}>{focused?.name}</strong></div>
        <div className="agent-model-list">
          {focused?.options?.map(option => <div role="radiogroup" aria-label={t(option.kind === 'reasoning' ? 'agent.reasoning' : 'agent.speed')} key={option.id}>
            <div className="agent-model-group">{t(option.kind === 'reasoning' ? 'agent.reasoning' : 'agent.speed')}</div>
            {option.choices.map(choice => <button type="button" role="radio" aria-checked={choice.value === valueFor(option, settingsFor(focused.key, focused.provider, focused.id))} className="agent-model-option" key={String(choice.value)}
              title={option.description} onKeyDown={event => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const buttons = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role=radio]')], index = buttons.indexOf(event.currentTarget);
                buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
              }} onClick={() => choose(focused, { [option.id]: choice.value })}>
              <span className="agent-model-choice">{label(option, choice)}{choice.fast && <Zap className="agent-model-bolt" aria-hidden="true" />}</span>
              {choice.fast ? <span className="agent-model-hint">{t('agent.speedUsage')}</span> : option.kind === 'reasoning' && choice.value === option.defaultValue && choice.value !== 'default' ? <span className="agent-model-hint">{t('settings.default')}</span> : null}
              <span className="agent-model-check">{choice.value === valueFor(option, settingsFor(focused.key, focused.provider, focused.id)) && <Check aria-hidden="true" />}</span>
            </button>)}
          </div>)}
          {focused && !focused.options?.length && <div className="agent-model-empty" role="status">{t(failed === focusKey ? 'agent.modelOptionsUnavailable' : focused.options === undefined ? 'agent.checkingModels' : 'agent.noModelOptions')}</div>}
        </div>
        {focused && focused.provider !== native.selected && <div className="agent-model-note">{t('agent.modelHandoff')}</div>}
      </div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
