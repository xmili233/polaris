import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AgentComposer } from './AgentComposer';
import { AgentAvatar, mainAgentAvatarID } from './AgentAvatar';
import { call } from './types';
import type { AgentWorkSummary } from '../service/agent-store';
import { useLocale } from './LocaleProvider';
import { translator } from './i18n';
import { onboardingProviders } from '../service/agents/types';
import { dimension, duration } from './theme';
import { resultLine, type TaskResult } from './Executions';
import { easing, reducedMotion, swapIn, swapOut, useLeaving, useListMotion } from './motion';

type Entry = { kind: 'work'; work: AgentWorkSummary } | { kind: 'result'; result: TaskResult } | { kind: 'divider' };
const entryKey = (entry: Entry) => entry.kind === 'work' ? `w:${entry.work.sessionKey}` : entry.kind === 'result' ? `r:${entry.result.jobID}` : 'divider';

function elapsed(since: string | null | undefined, language: string) {
  const start = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(start)) return '';
  const seconds = Math.max(0, (Date.now() - start) / 1000);
  const [value, unit] = seconds < 60 ? [Math.max(1, Math.round(seconds)), 'second'] : seconds < 3600 ? [Math.floor(seconds / 60), 'minute'] : [Math.floor(seconds / 3600), 'hour'];
  return new Intl.NumberFormat(language, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

export function WorkAgentRail({ guiding, goalReady, onFirstGoal, onDecision, obscured = false }: { guiding: boolean; goalReady: boolean; onFirstGoal: () => void; onDecision: (id: string) => void; obscured?: boolean }) {
  const { config } = useLocale(), t = translator(config.language);
  const [works, setWorks] = useState<AgentWorkSummary[]>([]), [results, setResults] = useState<TaskResult[]>([]), [loaded, setLoaded] = useState(false);
  const [latestReplyID, setLatestReplyID] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [hint, setHint] = useState<{ id: string; top: number; warm: boolean }>(), [hintClosing, setHintClosing] = useState(false);
  const [failed, setFailed] = useState(false), [mainUnread, setMainUnread] = useState(false);
  const mainButton = useRef<HTMLButtonElement>(null), conversationRegion = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null), list = useRef<HTMLDivElement>(null), selection = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLElement>(null), content = useRef<HTMLDivElement>(null), scrim = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined), hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closing = useRef(false), switching = useRef(false), wasOpen = useRef(false), generation = useRef(0), signature = useRef('');
  const result = results.find(item => item.taskID === selected);
  const work = works.find(w => w.sessionKey === selected) ?? (result ? { id: result.workID, title: result.title, sessionKey: result.taskID, provider: result.provider, state: 'completed' as const, startedAt: null } : undefined);
  const mainSelected = selected === 'main';
  const modalOpen = !guiding && !obscured && (mainSelected || !!work);
  const entries = useMemo<Entry[]>(() => [
    ...works.map(item => ({ kind: 'work' as const, work: item })),
    ...(works.length && results.length ? [{ kind: 'divider' as const }] : []),
    ...results.map(item => ({ kind: 'result' as const, result: item })),
  ], [works, results]);
  const shown = useLeaving(entries, entryKey);
  // R-D169: new avatars grow in; the others glide to their new places.
  useListMotion(list, '[data-motion-key]', node => {
    if (!node.classList.contains('work-divider')) node.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: duration('--motion-list'), easing: easing('--spring') });
  });

  useEffect(() => {
    let alive = true, loading = false, dirty = false, timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (loading) { dirty = true; return; }
      loading = true;
      try {
        const { works: data, results: ended, latestReplyID } = await call('agentActivity');
        if (alive) { setLatestReplyID(latestReplyID); setFailed(false); const value = JSON.stringify([data, ended]); if (value !== signature.current) { signature.current = value; setWorks(data); setResults(ended); } setLoaded(true); }
      } catch { if (alive) setFailed(true); }
      finally { loading = false; if (alive && dirty) { dirty = false; schedule(); } }
    };
    const schedule = () => { timer ??= setTimeout(() => { timer = undefined; void read(); }, 100); };
    void read(); const stop = window.polaris.onAgent(schedule), poll = setInterval(read, 5000);
    return () => { alive = false; stop(); clearInterval(poll); clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (selected && (guiding || (!mainSelected && !work))) {
      setSelected(undefined); generation.current++; closing.current = false;
      if (!guiding) requestAnimationFrame(() => mainButton.current?.focus({ preventScroll: true }));
    }
  }, [selected, mainSelected, work, works, guiding]);
  useEffect(() => () => { clearTimeout(showTimer.current); clearTimeout(hideTimer.current); }, []);

  // R-D169: the hint waits once, then follows the pointer between neighbours and leaves after a short grace.
  function hideHint(now = false) {
    clearTimeout(showTimer.current); clearTimeout(hideTimer.current);
    if (now) { setHint(undefined); setHintClosing(false); return; }
    hideTimer.current = setTimeout(() => {
      setHintClosing(true);
      hideTimer.current = setTimeout(() => { setHint(undefined); setHintClosing(false); }, reducedMotion() ? 0 : duration('--motion-exit'));
    }, duration('--motion-hint-grace'));
  }
  function showHint(id: string, button: HTMLElement) {
    clearTimeout(showTimer.current); clearTimeout(hideTimer.current);
    if (modalOpen && (work?.id === id || (mainSelected && id === 'main'))) { hideHint(true); return; }
    const rect = button.getBoundingClientRect(), top = Math.max(16, Math.min(innerHeight - 16, rect.top + rect.height / 2));
    if (hint && !hintClosing) { setHint({ id, top, warm: true }); return; }
    if (hint) { setHintClosing(false); setHint({ id, top, warm: true }); return; }
    showTimer.current = setTimeout(() => setHint({ id, top, warm: false }), reducedMotion() ? 0 : duration('--motion-hint-delay'));
  }
  function open(id: string) {
    const version = ++generation.current; closing.current = false; hideHint(true);
    if (modalOpen && selected && selected !== id) {
      switching.current = true;
      void swapOut(content.current, `translateY(${-dimension('--motion-shift') / 2}px)`).then(() => { if (version === generation.current) setSelected(id); });
      return;
    }
    setSelected(id);
  }
  async function close(after?: () => void) {
    if (closing.current || !selected) return;
    closing.current = true; const id = work?.id, version = ++generation.current;
    const time = duration('--motion-dialog-exit'), ease = easing('--ease-exit');
    const shift = reducedMotion() ? 'none' : `translateX(${dimension('--motion-slide') * .7}px) scale(.985)`;
    const panel = dialog.current, layer = scrim.current;
    const animations = [
      panel && panel.animate([{ opacity: getComputedStyle(panel).opacity, transform: 'none' }, { opacity: 0, transform: shift }], { duration: time, easing: ease, fill: 'forwards' }),
      layer && layer.animate([{ opacity: getComputedStyle(layer).opacity }, { opacity: 0 }], { duration: time, easing: ease, fill: 'forwards' }),
    ];
    await Promise.all(animations.map(animation => animation?.finished.catch(() => {})));
    if (version !== generation.current) return;
    setSelected(undefined); closing.current = false;
    requestAnimationFrame(() => {
      if (after) { after(); return; }
      const trigger = id && document.querySelector<HTMLButtonElement>(result ? `[data-result-id="${result.jobID}"]` : `[data-work-id="${CSS.escape(id)}"]`);
      (trigger || mainButton.current)?.focus({ preventScroll: true });
    });
  }
  // R-D169: the dialog slides out of the rail once; switching between conversations only swaps what is inside it.
  useLayoutEffect(() => {
    if (!modalOpen) {
      wasOpen.current = false; switching.current = false;
      for (const node of [dialog.current, content.current]) node?.getAnimations().forEach(animation => animation.cancel());
      if (content.current) content.current.inert = false;
      return;
    }
    if (!wasOpen.current) {
      wasOpen.current = true; switching.current = false;
      content.current?.getAnimations().forEach(animation => animation.cancel());
      if (content.current) content.current.inert = false;
      dialog.current?.animate([{ opacity: 0, transform: reducedMotion() ? 'none' : `translateX(${dimension('--motion-slide')}px) scale(.98)` }, { opacity: 1, transform: 'none' }],
        { duration: duration('--motion-dialog'), easing: easing('--ease-enter') });
      scrim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration('--motion-enter'), easing: easing('--ease-enter') });
    } else if (switching.current) {
      switching.current = false;
      swapIn(content.current, `translateY(${dimension('--motion-shift') / 2}px)`);
    }
    const initialFocus = mainSelected ? dialog.current?.querySelector<HTMLTextAreaElement>('.main-agent textarea:not(:disabled)') : undefined;
    (initialFocus ?? dialog.current)?.focus({ preventScroll: true });
  }, [modalOpen, selected, mainSelected]);
  // The white selection tile slides to whichever conversation is open.
  useLayoutEffect(() => {
    const node = selection.current, host = rail.current, scroller = list.current;
    if (!node || !host) return;
    const target = modalOpen ? host.querySelector<HTMLElement>('.work-items [aria-expanded="true"]') : null;
    if (!target) { node.classList.remove('visible'); return; }
    const place = (animate: boolean) => {
      const y = target.offsetTop - (scroller?.contains(target) ? scroller.scrollTop : 0);
      node.style.transition = animate ? '' : `opacity ${duration('--motion-enter')}ms`;
      node.style.transform = `translate(${target.offsetLeft}px, ${y}px)`;
    };
    place(node.classList.contains('visible'));
    node.classList.add('visible');
    const follow = () => place(false);
    scroller?.addEventListener('scroll', follow);
    return () => scroller?.removeEventListener('scroll', follow);
  });
  useEffect(() => {
    if (!modalOpen) return;
    const backgrounds = [...document.querySelectorAll<HTMLElement>('.app > .board-pane, .app > .goal-rail, .app > .dismiss-layer, .account-control')];
    const previous = backgrounds.map(n => n.inert); backgrounds.forEach(n => n.inert = true);
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.settings-layer,.modal-layer')) return;
      if (e.metaKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); }
      if (document.querySelector('[data-agent-model-menu]') || (e.key === 'Escape' && e.target instanceof Element && e.target.closest('.agent')?.querySelector('.agent-command-menu'))) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); void close(); }
      if (e.key === 'Tab' && conversationRegion.current) {
        const nodes = [...conversationRegion.current.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),a[href],summary')].filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest('[inert]')), first = nodes[0], last = nodes.at(-1);
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); backgrounds.forEach((n, i) => n.inert = previous[i]); };
  }, [modalOpen, selected, work?.id, result, config.reducedMotion]);
  function navigate(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([inert])')];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  }
  const workLine = (w: AgentWorkSummary) => w.state === 'running'
    ? [t('work.executing'), w.startedAt ? t('work.runningFor', { duration: elapsed(w.startedAt, config.language) }) : ''].filter(Boolean).join(' · ')
    : t(w.state === 'waiting_connection' ? 'execution.status.waiting_connection' : 'execution.status.queued');
  const hover = (id: string) => ({
    onPointerEnter: (e: { currentTarget: HTMLElement }) => showHint(id, e.currentTarget), onPointerLeave: () => hideHint(),
    onFocus: (e: { currentTarget: HTMLElement }) => showHint(id, e.currentTarget), onBlur: () => hideHint(),
  });

  const hintContent = (() => {
    if (!hint) return;
    if (hint.id === 'main') return { title: t('agent.mainAgent'), line: mainUnread ? t('agent.newReply') : '' };
    const w = works.find(item => item.id === hint.id), r = results.find(item => item.jobID === hint.id);
    return w ? { title: w.title, line: workLine(w) } : r ? { title: r.title, line: resultLine(r, t) } : undefined;
  })();
  return <div ref={conversationRegion} role={modalOpen ? 'dialog' : undefined} aria-modal={modalOpen || undefined}
    aria-label={modalOpen && mainSelected ? t('agent.mainAgent') : undefined}
    aria-labelledby={modalOpen && work ? 'work-chat-title' : undefined}>
    <aside ref={rail} className="work-rail" aria-label={t('work.agents')} hidden={guiding} inert={obscured}>
      <span ref={selection} className="work-selection" aria-hidden="true" />
      <div className="work-items" onKeyDown={navigate}>
        <button ref={mainButton} className="main-agent-entry" aria-label={t('agent.mainAgent')} aria-description={mainUnread ? t('agent.newReply') : undefined} aria-haspopup="dialog" aria-expanded={modalOpen && mainSelected}
          {...hover('main')} onClick={() => mainSelected ? void close() : open('main')}>
          <AgentAvatar id={mainAgentAvatarID} state="completed" />
          {mainUnread && <span className="agent-unread" role="status" aria-label={t('agent.newReply')} />}
        </button>
        {works.length + results.length > 0 && <span className="work-divider main-agent-divider" aria-hidden="true" />}
        {loaded && <div ref={list} className="background-work-items">
          {shown.map(({ key, item, leaving }) => {
            if (item.kind === 'divider') return <span key={key} data-motion-key={key} className={`work-divider ${leaving ? 'leaving' : ''}`} aria-hidden="true" />;
            if (item.kind === 'work') {
              const w = item.work;
              return <button key={key} data-motion-key={key} inert={leaving || undefined} className={`work-item ${w.state === 'running' ? 'running' : 'waiting'} ${leaving ? 'leaving' : ''}`} data-work-id={w.id} data-work-session={w.sessionKey}
                aria-label={`${w.title} · ${workLine(w)}`} aria-haspopup="dialog" aria-expanded={modalOpen && selected === w.sessionKey}
                {...hover(w.id)} onClick={() => selected === w.sessionKey ? void close() : open(w.sessionKey!)}>
                <AgentAvatar id={w.sessionKey!} state={w.state} visible={!guiding && !obscured} reducedMotion={config.reducedMotion} />
                <svg className="work-ring" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="21" /></svg>
              </button>;
            }
            const r = item.result;
            return <button key={key} data-motion-key={key} inert={leaving || undefined} className={`work-item result ${r.kind} ${leaving ? 'leaving' : ''}`} data-result-id={r.jobID} aria-label={`${r.title} · ${resultLine(r, t)}`} aria-haspopup="dialog" aria-expanded={modalOpen && selected === r.taskID}
              {...hover(r.jobID)} onClick={() => selected === r.taskID ? void close() : open(r.taskID)}>
              <AgentAvatar id={r.taskID} state="completed" reducedMotion={config.reducedMotion} />
              <span className="work-result-mark" aria-hidden="true">!</span>
            </button>;
          })}
        </div>}
      </div>
    </aside>
    {hint && hintContent && !guiding && !obscured && <div className={`work-hint ${hint.warm ? 'warm' : ''} ${hintClosing ? 'closing' : ''}`} role="tooltip" style={{ top: hint.top }}>
      {hintContent.title}{hintContent.line && <small>{hintContent.line}</small>}
    </div>}
    {modalOpen && <div className="work-chat-scrim" ref={scrim} onClick={() => void close()} />}
    <section className={modalOpen ? 'work-chat-dialog' : undefined} ref={dialog} hidden={!guiding && !modalOpen} tabIndex={modalOpen ? -1 : undefined}>
      <div ref={content} className="work-chat-content">
        <div className={guiding ? undefined : 'main-chat agent-dialog-chat'} hidden={!guiding && !mainSelected}>
          <AgentComposer t={t} fullWindow={guiding} goalReady={goalReady} onFirstGoal={onFirstGoal} open={guiding || (modalOpen && mainSelected)}
            onNotice={setMainUnread} latestReplyID={latestReplyID} onClose={() => void close()} onDecision={id => guiding ? onDecision(id) : void close(() => onDecision(id))} />
        </div>
        {work && modalOpen && <>
          <header className="work-chat-title"><AgentAvatar id={work.sessionKey!} state={work.state} reducedMotion={config.reducedMotion} /><div className="work-chat-heading"><h2 id="work-chat-title">{work.title}</h2><span>{[onboardingProviders.find(p => p.provider === work.provider)?.name, result ? resultLine(result, t) : 'lastJobID' in work ? workLine(work) : t('work.executing')].filter(Boolean).join(' · ')}</span></div><button className="agent-action" aria-label={t('common.close')} onClick={() => void close()}>×</button></header>
          {failed && <p className="agent-status" role="status">{t('errors.connection')}</p>}
          <div className="child-chat agent-dialog-chat"><AgentComposer key={work.sessionKey} workID={work.id} workSessionKey={work.sessionKey} t={t} onDecision={id => void close(() => onDecision(id))} /></div>
        </>}
      </div>
    </section>
  </div>;
}
