import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Markdown } from './Markdown';
import { GoalIcon } from './GoalIcon';
import { GoalConstraints } from './GoalConstraints';
import { WorkAgentRail } from './WorkAgentRail';
import { StrategyRecords } from './StrategyRecords';
import { decisionPreview } from '../service/model';
import type { ScheduleSnapshot } from '../service/strategy-schedule';
import { KnowledgeLibrary } from './Knowledge';
import { Library, Clock3 } from 'lucide-react';
import { useLocale } from './LocaleProvider';
import { translator } from './i18n';
import { duration, dimension } from './theme';
import { call, pending, type Board, type Config, type Decision, type LoopState, type Strategy } from './types';
import { easing, reducedMotion, swapIn, swapOut, useListMotion } from './motion';

const empty: Board = { goals: [], strategies: [], decisions: [] };
type Rect = { left: number; top: number; width: number; height: number };
type Opened = { decision: Decision; frame?: Rect };
type T = ReturnType<typeof translator>;

function frameFor(id: string): Rect | undefined {
  const node = document.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(id)}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  const width = parseFloat(style.width), height = parseFloat(style.height);
  // Press feedback scales around the center; the modal returns to the unpressed layout box.
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}
function cssRect(rect: Rect) { return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }; }
function useViewport() {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => { const resize = () => setSize({ width: innerWidth, height: innerHeight }); addEventListener('resize', resize); return () => removeEventListener('resize', resize); }, []);
  return size;
}

export function App() {
  const { config } = useLocale();
  // R-D76: with no goal yet the Agent fills the window; 'done' once the first goal opens the board.
  const [guide, setGuide] = useState<'chat' | 'done'>();
  const [arriving, setArriving] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleSnapshot[]>([]);
  const [loops, setLoops] = useState<Record<string, LoopState>>({});
  const [board, setBoard] = useState<Board>(empty);
  const [recordsID, setRecordsID] = useState<string>();
  // R-D127: the library is a place in the goal rail; it stays mounted so an unsaved edit survives a trip to the board.
  const [view, setView] = useState<'board' | 'library'>('board'), [libraryMounted, setLibraryMounted] = useState(false);
  const app = useRef<HTMLDivElement>(null);
  // R-D169: the first goal opens the board while the full-window sheet folds into the main Agent entry.
  const [folding, setFolding] = useState(false);
  const showBoard = useCallback(() => { setGuide('done'); setArriving(true); setFolding(true); }, []);

  const [ready, setReady] = useState(false);
  const [goalID, setGoalID] = useState('');
  const [targetGoal, setTargetGoal] = useState<string>();
  const goalList = useRef<HTMLDivElement>(null), goalIndicator = useRef<HTMLSpanElement>(null);
  const boardShift = useRef(0), swapToken = useRef(0);
  const [opened, setOpened] = useState<Opened>();
  const [error, setError] = useState('');
  const [symbols, setSymbols] = useState<Record<string, string>>({});
  const [dates, setDates] = useState<Record<string, string>>({});
  const token = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  const alive = useRef(true);
  const language = config.language;
  const t = translator(language);
  const goal = board.goals.find(item => item.id === goalID);
  const strategyIDs = (id: string) => new Set(board.strategies.filter(item => item.goalID === id).map(item => item.id));

  const refresh = useCallback(async (force = false) => {
    try {
      const snapshot = await call('snapshot', force ? {} : { changeToken: token.current });
      if (!alive.current) return;
      setReady(true);
      if (!snapshot) return;
      setSchedules(snapshot.schedules ?? []); setLoops(snapshot.loops ?? {});
      if (force || snapshot.changeToken !== token.current) {
        token.current = snapshot.changeToken;
        setBoard(snapshot.board);
        setGoalID(current => snapshot.board.goals.some(item => item.id === current) ? current : snapshot.board.goals[0]?.id ?? '');
        setOpened(current => current?.decision.outcome || (current && snapshot.board.decisions.some(item => item.id === current.decision.id)) ? current : undefined);
      }
      return snapshot.board;
    } catch (failure) {
      setReady(false);
      setError(t("board.couldnTRefreshDataValue", { value: (failure as Error).message }));
    }
  }, [language]);

  useEffect(() => {
    alive.current = true;
    void Promise.resolve(config).then(value => {
      if (!alive.current) return;
      document.documentElement.lang = value.language;
      document.documentElement.classList.toggle('reduce-motion', value.reducedMotion === true);
    });
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!config) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 1000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [config, refresh]);
  useEffect(() => {
    if (!config?.launch.dumpLayout || !ready) return;
    const timer = setTimeout(() => {
      const frames = Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-decision-id]')].map(node => {
        const rect = node.getBoundingClientRect();
        return [node.dataset.decisionId!, [rect.left, rect.top, rect.width, rect.height]];
      }));
      void window.polaris.captureLayout(frames);
    }, 2000);
    return () => clearTimeout(timer);
  }, [config, ready]);
  useEffect(() => {
    if (!config || !ready || initialized.current) return;
    initialized.current = true;
    if (config.launch.goal) setGoalID(config.launch.goal);
    const id = config.launch.select;
    if (id) setTimeout(() => {
      const decision = board.decisions.find(item => item.id === id);
      if (!decision) return;
      if (config.launch.decide) void decide(decision, config.launch.decide, '');
      else setOpened({ decision, frame: frameFor(id) });
    }, 1000);
  }, [config, ready, board]);
  useEffect(() => {
    const names = ['tray', 'list.bullet', 'checkmark', 'xmark', 'chevron.right', 'arrow.up', 'minus'];
    void call('symbols', { symbols: names }).then(setSymbols).catch(() => {});
  }, []);
  useEffect(() => {
    const update = () => {
      const values = board.decisions.filter(item => pending(item) || !!item.outcome).flatMap(item => [item.createdAt, ...(item.outcome ? [item.outcome.decidedAt] : [])]);
      if (values.length) void call('relativeDates', { dates: values, language }).then(setDates).catch(() => {});
    };
    update(); const timer = setInterval(update, 30_000); return () => clearInterval(timer);
  }, [board.decisions, language]);
  useEffect(() => {
    if (!ready) return;
    if (!board.goals.length) setGuide('chat');
    else if (!guide) setGuide('done');
  }, [ready, guide, board.goals.length]);
  useEffect(() => { if (!arriving) return; const timer = setTimeout(() => setArriving(false), duration('--onboarding-board-delay') + duration('--layout')); return () => clearTimeout(timer); }, [arriving]);

  useEffect(() => { app.current?.querySelector<HTMLElement>('.goal-button[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [goalID]);

  function applyGoal(id: string) { setTargetGoal(undefined); if (id !== goalID) { setGoalID(id); setOpened(undefined); setRecordsID(undefined); } }
  // R-D169: switching goals fades the board out and brings the next one in from the direction of its place in the rail.
  function selectGoal(id: string) {
    if (view === 'library') { setTargetGoal(id); void switchView('board', () => applyGoal(id)); return; }
    if (id === (targetGoal ?? goalID)) { ++swapToken.current; swapIn(app.current?.querySelector('.board-pane > .board'), 'none'); return; }
    const order = (value: string) => board.goals.findIndex(item => item.id === value);
    const direction = Math.sign(order(id) - order(targetGoal ?? goalID)) || 1, shift = dimension('--motion-shift'), token = ++swapToken.current;
    setTargetGoal(id); boardShift.current = direction * shift;
    void swapOut(app.current?.querySelector('.board-pane > .board'), `translateY(${-direction * shift}px)`).then(() => { if (token === swapToken.current) applyGoal(id); });
  }
  async function switchView(next: 'board' | 'library', after?: () => void) {
    if (next === view) { after?.(); return; }
    const token = ++swapToken.current;
    if (next === 'library') { setLibraryMounted(true); setOpened(undefined); setRecordsID(undefined); }
    await swapOut(app.current?.querySelector(view === 'library' ? '.board-pane > .library' : '.board-pane > main:not(.library)'), 'none');
    if (token !== swapToken.current) return;
    boardShift.current = 0; setView(next); after?.();
  }
  async function openBoardDecision(id: string) {
    const current = await refresh(true);
    const decision = current?.decisions.find(item => item.id === id);
    if (!decision) return;
    const strategy = current?.strategies.find(item => item.id === decision.strategyID);
    setView('board');
    if (strategy) setGoalID(strategy.goalID);
    setTargetGoal(undefined);
    openDecision(decision);
  }
  function openDecision(decision: Decision) { setOpened({ decision: structuredClone(decision), frame: frameFor(decision.id) }); }
  async function decide(decision: Decision, optionID: string | undefined, note: string) {
    try {
      await call('decide', { decisionID: decision.id, expectedVersion: decision.version, optionID, note });
      await refresh(true);
      return true;
    } catch (failure) {
      const error = failure as Error & { messageKey?: string };
      setError(error.messageKey === "execution.inputMissing" ? t(error.messageKey) : t("board.couldnTSaveYourDecisionValueIf", { value: error.message }));
      await refresh(true); return false;
    }
  }
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (error) return;
      if (event.metaKey && /^[1-9]$/.test(event.key)) {
        const next = board.goals[Number(event.key) - 1];
        if (next) { event.preventDefault(); selectGoal(next.id); }
      }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  });

  const strategies = board.strategies.filter(item => item.goalID === goalID);
  const shownGoal = targetGoal ?? goalID;
  // R-D169: one black tile slides to the selected goal.
  useLayoutEffect(() => {
    const node = goalIndicator.current, target = goalList.current?.querySelector<HTMLElement>('.goal-button.selected');
    if (!node) return;
    if (!target) { node.classList.remove('visible'); return; }
    node.style.transition = node.classList.contains('visible') ? '' : 'none';
    node.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
    node.classList.add('visible');
  });
  const relative = (value: string) => dates[value] ?? '';
  const shortDate = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // Undecided until the first snapshot; a workspace that already has goals never shows the full-window Agent.
  const guiding = guide ? guide === 'chat' : !(ready && board.goals.length > 0);
  return <div ref={app} className={`app ${guiding ? 'guiding' : ''} ${arriving ? 'arriving' : ''}`} data-ready={ready}>
    {folding && <OnboardingSheet onDone={() => setFolding(false)} />}
    <div className="window-drag-region" />
    <nav className="goal-rail" aria-label={t('board.goals')} inert={guiding}><div className="goal-list" ref={goalList}>
      <span ref={goalIndicator} className="goal-indicator" aria-hidden="true" />
      {board.goals.map((item, index) => {
        const ids = strategyIDs(item.id);
        const count = board.decisions.filter(decision => ids.has(decision.strategyID) && pending(decision)).length;
        const current = (targetGoal ? true : view === 'board') && shownGoal === item.id;
        return <button key={item.id} className={`goal-button ${current ? 'selected' : ''}`} title={item.title}
          aria-label={count ? t("board.pendingDecisions", { title: item.title, count }) : item.title} aria-pressed={current}
          aria-keyshortcuts={index < 9 ? `Meta+${index + 1}` : undefined} onClick={() => selectGoal(item.id)}>
          <GoalIcon name={item.symbol} />
          {count > 0 && <GoalBadge count={count} />}
        </button>;
      })}</div>
      <button className={`goal-button library-button ${view === 'library' && !targetGoal ? 'selected' : ''}`} title={t('knowledge.library')} aria-label={t('knowledge.library')} aria-pressed={view === 'library' && !targetGoal}
        onClick={() => { setTargetGoal(undefined); void switchView('library'); }}><Library className="goal-symbol" size="1em" aria-hidden="true" focusable="false" /></button>
    </nav>
    <div className="board-pane" inert={guiding}>
    {libraryMounted && <KnowledgeLibrary hidden={view !== 'library'} />}
    {view === 'library' ? null : goal ? <main className="board" key={goal.id} inert={guiding} style={{ '--board-shift': `${boardShift.current}px` } as CSSProperties}>
      <header className="board-header"><h1>{goal.title}</h1><div className="milestone"><span>{goal.milestone}</span></div>
        {goal.constraints.trim() && <GoalConstraints text={goal.constraints} />}
      </header>
      {!strategies.length ? <div className="board-empty">{t('board.noStrategiesYet')}</div>
        : <div className="lanes">
          {strategies.map(strategy => <Lane key={strategy.id} strategy={strategy} decisions={board.decisions.filter(item => item.strategyID === strategy.id && pending(item))}
            onRecords={() => setRecordsID(strategy.id)} schedule={schedules.find(s => s.strategyID === strategy.id)} loop={loops[strategy.id]} openedID={opened?.decision.id} open={openDecision} relative={relative} t={t} symbols={symbols}
            date={value => shortDate.format(new Date(value))}
            onAdvance={async () => { try { await call('advanceStrategy', { strategyID: strategy.id }); await refresh(true); } catch (failure) { const error = failure as Error & { messageKey?: string }; setError(error.messageKey === 'loop.reviewRequired' ? t('loop.reviewRequired') : error.message); } }} />)}
        </div>}
    </main> : ready ? <main className="no-goals"><h1>{t("board.noGoalsYet")}</h1><p>{t("board.askYourAgentToAddAGoal")}</p></main> : <main className="no-goals" />}
    </div>
    {recordsID && !opened && <StrategyRecords strategyID={recordsID} onClose={() => setRecordsID(undefined)} onDecision={openDecision} />}
    {ready && <WorkAgentRail guiding={guiding} goalReady={board.goals.length > 0} onFirstGoal={showBoard}
      obscured={!!opened || !!recordsID || !!error} onDecision={openBoardDecision} />}
    {opened && <DecisionModal key={`${opened.decision.id}:${opened.decision.version}`} opened={opened} board={board} ready={ready} config={config}
      symbols={symbols} relative={relative} t={t} onClose={() => setOpened(current => current === opened ? undefined : current)} onDecide={decide} />}
    {error && <ErrorAlert message={error} title={t("board.couldnTSyncDecisions")} ok={t("board.ok")} close={() => setError('')} />}
  </div>;
}

function Symbol({ name, symbols }: { name: string; symbols: Record<string, string> }) {
  return <span aria-hidden="true" className={`symbol symbol-${name.replaceAll('.', '-')}`} style={symbols[name] ? { maskImage: `url("${symbols[name]}")` } : undefined} />;
}
function CardFace({ decision, relative }: { decision: Decision; relative: (date: string) => string; t: T }) {
  return <><strong className="card-title">{decision.title}</strong><span className="card-summary">{decisionPreview(decision.body)}</span><span className="card-meta">{relative(decision.createdAt)}</span></>;
}
/** R-D187: empty strategy lanes describe decisions. Task progress is in the Agent rail. */
function LaneState({ loop, t, symbols, date, onAdvance }: { loop?: LoopState; t: T; symbols: Record<string, string>; date: (value: string) => string; onAdvance: () => Promise<void> }) {
  const [starting, setStarting] = useState(false);
  const [title, detail] = loop?.state === 'needs_review' ? [t('execution.status.needs_review'), t('loop.reviewRequired')]
    : loop?.decisionPreparation === 'waiting_connection' ? [t('execution.status.waiting_connection'), undefined]
    : loop?.decisionPreparation === 'queued' ? [t('work.autoAdvance'), undefined]
    : loop?.decisionPreparation === 'running' ? [t('loop.preparingDecisions'), undefined]
    : loop?.state === 'scheduled' ? [t('board.nothingToDecide'), t('loop.nextRun', { date: date(loop.until!) })]
    : [t('board.nothingToDecide'), undefined];
  return <div className={`lane-empty ${loop ? `lane-loop-${loop.state}` : ''}`}><Symbol name="tray" symbols={symbols} />
    <strong className={loop?.decisionPreparation === 'running' && loop.state !== 'needs_review' ? 'agent-live-label' : undefined}>{title}</strong>{detail && <p>{detail}</p>}
    {(loop?.state === 'stalled' || loop?.state === 'scheduled') && <button className="secondary lane-advance" disabled={starting} onClick={() => { setStarting(true); void onAdvance().finally(() => setStarting(false)); }}>{t('loop.advance')}</button>}
  </div>;
}
function Lane({ strategy, decisions, schedule, onRecords, loop, openedID, open, relative, t, symbols, date, onAdvance }: {
  strategy: Strategy; decisions: Decision[]; schedule?: ScheduleSnapshot; onRecords: () => void; loop?: LoopState; openedID?: string;
  open: (decision: Decision) => void; relative: (date: string) => string; t: T; symbols: Record<string, string>;
  date: (value: string) => string; onAdvance: () => Promise<void>;
}) {
  const lane = useRef<HTMLElement>(null);
  // R-D169: cards glide into the space a decided card leaves; a newly submitted card rises in with a brief accent outline.
  useListMotion(lane, '.decision-card', node => {
    if (node.style.visibility === 'hidden') return;
    const root = getComputedStyle(document.documentElement), accent = root.getPropertyValue('--accent').trim(), border = root.getPropertyValue('--border').trim();
    node.animate([{ opacity: 0, transform: `translateY(${dimension('--motion-shift')}px)` }, { opacity: 1, transform: 'none' }], { duration: duration('--motion-list'), easing: easing('--ease-enter') });
    node.animate([{ borderColor: accent, boxShadow: `0 0 0 1px ${accent}` }, { borderColor: accent, boxShadow: `0 0 0 1px ${accent}`, offset: .55 }, { borderColor: border, boxShadow: `0 0 0 0 ${accent}00` }],
      { duration: duration('--motion-arrival'), easing: 'linear' });
  });
  return <section ref={lane} className="lane" aria-label={strategy.title}>
    <header className="lane-header"><div className="lane-title"><h2><button className="strategy-title-button" data-strategy-id={strategy.id} onClick={onRecords} title={t('strategy.records')}>{strategy.title}</button></h2>{decisions.length > 0 && <span>{decisions.length}</span>}{!!schedule?.tasks.length && <Clock3 size="1em" aria-label={t('schedule.title')} />}</div><p>{strategy.body}</p></header>
    {decisions.length ? <div className="lane-cards">
      {decisions.map(decision => <button key={decision.id} className="decision-card" data-decision-id={decision.id} data-motion-key={decision.id}
        style={{ visibility: openedID === decision.id ? 'hidden' : undefined }} onClick={() => open(decision)}><CardFace decision={decision} relative={relative} t={t} /></button>)}
    </div> : <LaneState loop={loop} t={t} symbols={symbols} date={date} onAdvance={onAdvance} />}
  </section>;
}


function focusTrap(event: KeyboardEvent, node: HTMLElement) {
  if (event.key !== 'Tab') return;
  const elements = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), a[href]')];
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first?.focus(); }
}

function DecisionModal({ opened, board, ready, config, symbols, relative, t, onClose, onDecide }: {
  opened: Opened; board: Board; ready: boolean; config?: Config; symbols: Record<string, string>;
  relative: (date: string) => string; t: T; onClose: () => void;
  onDecide: (decision: Decision, optionID: string | undefined, note: string) => Promise<boolean>;
}) {
  const decision = opened.decision;
  const freeform = decision.options.length === 0;
  const [choice, setChoice] = useState<string | undefined>(() => decision.options.some(item => item.id === config?.launch.choose) ? config?.launch.choose : undefined);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showsBody, setShowsBody] = useState(false);
  const shell = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const face = useRef<HTMLDivElement>(null);
  const phase = useRef<'opening' | 'open' | 'saving' | 'closing'>('opening');
  const mounted = useRef(true);
  const bodyFrame = useRef(0);
  const openedAt = useRef(0);
  const size = useViewport();
  const margin = dimension('--modal-margin') * 2;
  const width = Math.min(dimension('--modal-width'), size.width - margin), height = Math.min(dimension('--modal-height'), size.height - margin);
  const target: Rect = { left: (size.width - width) / 2, top: (size.height - height) / 2, width, height };
  const reduced = config?.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const available = pending(decision);
  const canSave = ready && !saving && available && (!!choice || !!note.trim());
  const strategy = board.strategies.find(item => item.id === decision.strategyID);
  const geometry = `${target.left}:${target.top}:${width}:${height}`;
  const previousGeometry = useRef(geometry);

  function transform(rect: Rect) {
    return `translate3d(${rect.left - target.left}px, ${rect.top - target.top}px, 0) scale(${rect.width / width}, ${rect.height / height})`;
  }
  function cancel(element: HTMLElement | null) { element?.getAnimations().forEach(animation => animation.cancel()); }
  function sourceFace(measured?: Rect) {
    const source = document.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(decision.id)}"]`);
    const frame = measured ?? frameFor(decision.id);
    if (!source || !frame || !face.current) return;
    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-decision-id');
    clone.tabIndex = -1;
    Object.assign(clone.style, { visibility: 'visible', opacity: '1', scale: '1', transform: 'none', transition: 'none', animation: 'none', width: '100%', height: '100%', pointerEvents: 'none', background: 'transparent', borderColor: 'transparent', boxShadow: 'none', outline: 'none' });
    face.current.replaceChildren(clone);
    Object.assign(face.current.style, cssRect(frame));
    return frame;
  }

  useLayoutEffect(() => {
    mounted.current = true;
    openedAt.current = performance.now();
    const origin = !reduced ? sourceFace(opened.frame) : undefined;
    const time = duration(origin && !reduced ? '--expand' : '--state');
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--spring').trim();
    const animation = shell.current?.animate(origin && !reduced
      ? [{ transform: transform(origin) }, { transform: 'none' }]
      : [{ opacity: 0 }, { opacity: 1 }], { duration: time, easing });
    shadow.current?.animate(origin && !reduced
      ? [{ transform: transform(origin), opacity: 0 }, { transform: 'none', opacity: 1 }]
      : [{ opacity: 0 }, { opacity: 1 }], { duration: time, easing });
    if (animation) animation.onfinish = () => { if (phase.current === 'opening') phase.current = 'open'; };
    scrim.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration('--state') });
    if (origin) {
      face.current?.animate([{ transform: 'none' }, { transform: `translate3d(${target.left - origin.left}px, ${target.top - origin.top}px, 0)` }], { duration: time, easing, fill: 'both' });
      face.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration('--card-fade'), fill: 'both' });
    }
    // Paint the lightweight moving surface before laying out the Markdown reading area.
    bodyFrame.current = requestAnimationFrame(() => {
      bodyFrame.current = requestAnimationFrame(() => { if (phase.current !== 'closing') setShowsBody(true); });
    });
    content.current?.focus({ preventScroll: true });
    return () => {
      mounted.current = false;
      cancelAnimationFrame(bodyFrame.current);
      for (const element of [shell.current, shadow.current, content.current, scrim.current, face.current]) cancel(element);
    };
  }, []);

  useLayoutEffect(() => {
    if (!showsBody || phase.current === 'closing') return;
    content.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration('--reveal'),
      delay: reduced ? 0 : Math.max(0, duration('--reveal-delay') - (performance.now() - openedAt.current)), fill: 'backwards' });
  }, [showsBody]);

  useLayoutEffect(() => {
    if (previousGeometry.current === geometry) return;
    previousGeometry.current = geometry;
    if (phase.current === 'closing') { onClose(); return; }
    for (const element of [shell.current, shadow.current, content.current, scrim.current, face.current]) cancel(element);
    if (face.current) face.current.style.opacity = '0';
    if (phase.current !== 'saving') phase.current = 'open';
  }, [geometry]);

  async function close(mode: 'card' | 'fade' = 'card') {
    if (phase.current === 'closing' || phase.current === 'saving') return;
    phase.current = 'closing';
    cancelAnimationFrame(bodyFrame.current);
    setClosing(true);
    const currentTransform = shell.current ? getComputedStyle(shell.current).transform : 'none';
    const currentBox = shell.current?.getBoundingClientRect();
    const opacity = (element: HTMLElement | null) => element ? getComputedStyle(element).opacity : '0';
    const shellOpacity = opacity(shell.current), contentOpacity = opacity(content.current), scrimOpacity = opacity(scrim.current);
    const faceOpacity = +opacity(face.current), shadowOpacity = opacity(shadow.current);
    for (const element of [shell.current, shadow.current, content.current, scrim.current, face.current]) cancel(element);
    const destination = mode === 'card' && !reduced ? sourceFace() : undefined;
    const time = duration(destination ? '--collapse' : '--state');
    const easing = getComputedStyle(document.documentElement).getPropertyValue('--collapse-curve').trim();
    const crossfade = duration('--card-fade');
    content.current?.animate([{ opacity: contentOpacity }, { opacity: 0 }], { duration: crossfade, fill: 'forwards' });
    scrim.current?.animate([{ opacity: scrimOpacity }, { opacity: 0 }], { duration: duration('--state'), fill: 'forwards' });
    const animation = shell.current?.animate([
      { transform: currentTransform, opacity: shellOpacity },
      { transform: destination ? transform(destination) : currentTransform, opacity: destination ? 1 : 0 },
    ], { duration: time, fill: 'forwards', easing });
    shadow.current?.animate([{ transform: currentTransform, opacity: shadowOpacity },
      { transform: destination ? transform(destination) : currentTransform, opacity: 0 }], { duration: time, fill: 'forwards', easing });
    if (destination && currentBox) {
      face.current?.animate([{ transform: `translate3d(${currentBox.left - destination.left}px, ${currentBox.top - destination.top}px, 0)` }, { transform: 'none' }], { duration: time, easing, fill: 'both' });
      // Crossfade together: delaying the card until the end leaves a blank surface mid-close.
      face.current?.animate([{ opacity: faceOpacity }, { opacity: 1 }], { duration: crossfade, fill: 'both' });
    }
    await animation?.finished.catch(() => {});
    if (!mounted.current) return;
    onClose();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-decision-id="${CSS.escape(decision.id)}"]`)?.focus({ preventScroll: true }));
  }
  function choose(id: string) { setChoice(id); setNote(''); content.current?.focus({ preventScroll: true }); }
  async function save() {
    if (!canSave || phase.current === 'closing' || phase.current === 'saving') return;
    phase.current = 'saving';
    setSaving(true);
    const saved = await onDecide(decision, choice, note);
    if (!mounted.current) return;
    setSaving(false);
    phase.current = 'open';
    if (saved) await close('fade');
  }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    focusTrap(event, event.currentTarget);
    if (event.key === 'Escape') { event.stopPropagation(); void close(); }
    if (event.metaKey && event.key === 'Enter') { event.preventDefault(); void save(); }
    if (phase.current === 'closing') return;
    const input = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
    if (available && !input && !event.metaKey && !event.ctrlKey && /^[1-9]$/.test(event.key)) {
      const option = decision.options[Number(event.key) - 1];
      if (option) { event.preventDefault(); choose(option.id); }
    }
  }
  return <div className="modal-layer">
    <div className="modal-scrim" ref={scrim} onClick={() => void close()} />
    <div className="modal-shadow" ref={shadow} style={target} aria-hidden="true" />
    <div ref={face} className="modal-card-face" aria-hidden="true" />
    <div className="modal-shell" ref={shell} style={target}>
      <div ref={content} className="modal-content" style={{ width, height }} role="dialog" aria-modal="true" aria-labelledby="decision-title" tabIndex={-1} onKeyDown={key}>
        {showsBody && <><article className="decision-reading"><div className="reading-inner">
          {strategy && <p className="decision-strategy">{strategy.title}</p>}
          <h1 id="decision-title">{decision.title}</h1><p className="decision-meta">{relative(decision.createdAt)}</p>
          <Markdown source={decision.body} />
          {decision.excerpt !== undefined && <div className="decision-excerpt"><Markdown source={decision.excerpt} /></div>}
        </div></article>
        <section className="decision-controls"><div className="modal-close-row"><button className="icon-button" title={t("board.closeEsc")} aria-label={t("common.close")} onClick={() => void close()}><Symbol name="xmark" symbols={symbols} /></button></div>
          <div className="decision-scroll">{!freeform && <div className="options">
            {decision.options.map((option, index) => {
              const selected = decision.outcome ? decision.outcome.optionID === option.id : choice === option.id;
              return <button key={option.id} className={`option ${selected ? 'selected' : ''}`} disabled={!available || saving || closing} aria-pressed={selected}
                title={available ? t("board.chooseOptionByNumber", { number: index + 1 }) : undefined} onClick={() => choose(option.id)}>
                {available && <span className="option-number">{index + 1}</span>}
                <span className="option-content"><span className="option-title"><Markdown source={option.label} inline links={false} />{option.id === decision.recommendedOptionID && <span className="recommendation">{t("board.recommended")}</span>}</span>
                  {option.detail !== undefined && <Markdown source={option.detail} links={false} className="option-detail" />}</span>
                <span className="option-check" style={{ opacity: selected ? 1 : 0 }}><Symbol name="checkmark" symbols={symbols} /></span>
              </button>;
            })}
          </div>}
          {decision.outcome ? decision.outcome.note && <section className="saved-note"><h2>{t("board.yourAnswer")}</h2><Markdown source={decision.outcome.note} /></section>
            : <>{!freeform && <div className="alternative" aria-label={t("board.orWriteYourOwnDecision")}><span />{t("board.or")}<span /></div>}
              <textarea className="custom-decision" aria-label={t("board.yourAnswer")} placeholder={t(freeform ? "board.yourAnswer" : "board.writeYourOwnDecision")} value={note} rows={3} disabled={saving || closing}
                onChange={event => { setNote(event.target.value); if (event.target.value.length) setChoice(undefined); }} /></>}
          </div>
          {available && <div className="decision-executor"><p>{t('execution.confirmationHelp')}</p></div>}
          <footer className="decision-footer">{decision.outcome ? <span className="outcome-status">{t("board.decidedValueHistorical", { value: relative(decision.outcome.decidedAt) })}</span>
            : <button className="primary confirm" disabled={!canSave || closing} onClick={() => void save()}>{t('board.decide')}<span>⌘↩</span></button>}
          </footer>
        </section></>}
      </div>
    </div>
  </div>;
}



function GoalBadge({ count }: { count: number }) {
  const badge = useRef<HTMLSpanElement>(null), previous = useRef(count);
  // R-D169: a rising count bumps once so a new card is noticed from any goal.
  useLayoutEffect(() => {
    if (count > previous.current && !reducedMotion()) badge.current?.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: duration('--motion-bump'), easing: easing('--spring') });
    previous.current = count;
  }, [count]);
  return <span ref={badge} className="goal-badge">{count}</span>;
}

/** R-D169: when the first goal opens the board, the full-window sheet folds into the main Agent entry. */
function OnboardingSheet({ onDone }: { onDone: () => void }) {
  const sheet = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = sheet.current, entry = document.querySelector<HTMLElement>('.main-agent-entry');
    if (!node) return;
    let alive = true;
    const finish = () => {
      if (!alive) return;
      onDone();
      if (entry && !reducedMotion()) entry.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)' }, { transform: 'scale(1)' }], { duration: duration('--motion-bump'), easing: easing('--spring') });
    };
    const rect = entry?.getBoundingClientRect();
    const animation = !rect?.width || reducedMotion()
      ? node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration('--motion-exit'), easing: easing('--ease-exit'), fill: 'forwards' })
      : node.animate([
        { transform: 'none', opacity: 1 }, { opacity: 1, offset: .7 },
        { transform: `translate(${rect.left}px, ${rect.top}px) scale(${rect.width / innerWidth}, ${rect.height / innerHeight})`, opacity: 0 },
      ], { duration: duration('--expand'), easing: easing('--collapse-curve'), fill: 'forwards' });
    animation.finished.then(finish, () => {});
    return () => { alive = false; animation.cancel(); };
  }, []);
  return <div ref={sheet} className="onboarding-sheet" aria-hidden="true" />;
}

function ErrorAlert({ title, message, ok, close }: { title: string; message: string; ok: string; close: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { button.current?.focus(); }, []);
  return <div className="error-layer"><div className="modal-scrim" /><section className="error-alert" role="alertdialog" aria-modal="true" aria-labelledby="error-title" onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Enter') { event.stopPropagation(); close(); }
    focusTrap(event, event.currentTarget);
  }}><h2 id="error-title">{title}</h2><p>{message}</p><button className="primary" ref={button} onClick={close}>{ok}</button></section></div>;
}
