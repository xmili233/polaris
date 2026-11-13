import type { NativeRequest } from '../service/desktop-contract';
import { createContext, Fragment, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ActionBarPrimitive, useAuiState, AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import { call, type AgentMessage, type AgentSnapshot, type AgentAttachment } from './types';
import { translator, type MessageKey } from './i18n';
import { AgentAvatar, mainAgentAvatarID } from './AgentAvatar';
import { duration } from './theme';
import { AgentModelSelector } from './AgentModelSelector';
import { AgentToolIcon } from './AgentToolIcon';
import { StreamingMarkdown } from './StreamingMarkdown';
import { activityIndicator, toolDuration, toolGroupIcons, toolGroupSummary, toolIconName, toolKind, toolLabel, toolState } from './agent-activity';
import type { ProviderID } from '../service/agent-store';
import { onboardingTurnIdle, projectTurn, workLabel } from './agent-turn';
import { openSettings } from './Settings';
import { backgroundAgentLimit, onboardingProviders } from '../service/agents/types';
import { reducedMotion, easing } from './motion';

type T = ReturnType<typeof translator>;
const empty: AgentSnapshot = { messages: [], jobs: [], artifacts: [], revision: 0 };
export const errorKeys: Record<string, MessageKey> = {
  execution_received: "errors.decisionChanged", work_permission: "work.permissionBlocked",
  model_selection: "agent.modelSelectionFailed", native_models: "agent.modelOptionsChanged",
  attachment_limit: "agent.attachUpTo10FilesUpTo", attachment_file: "agent.unableToReadTheAttachmentPleaseChoose",
  attachment_command: "agent.sendAttachmentsWithAMessageNotA",
  agent_connection: "agent.connectionFailedCheckYourNetworkAndRetry",
  agent_models: "agent.noModelsAvailableRefreshTheConnection", agent_failed: "agent.theReplyCouldNotBeCompletedPlease",
  native_missing: "agent.installThisPlatformSNativeAgentFirst", native_version: "agent.thisNativeAgentVersionIsNotSupported", native_auth: "agent.signInThroughTheNativeAgentThen",
  native_protocol: "agent.theNativeAgentProtocolConnectionFailedUpdate", native_disconnected: "agent.theNativeAgentDisconnectedCheckItsSession", native_failed: "agent.theNativeAgentDidNotFinishReview", native_resume: "agent.thisNativeSessionCouldNotBeResumed",
  native_delivery_unknown: "agent.theLastTaskMayHaveAlreadyRun", native_command: "agent.thisAgentDoesNotProvideThatCommand", native_timeout: "agent.theNativeAgentConnectionTimedOut", native_incomplete: "agent.theNativeAgentEndedThisTurnBefore",
};
const ConversationContext = createContext<{ snapshot: AgentSnapshot; connected: boolean; t: T; onDecision?: (id: string) => void; onRetry: (id: string) => Promise<void> } | null>(null);
type IconName = 'check' | 'retry' | 'arrow' | 'stop' | 'chevron' | 'error' | 'loader' | 'compose' | 'compact' | 'plus' | 'file' | 'remove';
function AgentIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6" /></>,
    remove: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    retry: <><path d="M3 10a9 9 0 0 1 15-6l3 3M21 3v4h-4M21 14A9 9 0 0 1 6 20l-3-3M3 21v-4h4" /></>,
    arrow: <path d="M12 19V5m-7 7 7-7 7 7" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    error: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3h.01" /></>,
    loader: <path d="M12 3a9 9 0 1 1-9 9" />,
    compose: <><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /><path d="m17.5 3.5 3 3L13 14h-3v-3l7.5-7.5Z" /></>,
    compact: <><path d="M5 4v13a3 3 0 0 0 3 3h3M19 20V7a3 3 0 0 0-3-3h-3M9 8h6M9 12h6M9 16h6" /></>,
  };
  return <svg className={`agent-icon ${name === 'loader' ? 'agent-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
// R-D61: no per-message actions; text stays selectable for ⌘C, and hovering never changes layout.
function UserMessage() {
  const id = useAuiState(s => s.message.id);
  const { snapshot, t } = useContext(ConversationContext)!;
  const message = snapshot.messages.find(item => item.id === id);
  const isCommand = useAuiState(s => s.message.content.length === 1 && s.message.content[0].type === 'text' && ['/compact', '/compress'].includes(s.message.content[0].text.trim()));
  if (isCommand) return null;
  return <MessagePrimitive.Root className="agent-user-message">
    {!!message?.attachments?.length && <div className="agent-attachments">{message.attachments.map(file => <span className="agent-attachment" key={file.id} title={file.name}><AgentIcon name="file" /><span>{file.name}</span></span>)}</div>}
    {(!message || message.body) && <div className="agent-message"><MessagePrimitive.Content /></div>}
    {message?.inputKind === 'steer' && <span className="agent-status" role="status">{t(message.state === 'accepted' ? 'agent.inputAccepted' : message.state === 'unknown' ? 'agent.inputUnknown' : 'agent.inputSending')}</span>}
  </MessagePrimitive.Root>;
}
type ToolCall = Extract<NonNullable<AgentMessage['parts']>[number], { type: 'activity' }>['calls'][number];
type ActivityMode = ReturnType<typeof activityIndicator>['kind'];
const toolStates: Record<string, string> = { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Stopped', interrupted: 'Interrupted' };
function ToolDisclosure() {
  return <span className="agent-tool-disclosure"><svg className="agent-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M7.52925 3.7793C7.75652 3.55203 8.10803 3.52383 8.36616 3.69434L8.47065 3.7793L14.2207 9.5293C14.4804 9.789 14.4804 10.211 14.2207 10.4707L8.47065 16.2207C8.21095 16.4804 7.78895 16.4804 7.52925 16.2207C7.26955 15.961 7.26955 15.539 7.52925 15.2793L12.8085 10L7.52925 4.7207L7.44429 4.61621C7.27378 4.35808 7.30198 4.00657 7.52925 3.7793Z" /></svg></span>;
}
function ToolEntry({ call, active, stopped, single = false, mode = 'none' }: { call: ToolCall; active: boolean; stopped: boolean; single?: boolean; mode?: ActivityMode }) {
  const details = useRef<HTMLDetailsElement>(null);
  const state = toolState(call, active, stopped), kind = toolKind(call), label = toolLabel(call, mode === 'exploring' ? 'running' : state);
  const status = toolStates[state] ?? state;
  const pending = mode === 'thinking' || mode === 'exploring' || state === 'running';
  useEffect(() => { if (!pending) details.current?.removeAttribute('open'); }, [pending]);
  return <details ref={details} className={`agent-tool${single ? ' agent-activity' : ''}`} data-state={pending ? 'running' : state} data-tool-name={call.name} data-kind={kind}>
    <summary title={[label.label, label.target].filter(Boolean).join(' ')}>
      <span className="agent-tool-heading">
        {mode !== 'thinking' && <span className="agent-tool-icons"><AgentToolIcon name={toolIconName(call)} /></span>}
        <span className={`agent-tool-label${pending ? ' agent-live-label' : ''}`}>
          {mode === 'thinking' ? 'Thinking' : <>{label.label}{label.target && <> <span className={kind === 'command' || kind === 'edit' || call.name === 'read_file' ? 'agent-tool-target' : ''}>{label.target}</span></>}</>}
        </span>
        {['failed', 'cancelled', 'interrupted'].includes(state) && <span className="agent-tool-state">{status}</span>}
      </span>
      <ToolDisclosure />
      <span className="agent-sr-only">{status}</span>
    </summary>
    <div className="agent-tool-detail">
      <div className="agent-tool-meta"><code>{call.name}</code><span>{status}{toolDuration(call) && ` · ${toolDuration(call)}${call.timeSource === 'received' ? ' observed' : ''}`}</span></div>
      {call.input && <section><h4>Input</h4><pre>{call.input}</pre></section>}
      {call.output && <section><h4>Output</h4><pre>{call.output}</pre></section>}
      {!call.input && !call.output && call.nativeDetails && <section><h4>Details</h4><pre>{call.nativeDetails}</pre></section>}
      {call.error && <p className="agent-tool-error">{call.error.message}</p>}
    </div>
  </details>;
}
export function ToolActivity({ calls, active, stopped, mode }: { calls: ToolCall[]; active: boolean; stopped: boolean; mode: ActivityMode }) {
  const [expanded, setExpanded] = useState(true);
  const live = [...calls].reverse().find(call => toolState(call, active, stopped) === 'running');
  const pending = !!live || mode === 'thinking' || mode === 'exploring';
  const state = pending ? 'running' : calls.some(call => call.state === 'failed') ? 'failed'
    : calls.some(call => ['cancelled', 'interrupted'].includes(toolState(call, active, stopped))) ? 'cancelled' : 'completed';
  if (!calls.length) return null;
  if (calls.length === 1) return <ToolEntry call={calls[0]} active={active} stopped={stopped} mode={mode} single />;
  const currentCall = live ?? (mode === 'exploring' ? calls.at(-1) : undefined);
  const current = currentCall && toolLabel(currentCall, 'running');
  const label = mode === 'thinking' ? 'Thinking' : current ? `${current.label} ${current.target}`.trim() : toolGroupSummary(calls);
  const icons = mode === 'thinking' ? [] : currentCall ? [toolIconName(currentCall)] : toolGroupIcons(calls);
  return <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)} className="agent-activity agent-tool-group" data-state={state}>
    <summary title={label} aria-label={label}>
      <span className="agent-tool-heading">
        {icons.length > 0 && <span className="agent-tool-icons">{icons.map(name => <AgentToolIcon key={name} name={name} />)}</span>}
        <span className={`agent-tool-label${pending ? ' agent-live-label' : ''}`}>{label}</span>
        {state === 'failed' && <span className="agent-tool-state">Failed</span>}
      </span>
      <ToolDisclosure />
    </summary>
    <div className="agent-tool-list" role="region" aria-label="Tool calls">
      {calls.map(call => <ToolEntry key={call.id} call={call} active={active} stopped={stopped} />)}
    </div>
  </details>;
}
function WorkLabel({ turn }: { turn: ReturnType<typeof projectTurn> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (turn.status !== 'working') return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [turn.status]);
  return <span>{workLabel(turn.status, turn.timing?.start, turn.timing?.end, now)}</span>;
}
function AssistantMessage() {
  const { snapshot, connected, t, onDecision, onRetry } = useContext(ConversationContext)!;
  const id = useAuiState(s => s.message.id);
  const message = snapshot.messages.find(item => item.id === id);
  const job = snapshot.jobs.find(item => `${item.id}:assistant` === id);
  const turn = projectTurn(message, job);
  const queued = job?.state === 'queued';
  const prerequisites = job ? snapshot.waitingFor?.[job.id] : undefined;
  const active = turn.active && !queued;
  const answerInProcess = !!snapshot.work && !!turn.answer && !!snapshot.decisionCards?.some(card => card.jobID === job?.id);
  const process = answerInProcess ? [...turn.process, turn.answer!] : turn.process;
  const hasProcess = process.length > 0, canCollapse = turn.canCollapse || answerInProcess;
  const indicator = activityIndicator(message, active);
  const [manuallyCollapsed, setManuallyCollapsed] = useState<boolean>();
  const [retrying, setRetrying] = useState(false);
  const collapsed = canCollapse && (manuallyCollapsed ?? true);
  // A new attempt replaces this message; do not carry its previous disclosure choice across retries.
  useEffect(() => setManuallyCollapsed(undefined), [job?.startedAt]);
  // Waiting for a connection is a normal state: one quiet line, and none while the connect card already says so.
  const waiting = job?.state === 'waiting_connection' && !job.error;
  const failed = !!job && (job.state === 'failed' || job.state === 'needs_review' || (job.state === 'waiting_connection' && !!job.error));
  const retryable = job?.delivery !== 'unknown' && job?.delivery !== 'accepted' && job?.delivery !== 'sent' && job?.id === snapshot.jobs.find(item => item.kind === job?.kind && item.workID === job?.workID)?.id;
  const compact = job?.input === '/compact' || job?.input === '/compress';
  const compactLabel = job?.state === 'running' ? 'Compacting context…' : job?.state === 'queued' ? 'Compaction queued'
    : job?.state === 'completed' ? message?.body || 'Context compacted' : job?.state === 'cancelled' ? 'Compaction stopped'
    : waiting ? 'Connect to compact context' : 'Context compaction failed';
  return <MessagePrimitive.Root className="agent-answer" data-job-id={job?.id} aria-busy={active}>
    {compact && <div className="agent-compaction" role="status"><AgentIcon name="compact" /><span className={active ? 'agent-live-label' : ''}>{compactLabel}</span></div>}
    {!compact && hasProcess && <details className="agent-turn" open={!collapsed}>
      <summary aria-expanded={canCollapse ? !collapsed : undefined} aria-disabled={!canCollapse} tabIndex={canCollapse ? 0 : -1}
        onClick={event => { event.preventDefault(); if (canCollapse) setManuallyCollapsed(!collapsed); }}>
        <WorkLabel turn={turn} />{canCollapse && <ToolDisclosure />}
      </summary>
      <div className="agent-turn-process">
        {process.map((part, index) => <Fragment key={part.type === 'text' ? part.id ?? index : index}>
          {part.type === 'text' ? <StreamingMarkdown source={part.text} streaming={active && part.complete !== true} smooth={part.phase !== 'commentary'} />
            : <ToolActivity calls={part.calls} active={active} stopped={job?.state === 'cancelled'} mode={indicator.index === index ? indicator.kind : 'none'} />}
        </Fragment>)}
      </div>
    </details>}
    {!compact && !answerInProcess && turn.answer && <div className="agent-final-answer"><StreamingMarkdown source={turn.answer.text} streaming={active && turn.answer.complete !== true} /></div>}
    {!compact && queued && <p className="agent-status agent-awaiting" role="status">{prerequisites && !prerequisites.ready ? t('execution.status.waiting_input') : job.kind === 'work' ? t('agent.backgroundQueued', { limit: backgroundAgentLimit }) : t('agent.queued')}</p>}
    {!compact && indicator.kind === 'thinking' && indicator.index < 0 && <p className="agent-status agent-awaiting agent-live-label" role="status">Thinking</p>}
    {waiting && connected && <p className="agent-status">{t("agent.waitingForConnection")}</p>}
    {failed && <div className="agent-recovery"><AgentIcon name="error" /><p role="alert">{t(errorKeys[job.error] ?? "agent.theReplyCouldNotBeCompletedPlease")}</p>
      {snapshot.work && job.id === snapshot.retryJobID ? <button className="agent-text-button" disabled={retrying} onClick={async () => {
        setRetrying(true); try { await onRetry(job.id); } finally { setRetrying(false); }
      }}>{t('common.retry')}</button>
        : retryable && !snapshot.work ? <ActionBarPrimitive.Root><ActionBarPrimitive.Reload className="agent-action" aria-label={t("common.retry")} title={t("common.retry")}><AgentIcon name="retry" /></ActionBarPrimitive.Reload></ActionBarPrimitive.Root>
        : !snapshot.work && <span>{t("agent.newerMessagesExistContinueInTheCurrent")}</span>}
    </div>}
    {!compact && job?.state === 'cancelled' && <p className="agent-status">{t("agent.stopped")}</p>}
    {onDecision && !snapshot.work && snapshot.decisionCards?.filter(card => card.jobID === job?.id).map(card =>
      <p key={card.id} className="agent-work-decision"><button title={t('work.viewDecision')} onClick={() => onDecision(card.id)}>{card.title}</button></p>)}
  </MessagePrimitive.Root>;
}

export function AgentComposer({ t, fullWindow = false, goalReady = false, onFirstGoal, workID, workSessionKey, onClose, onDecision, open = true, onNotice, latestReplyID }: {
  latestReplyID?: string; open?: boolean; onNotice?: (unread: boolean) => void;
  t: T; fullWindow?: boolean; goalReady?: boolean; onFirstGoal?: () => void; workID?: string;
  workSessionKey?: string; onClose?: () => void; onDecision?: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState(empty);
  const native = snapshot.native;
  const connection = native?.connections.find(item => item.provider === native.selected);
  const connected = connection?.connected ?? false;
  // R-D87: one sentence for why the selected platform cannot run; settings hold the fix.
  const offlineSentence = !connection ? "agent.valueIsNotConnected" : !connection.installed ? "agent.valueIsNotInstalled" : !connection.compatible ? "agent.valueNeedsAnUpdate" : connection.authenticated === false ? "agent.valueIsSignedOut" : "agent.valueIsNotConnected";
  const [error, setError] = useState('');
  const [draftText, setDraftText] = useState('');
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [picking, setPicking] = useState(false), [sending, setSending] = useState(false);
  const sendingRef = useRef(false), modelChangingRef = useRef(false);
  const [modelChanging, setModelChanging] = useState(false);
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const root = useRef<HTMLElement>(null);
  const composer = useRef<{ setText: (text: string) => void }>(null);
  const pendingSend = useRef<{ id: string; text: string; files: string } | null>(null);
  const [seenReply, setSeenReply] = useState<string | null>(null);
  const readSnapshot = () => workID ? call('agentWorkSnapshot', { workID, taskID: workSessionKey }) : call('agentSnapshot');
  // The full-window conversation leaves room for the current composer height.
  useEffect(() => {
    const input = root.current?.querySelector<HTMLElement>('.agent-input');
    if (!input) return;
    const observer = new ResizeObserver(([entry]) => root.current?.style.setProperty('--agent-input-h', `${entry.borderBoxSize[0].blockSize}px`));
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open) return;
    let alive = true, updateTimer: ReturnType<typeof setTimeout> | undefined, loading = false, dirty = false;
    const schedule = () => { updateTimer ??= setTimeout(() => { updateTimer = undefined; void refresh(); }, 16); };
    const refresh = async () => {
      if (loading) { dirty = true; return; }
      loading = true;
      try { const value = await readSnapshot(); if (alive) setSnapshot(value); }
      catch { if (alive) setError('agent_connection'); }
      finally { loading = false; if (alive && dirty) { dirty = false; schedule(); } }
    };
    refresh();
    const stop = window.polaris.onAgent(schedule);
    const poll = setInterval(refresh, 5000);
    return () => { alive = false; stop(); clearInterval(poll); clearTimeout(updateTimer); };
  }, [open, workID, workSessionKey]);
  async function nativeAction(params: NativeRequest<'newSession' | 'permission'>) {
    setError('');
    try {
      const value = await call('agentNative', params);
      setSnapshot(current => ({ ...current, native: value }));
    } catch (failure) { setError((failure as { code?: string }).code || 'native_protocol'); }
  }
  async function jobAction(method: 'agentRetry' | 'agentCancel', id: string) {
    try { await (workID && method === 'agentCancel' ? call('agentWorkStop', { workID, id }) : call(method, { id })); setSnapshot(await readSnapshot()); setError(''); }
    catch { setError('agent_failed'); }
  }
  async function sendText(text: string) {
    if (workID || modelChangingRef.current || snapshot.canSend === false || (!text.trim() && !attachments.length) || sendingRef.current || picking) return;
    const files = JSON.stringify(attachments.map(file => file.id));
    const request = pendingSend.current?.text === text && pendingSend.current.files === files ? pendingSend.current : { id: crypto.randomUUID(), text, files };
    pendingSend.current = request;
    sendingRef.current = true; setSending(true);
    try {
      await call('agentSend', { text, requestID: request.id, attachments: JSON.parse(files) });
      pendingSend.current = null; setAttachments([]); composer.current?.setText(''); setDraftText('');
    }
    catch (failure) { setError((failure as { messageKey?: string }).messageKey ?? (failure as { code?: string }).code ?? 'agent_failed'); composer.current?.setText(text); setDraftText(text); try { setSnapshot(await readSnapshot()); } catch {} return; }
    finally { sendingRef.current = false; setSending(false); }
    try { setSnapshot(await readSnapshot()); setError(''); }
    catch { setError('agent_connection'); }
  }
  async function chooseModel(provider: ProviderID, model: string, settings: import('../service/agents/types').ModelSettings) {
    if (modelChangingRef.current || sendingRef.current) return;
    modelChangingRef.current = true; setModelChanging(true); setError('');
    try {
      setSnapshot(await call('agentNative', { action: 'chooseModel', provider, model, settings, taskID: snapshot.sessionKey }));
    } catch (failure) { setError((failure as { code?: string }).code === 'native_models' ? 'native_models' : 'model_selection'); }
    finally { modelChangingRef.current = false; setModelChanging(false); }
  }
  async function pickAttachments() {
    setPicking(true); setError('');
    try {
      const response = await window.polaris.pickAttachments();
      if (response.error) throw response.error;
      const files = response.result ?? [];
      if (attachments.length + files.length > 10) {
        await call('agentAttachmentDiscard', { ids: files.map(file => file.id) });
        throw { code: 'attachment_limit' };
      }
      setAttachments(current => [...current, ...files]);
    } catch (failure) { setError((failure as { code?: string }).code ?? 'attachment_file'); }
    finally { setPicking(false); }
  }
  async function removeAttachment(id: string) {
    try { await call('agentAttachmentDiscard', { ids: [id] }); setAttachments(current => current.filter(file => file.id !== id)); }
    catch { setError('attachment_file'); }
  }
  const commands = connection?.capabilities.nativeCommands ?? [];
  const matchingCommands = commands.filter(command => `/${command.name}`.startsWith(draftText));
  const activeCommandIndex = Math.min(commandIndex, Math.max(0, matchingCommands.length - 1));
  const activeCommand = matchingCommands[activeCommandIndex];
  function compactContext(name = activeCommand?.name ?? 'compact') {
    composer.current?.setText(''); setDraftText(''); setCommandDismissed(false);
    void sendText(`/${name}`);
  }
  const commandMenuID = useId();
  const showCommand = !attachments.length && !commandDismissed && draftText.startsWith('/') && matchingCommands.length > 0;
  useEffect(() => {
    if (!showCommand) return;
    const menu = root.current?.querySelector<HTMLElement>('.agent-command-menu');
    const item = menu?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!menu || !item) return;
    if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
  }, [showCommand, activeCommandIndex]);
  const inConversation = (job: AgentSnapshot['jobs'][number]) => workID ? job.workID === workID : job.kind === 'main';
  const running = snapshot.jobs.find(job => inConversation(job) && (job.state === 'running' || native?.activeJobIDs.includes(job.id)))
    ?? snapshot.jobs.filter(job => inConversation(job) && job.state === 'queued').at(-1);
  const runtime = useExternalStoreRuntime({
    messages: snapshot.messages.flatMap(message => {
      if (message.role !== 'user' || message.jobID || !snapshot.jobs.some(job => message.id === `${job.id}:user`)) return [message];
      const id = message.id.replace(/:user$/, ':assistant');
      return snapshot.messages.some(item => item.id === id) ? [message] : [message, { ...message, id, role: 'assistant' as const, body: '', parts: [] }];
    }),
    convertMessage: message => ({ id: message.id, role: message.role, content: [{ type: 'text', text: message.body }], createdAt: new Date(message.createdAt) }),
    isRunning: !!running,
    onNew: async message => {
      const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n');
      await sendText(text);
    },
    onReload: async parentID => {
      const id = parentID?.replace(/:user$/, '');
      if (id && !workID) await jobAction('agentRetry', id);
    },
    onCancel: async () => { if (running) await jobAction('agentCancel', running.id); },
  });
  composer.current = runtime.thread.composer;
  const errorCode = error || connection?.error;
  // A reply that finished while the panel was closed stays unread until the panel opens again.
  const lastReply = !open && latestReplyID !== undefined ? latestReplyID : [...snapshot.messages].reverse().find(message => message.role === 'assistant'
    && snapshot.jobs.some(job => `${job.id}:assistant` === message.id && ['completed', 'failed'].includes(job.state)))?.id ?? '';
  useEffect(() => { if ((snapshot !== empty || latestReplyID !== undefined) && (open || seenReply === null)) setSeenReply(lastReply); }, [snapshot, open, lastReply, seenReply, latestReplyID]);
  const unread = !open && seenReply !== null && lastReply !== seenReply;
  useEffect(() => { onNotice?.(unread); }, [unread, onNotice]);
  const openingBoard = fullWindow && goalReady && snapshot !== empty && onboardingTurnIdle(snapshot);
  useEffect(() => {
    if (!openingBoard) return;
    // R-D169: the conversation fades before the sheet folds into the main Agent entry.
    let alive = true;
    const timer = setTimeout(() => {
      const parts = [...(root.current?.querySelectorAll<HTMLElement>('.agent-thread, .agent-input') ?? [])];
      if (reducedMotion() || !parts.length) { onFirstGoal?.(); return; }
      const fades = parts.map(part => part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration('--motion-exit'), easing: easing('--ease-exit'), fill: 'forwards' }));
      void Promise.all(fades.map(fade => fade.finished.catch(() => {}))).then(() => {
        if (!alive) return;
        onFirstGoal?.();
        requestAnimationFrame(() => fades.forEach(fade => fade.cancel()));
      });
    }, duration('--onboarding-hold'));
    return () => { alive = false; clearTimeout(timer); };
  }, [openingBoard, onFirstGoal]);
  // R-D172: task details read in time order; what it delivered and the cards it handed to you close the conversation.
  const cards = workID ? snapshot.decisionCards ?? [] : [];
  const waitingCard = workID && snapshot.work?.waitingDecisionID && !cards.some(card => card.id === snapshot.work?.waitingDecisionID) ? snapshot.work.waitingDecisionID : undefined;
  const showResults = !!workID && (cards.length > 0 || !!waitingCard || snapshot.artifacts.length > 0);
  const status_ = native?.permissions.length ? 'work.waitingPermission' : running ? 'work.executing' : undefined;

  return <AssistantRuntimeProvider runtime={runtime}><ConversationContext.Provider value={{ snapshot, connected, t, onDecision, onRetry: id => jobAction('agentRetry', id) }}>
    <section ref={root} className={`agent ${!workID ? 'main-agent' : ''} ${fullWindow ? 'full' : ''}`} aria-label="Agent">
      {fullWindow && <div className="agent-sheet" aria-hidden="true"><div className="window-drag-region" /></div>}
      <div className="agent-panel">
        {!workID && <header className="agent-header" inert={fullWindow}>
          {!fullWindow && <AgentAvatar id={mainAgentAvatarID} state="completed" />}
          <div className="work-chat-heading"><h2>{t("agent.mainAgent")}</h2>{status_ && <span className={status_ === 'work.executing' ? 'agent-live-label' : undefined}>{t(status_)}</span>}</div>
          {native && <button className="agent-action agent-new" aria-label={t("agent.newChat")} title={t("agent.newChat")} onClick={() => void nativeAction({ action: 'newSession', provider: native.selected })}><AgentIcon name="compose" /></button>}
          {onClose && <button className="agent-action agent-dialog-close" aria-label={t('common.close')} onClick={onClose}>×</button>}
        </header>}
        <ThreadPrimitive.Root className="agent-conversation">
          <ThreadPrimitive.Viewport className={`agent-thread ${snapshot.messages.length ? 'has-messages' : ''}`} inert={!open}>
            {!workID && connected && snapshot.messages.length === 0 && !fullWindow && <div className="agent-welcome"><h3>{t("agent.whereShouldWeBegin")}</h3></div>}
            {!workID && fullWindow && snapshot.messages.length === 0 && <div className="agent-guide"><h1>{t("agent.whatGoalDoYouWantToMove")}</h1><p>{t("agent.describeWhatYouWantToGetDone")}</p></div>}
            {workID && snapshot.work && !snapshot.messages.length && <div className="agent-answer"><StreamingMarkdown source={snapshot.work.progress || snapshot.work.instructions} streaming={false} /></div>}
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            {showResults && <section className="work-summary">
              {snapshot.artifacts.map(artifact => <details key={artifact.id} className="work-summary-artifact agent-artifact"><summary><AgentIcon name="file" /><span>{artifact.title}</span><ToolDisclosure /></summary><StreamingMarkdown source={artifact.body} streaming={false} /></details>)}
              {(cards.length > 0 || waitingCard) && <div className="work-summary-cards">
                {cards.map(card => <button key={card.id} className="work-summary-card" title={t('work.viewDecision')} onClick={() => onDecision?.(card.id)}><span>{card.title}</span><AgentIcon name="chevron" /></button>)}
                {waitingCard && <button className="work-summary-card" onClick={() => onDecision?.(waitingCard)}><span>{t('work.viewDecision')}</span><AgentIcon name="chevron" /></button>}
              </div>}
            </section>}
            {openingBoard && <p className="agent-status agent-opening" role="status">{t("agent.openingYourBoard")}</p>}
            {errorCode && <p className="agent-status" role="alert">{t(errorKeys[errorCode] ?? (errorCode === 'work.taskEnded' ? errorCode : "agent.connectionFailedCheckYourNetworkAndRetry"))}</p>}
            {!connected && native && <p className="agent-offline" role="status">
              {t(offlineSentence, { value: onboardingProviders.find(item => item.provider === native.selected)?.name ?? native.selected })}{snapshot.messages.length ? ' ' + t("agent.messageSavedConnectToContinue") : ''}
              <button onClick={() => openSettings('model')}>{t("agent.openSettings")}</button>
            </p>}
            {!workID && native?.permissions.map(request => <div key={request.id} className="agent-permission" role="group" aria-label={request.titleKey ? t(request.titleKey) : request.title}>
              <strong>{request.titleKey ? t(request.titleKey) : request.title}</strong><pre>{request.detail}</pre>
              {request.options.map(option => <button key={option.id} className="agent-text-button" onClick={() => void nativeAction({ action: 'permission', provider: request.provider, id: request.id, option: option.id })}>{option.labelKey ? t(option.labelKey) : option.label}</button>)}
            </div>)}
            <ThreadPrimitive.ScrollToBottom className="agent-scroll-bottom agent-action" aria-label={t("agent.scrollToBottom")} title={t("agent.scrollToBottom")}><AgentIcon name="arrow" /></ThreadPrimitive.ScrollToBottom>
          </ThreadPrimitive.Viewport>
          {workID && running && <button className="agent-text-button agent-work-stop" onClick={() => void jobAction('agentCancel', running.id)}>{t('common.stop')}</button>}
          {!workID && <ComposerPrimitive.Root className="agent-input" onSubmit={event => { event.preventDefault(); void sendText(draftText); }}>
            {showCommand && <div id={commandMenuID} className="agent-command-menu" role="listbox" aria-label="Commands">
              {matchingCommands.map((command, index) => <button key={command.name} id={`${commandMenuID}-${index}`} type="button" role="option" aria-selected={index === activeCommandIndex} onMouseEnter={() => setCommandIndex(index)} onMouseDown={event => event.preventDefault()} onClick={() => compactContext(command.name)}>
                <svg className="agent-command-icon" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="2" fill="none" opacity=".16" /></svg>
                <span className="agent-command-name">{command.name === 'compact' ? 'Compact' : command.name}</span><span className="agent-command-description">{command.description}</span>
              </button>)}
            </div>}
            {!!attachments.length && <div className="agent-attachments">{attachments.map(file => <span className="agent-attachment" key={file.id} title={file.name}><AgentIcon name="file" /><span>{file.name}</span><button type="button" disabled={sending} aria-label={t("agent.removeAttachmentValue", { value: file.name })} onClick={() => void removeAttachment(file.id)}><AgentIcon name="remove" /></button></span>)}</div>}
            <ComposerPrimitive.Input rows={1} disabled={sending || snapshot.canSend === false} maxLength={20000} aria-label={t("agent.tellTheAgentAGoalOrIdea")} placeholder={t(fullWindow ? "agent.onboardingPlaceholder" : "agent.askAnything")}
              cancelOnEscape={!showCommand && fullWindow}
              role={showCommand ? 'combobox' : undefined} aria-autocomplete={showCommand ? 'list' : undefined} aria-expanded={showCommand ? true : undefined}
              aria-controls={showCommand ? commandMenuID : undefined} aria-activedescendant={showCommand ? `${commandMenuID}-${activeCommandIndex}` : undefined}
              onChange={event => { setDraftText(event.target.value); setCommandDismissed(false); setCommandIndex(0); }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (showCommand && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setCommandDismissed(true); }
                else if (!event.shiftKey && event.key === 'Enter' && showCommand) { event.preventDefault(); event.stopPropagation(); compactContext(); }
                else if (!event.shiftKey && event.key === 'Enter') { event.preventDefault(); void sendText(draftText); }
                else if (showCommand && event.key === 'Tab') { event.preventDefault(); composer.current?.setText(`/${activeCommand.name}`); setDraftText(`/${activeCommand.name}`); }
                else if (showCommand && ['ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setCommandIndex((activeCommandIndex + (event.key === 'ArrowDown' ? 1 : matchingCommands.length - 1)) % matchingCommands.length); }
              }} />
            <div className="agent-input-actions">
            <button type="button" className="agent-upload" disabled={!native || picking || sending} aria-label={t("agent.attachFiles")} title={t("agent.attachFiles")} onClick={() => void pickAttachments()}><AgentIcon name={picking ? 'loader' : 'plus'} /></button>
            {native && <AgentModelSelector native={native} disabled={sending || modelChanging || snapshot.canSend === false} onChange={(provider, model, settings) => void chooseModel(provider, model, settings)} t={t} />}
            {running && (!native || (!draftText.trim() && !attachments.length)) ? <ComposerPrimitive.Cancel className="agent-send" aria-label={t("common.stop")} title={t("common.stop")}><AgentIcon name="stop" /></ComposerPrimitive.Cancel>
              : <button type="submit" className="agent-send" disabled={snapshot.canSend === false || sending || modelChanging || picking || (!draftText.trim() && !attachments.length)} aria-label={t("common.send")} title={t("agent.send")}><AgentIcon name="arrow" /></button>}
            </div>
          </ComposerPrimitive.Root>}
        </ThreadPrimitive.Root>
      </div>
    </section>
  </ConversationContext.Provider></AssistantRuntimeProvider>;
}
