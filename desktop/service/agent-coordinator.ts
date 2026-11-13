import { autoAdvanceTurn, nativeRules, polarisRulesVersion, scheduledTurn } from './agent-instructions.js';
import type { LoopState } from './strategy-state.js';
import { type ExecutionInputs, parseInputs } from './execution-inputs.js';
import { StrategyScheduler } from './strategy-schedule.js';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentActions, cancelAgentWork } from './agent-actions.js';
import { AgentStore, type AgentJob, type AgentPart, type ProviderID } from './agent-store.js';
import { PolarisStore } from './store.js';
import { PolarisError } from './model.js';
import { capabilityNote, findBrowserCLI } from './local-capabilities.js';
import { createBusinessMCP } from './agent-mcp.js';
import { discover, inspectConnection, providerIDs } from './agents/discovery.js';
import { connectACP } from './agents/acp.js';
import { connectCodex } from './agents/codex.js';
import { AgentAttachments, type AgentAttachment } from './agent-attachments.js';
import type { NativeRPC } from './agents/rpc.js';
import { conversationHistoryPrompt } from './agent-history.js';
import type { DriverOptions, NativeConnection, NativeEvent, NativePermission, NativeSession } from './agents/types.js';
import { backgroundAgentLimit, type ModelSettings, type NativeModel } from './agents/types.js';
import { validateModelSettings } from './agents/models.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Active = { permissionBlocked?: boolean; ending?: boolean; inputs?: Promise<void>; controller: AbortController; generation: number; job: AgentJob; session?: NativeSession; cancelled: boolean; interrupted?: boolean; done?: Promise<void>; permissions: Map<string, (answer: string) => void> };
export class AgentCoordinator {
  language = process.env.POLARIS_LANGUAGE ?? 'en';
  /** Locates the browser a background task can drive as the user (R-D174); replaceable in tests. */
  browserCLI: () => string | null = () => findBrowserCLI();
  readonly data: AgentStore;
  readonly schedules: StrategyScheduler;
  private lastReconnect = 0;
  private idle = new Map<string, { rpc: NativeRPC; timer: ReturnType<typeof setTimeout> }>();
  private connections = new Map<ProviderID, NativeConnection>();
  private active = new Map<string, Active>();
  private permissionRequests = new Map<string, NativePermission>();
  private modelProbeAbort = new AbortController();
  private modelProbes = new Map<string, { at: number; value: Promise<NativeModel> }>();
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private probes = new Map<ProviderID, { controller: AbortController; done: Promise<void> }>();
  private connectionEpochs = new Map<ProviderID, number>();
  constructor(readonly store: PolarisStore, readonly notify: () => void = () => {}, readonly driver?: (options: DriverOptions) => Promise<NativeSession>) {
    this.data = new AgentStore(store);
    // A prompt may already have executed external side effects. Never replay it automatically.
    store.transaction(() => {
      for (const row of store.query("SELECT id FROM agent_job WHERE provider IS NOT NULL AND state='running'")) {
        const id = String(row.id);
        this.data.runs.delivery(id, 'unknown'); this.data.setJob(id, 'needs_review', 'native_delivery_unknown');
        this.data.runs.record(id, 'recovered', { reason: 'interrupted_run' }); this.data.runs.finish(id);
      }
    });
    store.query("UPDATE agent_message SET state='unknown' WHERE jobID IS NOT NULL AND state='sending'");
    for (const row of store.query("SELECT DISTINCT j.id FROM agent_message m JOIN agent_job j ON j.id=m.jobID WHERE m.inputKind='steer' AND m.state='unknown' AND j.state='completed'")) {
      this.data.setJob(String(row.id), 'needs_review', 'native_delivery_unknown'); this.data.runs.delivery(String(row.id), 'unknown');
    }
    store.query("UPDATE agent_message SET state='interrupted' WHERE provider IS NOT NULL AND state='running'");
    this.schedules = new StrategyScheduler(store, this.data, (work, inputs) => this.queueWork(work.instructions, work.id, this.selected(), inputs), () => this.changed());
    store.onOutcome = outcome => {
      if (outcome.acknowledgedAt) { this.changed(); return; }
      const provider = this.selected(), id = this.data.enqueueOutcome(outcome, provider, this.mainSession(provider));
      if (id) this.pinJobModel(id, this.connections.get(provider)?.model ?? '');
      this.changed(); queueMicrotask(() => this.pump());
    };
  }
  changed() { this.data.changed(); this.notify(); }
  selected(): ProviderID { const value = this.store.query("SELECT value FROM metadata WHERE key='agent_provider'")[0]?.value; return providerIDs.includes(value as ProviderID) ? value as ProviderID : 'chatgpt-codex'; }
  private nextConnectionEpoch(provider: ProviderID) {
    const epoch = (this.connectionEpochs.get(provider) ?? 0) + 1; this.connectionEpochs.set(provider, epoch); return epoch;
  }
  private saveConnection(connection: NativeConnection, userChange = true) {
    if (userChange) this.nextConnectionEpoch(connection.provider);
    this.connections.set(connection.provider, connection);
    this.store.query('INSERT INTO agent_connection(provider,payload) VALUES(?,?) ON CONFLICT(provider) DO UPDATE SET payload=excluded.payload', connection.provider, JSON.stringify({ enabled: connection.enabled, model: connection.model, modelSettings: connection.modelSettings, modelPreferences: connection.modelPreferences, version: connection.version, account: connection.account, verified: connection.verified }));
    this.changed();
  }
  private async checkConnection(provider: ProviderID, enable: boolean) {
    this.validateProvider(provider);
    this.probes.get(provider)?.controller.abort();
    const epoch = this.nextConnectionEpoch(provider), controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    const done = (async () => {
      const previous = this.connections.get(provider) ?? JSON.parse(String(this.store.query('SELECT payload FROM agent_connection WHERE provider=?', provider)[0]?.payload ?? '{}'));
      let connection = await discover(provider, previous, signal);
      if (enable || previous.enabled) connection = await inspectConnection(connection, signal);
      if (controller.signal.aborted || this.stopped || this.connectionEpochs.get(provider) !== epoch) return;
      if (signal.aborted) { this.saveConnection({ ...connection, connected: false, authenticated: null, error: 'native_timeout' }, false); return; }
      if (previous.account !== connection.account) connection.verified = { turn: false, tools: false, resume: false, cancel: false };
      if (enable) connection.enabled = connection.connected;
      this.saveConnection(connection, false);
      if (connection.connected && connection.enabled) for (const row of this.store.query("SELECT id FROM agent_job WHERE provider=? AND state='waiting_connection'", provider)) this.data.setJob(String(row.id), 'queued');
    })().catch(error => {
      if (!this.stopped && !controller.signal.aborted && this.connectionEpochs.get(provider) === epoch) {
        const current = this.connections.get(provider);
        if (current) this.saveConnection({ ...current, error: (error as { code?: string }).code ?? 'native_timeout' }, false);
      }
    }).finally(() => { if (this.probes.get(provider)?.controller === controller) this.probes.delete(provider); });
    this.probes.set(provider, { controller, done }); await done; this.pump();
  }
  async refresh(provider?: ProviderID) {
    for (const key of this.modelProbes.keys()) if (!provider || JSON.parse(key)[0] === provider) this.modelProbes.delete(key);
    await Promise.all((provider ? [provider] : providerIDs).map(id => this.checkConnection(id, false)));
  }
  snapshot() { return { selected: this.selected(), sub: this.subModel(), connections: [...this.connections.values()], permissions: [...this.permissionRequests.values()], activeJobIDs: [...this.active.keys()] }; }
  works() {
    return this.data.workList();
  }
  async connect(provider: ProviderID) { await this.checkConnection(provider, true); return this.snapshot(); }
  disconnect(provider: ProviderID) {
    void this.clearIdle();
    this.validateProvider(provider); this.probes.get(provider)?.controller.abort(); const connection = this.connections.get(provider);
    if (connection) this.saveConnection({ ...connection, enabled: false, connected: false });
    for (const item of this.active.values()) if (item.job.provider === provider) void this.cancel(item.job.id);
    for (const row of this.store.query("SELECT id FROM agent_job WHERE provider=? AND state='queued'", provider)) this.data.setJob(String(row.id), 'waiting_connection');
    return this.snapshot();
  }
  select(provider: ProviderID) {
    this.validateProvider(provider);
    const changed = provider !== this.selected();
    this.store.query("INSERT INTO metadata(key,value) VALUES('agent_provider',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", provider);
    if (changed) {
      // Native contexts stay separate; Polaris supplies the shared main-chat history as a local file.
      this.store.query("DELETE FROM metadata WHERE key='agent_native_main'");
    }
    this.changed(); return this.snapshot();
  }
  // R-D91: background work may use its own model; no setting means it follows the main model.
  subModel(): { provider: ProviderID; model: string; settings?: ModelSettings } | null {
    try {
      const value = JSON.parse(String(this.store.query("SELECT value FROM metadata WHERE key='agent_sub_model'")[0]?.value ?? 'null'));
      return value && providerIDs.includes(value.provider) && typeof value.model === 'string' ? value : null;
    } catch { return null; }
  }
  async selectSubModel(provider: ProviderID | null, model = '', input?: ModelSettings) {
    if (!provider) this.store.query("DELETE FROM metadata WHERE key='agent_sub_model'");
    else {
      this.validateProvider(provider);
      const connection = this.connections.get(provider);
      if (!connection || (model && !connection.models.some(item => item.id === model))) throw new PolarisError('invalid_input', 'Unknown native model.');
      const settings = input === undefined ? undefined : validateModelSettings(await this.modelOptions(provider, model), input);
      if (this.connections.get(provider) !== connection) throw new PolarisError('conflict', 'The model connection changed; try again.');
      this.store.query("INSERT INTO metadata(key,value) VALUES('agent_sub_model',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify({ provider, model, ...(settings !== undefined ? { settings } : {}) }));
    }
    this.changed(); return this.snapshot();
  }
  newSession() {
    void this.clearIdle();
    this.store.transaction(() => {
      this.store.query("DELETE FROM metadata WHERE key='agent_native_main'");
      this.store.query("INSERT INTO metadata(key,value) SELECT 'agent_main_history_start',COALESCE(MAX(seq),0) FROM agent_job WHERE kind='main' ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    });
    this.changed(); return this.snapshot();
  }
  private workModel(work: import('./agent-store.js').AgentWork) {
    const chosen = this.subModel(), sub = chosen?.provider === work.provider ? chosen : null;
    const model = sub ? sub.model : this.connections.get(work.provider!)?.model ?? '';
    return { provider: work.provider!, model, settings: sub?.settings ?? this.selectionSettings(work.provider!, model) };
  }
  private selectionSettings(provider: ProviderID, model: string): ModelSettings {
    const connection = this.connections.get(provider);
    return structuredClone(connection?.model === model ? connection.modelSettings ?? {} : connection?.modelPreferences?.[model] ?? {});
  }
  private jobSettings(id: string): ModelSettings {
    return JSON.parse(String(this.store.query('SELECT value FROM metadata WHERE key=?', `agent_job_settings:${id}`)[0]?.value ?? '{}'));
  }
  private pinJobModel(id: string, model: string, settings?: ModelSettings) {
    const job = this.data.job(id);
    settings ??= job?.workID ? this.workModel(this.data.work(job.workID)).settings : this.selectionSettings(job?.provider ?? this.selected(), model);
    this.store.query('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `agent_job_model:${id}`, model);
    this.store.query('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `agent_job_settings:${id}`, JSON.stringify(settings));
  }
  async modelOptions(provider: ProviderID, model: string): Promise<NativeModel> {
    this.validateProvider(provider);
    const connection = this.connections.get(provider);
    const key = JSON.stringify([provider, model, connection?.version, connection?.account]);
    const cached = this.modelProbes.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.value;
    const value = (async () => {
      const signal = AbortSignal.any([this.modelProbeAbort.signal, AbortSignal.timeout(10_000)]);
      const found = await inspectConnection(connection ? structuredClone(connection) : await discover(provider, undefined, signal), signal, model);
      const item = found.models.find(item => item.id === model);
      if (!found.connected || !item) throw new PolarisError(found.error || 'native_models', 'Model options are unavailable.');
      return item;
    })();
    this.modelProbes.set(key, { at: Date.now(), value });
    if (this.modelProbes.size > 64) this.modelProbes.delete(this.modelProbes.keys().next().value!);
    try { return await value; } catch (error) { this.modelProbes.delete(key); throw error; }
  }
  async chooseModel(provider: ProviderID, model: string, taskID?: string, input?: unknown) {
    this.validateProvider(provider);
    const session = this.mainSession(this.selected());
    const validateTask = () => {
      if ((taskID && taskID !== session) || this.mainSession(this.selected()) !== session)
        throw new PolarisError('conflict', 'This conversation is no longer current.', 'work.taskEnded');
    };
    validateTask();
    let connection = this.connections.get(provider);
    if (!connection?.enabled || !connection.connected || (model && !connection.models.some(item => item.id === model))) {
      await this.connect(provider); connection = this.connections.get(provider);
    }
    validateTask();
    if (!connection?.connected || !connection.enabled) throw new PolarisError(connection?.error || 'native_disconnected', 'Connect this Agent before selecting a model.');
    if (model && !connection.models.some(item => item.id === model)) throw new PolarisError('agent_models', 'The selected model is no longer available.');
    const requested = input ?? connection.modelPreferences?.[model] ?? {};
    const available = input !== undefined && model ? await this.modelOptions(provider, model) : connection.models.find(item => item.id === model);
    validateTask();
    const validated = validateModelSettings(available, requested);
    const settings: ModelSettings = { ...validated };
    if (input !== undefined) for (const option of available?.options ?? []) {
      const value = option.currentValue ?? option.defaultValue;
      if (settings[option.id] === undefined && value !== undefined && option.choices.some(choice => choice.value === value)) settings[option.id] = value;
    }
    if (this.connections.get(provider) !== connection) throw new PolarisError('conflict', 'The Agent connection changed. Retry this selection.');
    this.store.transaction(() => {
      this.saveConnection({ ...connection!, models: connection!.models.map(item => item.id === model && available ? available : item), modelPreferences: { ...connection!.modelPreferences, [model]: settings } });
      this.store.query("INSERT INTO metadata(key,value) VALUES('agent_provider',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", provider);
      this.saveConnection({ ...this.connections.get(provider)!, model, modelSettings: settings });
    });
    this.changed(); return this.conversation();
  }
  private validateProvider(provider: ProviderID) { if (!providerIDs.includes(provider)) throw new PolarisError('invalid_input', 'Unknown Agent provider.'); }
  private mainSession(provider: ProviderID) {
    let key = this.store.query("SELECT value FROM metadata WHERE key='agent_native_main'")[0]?.value as string | undefined;
    if (!key) this.store.transaction(() => {
      key = `native:${provider}:${randomUUID()}`;
      this.store.query("INSERT INTO metadata(key,value) VALUES('agent_native_main',?)", key);
      this.store.query("INSERT INTO agent_session(id,provider,historyStart) VALUES(?,?,COALESCE((SELECT CAST(value AS INTEGER) FROM metadata WHERE key='agent_main_history_start'),0))", key, provider);
    });
    return key!;
  }
  send(text: string, requestID: string = randomUUID(), attachmentIDs: unknown = []) {
    const currentSession = this.mainSession(this.selected());
    const attachments = new AgentAttachments(this.store).resolve(attachmentIDs);
    if (this.existingInput(requestID, text, attachments, currentSession)) return requestID.toLowerCase();
    if (this.data.job(requestID.toLowerCase())) return this.data.send(text, requestID, attachments);
    if (attachments.length && text.trim().startsWith('/')) throw new PolarisError('attachment_command', 'Send attachments with a message, not a command.');
    const provider = this.selected(), connection = this.connections.get(provider);
    if (this.steerInput(currentSession, text, requestID, attachments, provider, connection?.model ?? '')) return requestID.toLowerCase();
    const id = this.store.transaction(() => {
      const target = this.data.send(text, requestID, attachments);
      this.store.query('UPDATE agent_job SET provider=?,sessionKey=? WHERE id=?', provider, currentSession, target);
      this.store.query('UPDATE agent_message SET provider=? WHERE id=?', provider, `${target}:user`);
      this.pinJobModel(target, connection?.model ?? '');
      if (!connection?.connected) this.data.setJob(target, 'waiting_connection');
      return target;
    });
    this.changed(); this.pump(); return id;
  }
  private existingInput(id: string, text: string, files: AgentAttachment[], sessionKey: string) {
    const row = this.store.query('SELECT m.*,j.sessionKey FROM agent_message m JOIN agent_job j ON j.id=m.jobID WHERE m.id=?', `${id.toLowerCase()}:user`)[0];
    if (!row) return false;
    if (row.sessionKey !== sessionKey || row.body !== text.trim() || row.attachments !== JSON.stringify(files)) throw new PolarisError('conflict', 'Request ID already used for another message.');
    return true;
  }
  private steerInput(sessionKey: string, text: string, id: string, files: AgentAttachment[], provider: ProviderID, model: string, settings = this.selectionSettings(provider, model)) {
    const active = [...this.active.values()].find(a => a.job.sessionKey === sessionKey);
    if (!active?.session?.steer || !active.session.canSteer?.() || active.ending || active.cancelled || text.trim().startsWith('/') || active.job.provider !== provider) return false;
    if (String(this.store.query('SELECT value FROM metadata WHERE key=?', `agent_job_model:${active.job.id}`)[0]?.value ?? '') !== model || !isDeepStrictEqual(this.jobSettings(active.job.id), settings)) return false;
    id = this.data.liveInput(active.job, id, text, files);
    active.inputs = (active.inputs ?? Promise.resolve()).then(async () => {
      try {
        const accepted = !active.ending && !active.cancelled && await active.session!.steer!(text + new AgentAttachments(this.store).prompt(files.map(f => f.id)), id);
        if (accepted) this.data.inputState(id, 'accepted');
        else this.store.transaction(() => {
          this.store.query('DELETE FROM agent_message WHERE id=?', `${id}:user`);
          this.data.send(text, id, files);
          this.store.query("UPDATE agent_job SET provider=?,sessionKey=? WHERE id=?", provider, sessionKey, id);
          this.pinJobModel(id, model, settings);
          if (active.cancelled) this.data.setJob(id, 'cancelled');
        });
      } catch {
        this.data.inputState(id, 'unknown');
      }
      this.changed();
    });
    this.changed(); return true;
  }
  private transportKey(job: AgentJob, connection: NativeConnection) {
    return JSON.stringify([job.sessionKey, connection.provider, connection.executable, connection.version, connection.account]);
  }
  private async clearIdle() {
    const idle = [...this.idle.values()]; this.idle.clear();
    for (const item of idle) clearTimeout(item.timer);
    await Promise.all(idle.map(item => item.rpc.close()));
  }
  private keepIdle(key: string, rpc: NativeRPC) {
    const timer = setTimeout(() => { this.idle.delete(key); void rpc.close(); }, 60_000); timer.unref();
    this.idle.set(key, { rpc, timer });
    if (this.idle.size > backgroundAgentLimit + 1) {
      const [oldKey, old] = this.idle.entries().next().value!; this.idle.delete(oldKey); clearTimeout(old.timer); void old.rpc.close();
    }
  }
  private nativeWork(id: string) {
    const work = this.data.work(id);
    if (!work.provider || !work.sessionKey) throw new PolarisError('conflict', 'This work has no native conversation.');
    return work;
  }
  conversation(workID?: string, taskID?: string) {
    const work = workID ? this.nativeWork(workID) : undefined;
    const data = work ? this.data.workSnapshot(work.id, taskID) : this.data.snapshot();
    const ids = new Set(data.jobs.filter(j => work ? j.workID === work.id : j.kind === 'main').map(j => j.id));
    const native = this.snapshot();
    const sessionKey = data.work?.sessionKey ?? this.mainSession(this.selected());
    const waitingFor = Object.fromEntries(data.jobs.filter(job => job.workID && job.state === 'queued').map(job => [job.id, this.data.inputStatus(job)]));
    const latest = work ? data.jobs[0] : undefined;
    const retryJobID = latest?.state === 'failed' && this.retryMode(latest) ? latest.id : undefined;
    return { ...data, waitingFor, sessionKey, retryJobID, decisionCards: this.data.decisionCards(data.work), canSend: !work,
      native: { ...native, modelSettings: work ? this.workModel(work).settings : this.selectionSettings(native.selected, this.connections.get(native.selected)?.model ?? ''), selected: work?.provider ?? native.selected, model: work ? this.workModel(work).model : this.connections.get(native.selected)?.model ?? '', permissions: native.permissions.filter(p => ids.has(p.jobID)), activeJobIDs: native.activeJobIDs.filter(id => ids.has(id)) } };
  }
  async stopWork(workID: string, id: string) {
    const work = this.nativeWork(workID), job = this.data.job(id);
    if (!job || job.workID !== workID || job.sessionKey !== work.sessionKey || !['running', 'queued', 'waiting_connection'].includes(job.state)) throw new PolarisError('conflict', 'This run does not belong to the current task.');
    for (const queued of this.store.query("SELECT id FROM agent_job WHERE workID=? AND sessionKey=? AND state IN ('queued','waiting_connection') AND id<>?", workID, job.sessionKey!, id)) this.data.setJob(String(queued.id), 'cancelled');
    await this.cancel(id);
    return this.conversation(workID);
  }
  executionPlan(goalID?: string, offset = 0) {
    if ((goalID !== undefined && (typeof goalID !== 'string' || goalID.length > 120)) || !Number.isSafeInteger(offset) || offset < 0) throw new PolarisError('invalid_input', 'Invalid plan query.', 'execution.invalid');
    const states = this.strategyStates().filter(item => !goalID || item.goalID === goalID);
    const items = states.slice(offset, offset + 100).map(({ loop, ...item }) => ({ ...item, phase: loop.state, nextAt: loop.until ?? null }));
    return { items, total: states.length, nextOffset: offset + items.length < states.length ? offset + items.length : null };
  }
  private strategyStates(board = this.store.snapshot(), schedules = this.schedules.list()) {
    const byStrategy = new Map(schedules.map(item => [item.strategyID, item]));
    return board.strategies.map(strategy => {
      const schedule = byStrategy.get(strategy.id);
      const jobs = this.store.query(`SELECT j.*,w.title FROM agent_job j JOIN agent_work w ON w.id=j.workID
        WHERE w.strategyID=? AND j.provider IS NOT NULL
        AND j.seq=(SELECT MAX(latest.seq) FROM agent_job latest WHERE latest.sessionKey=j.sessionKey) ORDER BY j.seq DESC`, strategy.id) as unknown as AgentJob[];
      const active = jobs.filter(job => ['queued', 'running', 'waiting_connection'].includes(job.state));
      const pendingDecisions = board.decisions.filter(card => card.strategyID === strategy.id && !card.outcome).length;
      const handoff = !pendingDecisions ? this.data.activeStrategyHandoff(strategy.id) : undefined;
      const job = active.find(item => item.state === 'running') ?? active.find(item => item.state === 'waiting_connection') ?? active[0] ?? handoff;
      let loop: LoopState;
      if (pendingDecisions) loop = { state: 'cards' };
      else if (handoff?.state === 'needs_review' || this.data.uncertainStrategyRuns(strategy.id).length || schedule?.blocked) loop = { state: 'needs_review' };
      else if (job) loop = { state: !this.data.inputStatus(job).ready ? 'waiting_input' : job.state as 'running' | 'queued' | 'waiting_connection', title: job.title ?? undefined, workID: job.workID ?? undefined };
      else if (schedule?.pendingAt || schedule?.nextAt) loop = { state: 'scheduled', until: schedule.pendingAt ?? schedule.nextAt! };
      else loop = { state: 'stalled' };
      if (!pendingDecisions) loop.decisionPreparation = this.data.activeDecisionPreparation(strategy.id);
      return { id: strategy.id, title: strategy.title, goalID: strategy.goalID, goalTitle: board.goals.find(goal => goal.id === strategy.goalID)?.title ?? '',
        activeCount: active.length, pendingDecisions, latestJobID: jobs[0]?.id ?? null, loop };
    });
  }

  private retryMode(job: AgentJob): 'requeue' | 'continue' | undefined {
    if (!job.provider || !job.sessionKey || this.active.has(job.id) || ['question_retired', 'native_delivery_unknown'].includes(job.error)
      || !['failed', 'cancelled', 'waiting_connection'].includes(job.state) || ['unknown', 'sent', 'accepted', 'preparing'].includes(job.delivery ?? '')
      || this.store.query('SELECT 1 FROM agent_job WHERE sessionKey=? AND seq>(SELECT seq FROM agent_job WHERE id=?)', job.sessionKey, job.id).length) return;
    if (!job.workID) return 'requeue';
    const work = this.data.work(job.workID);
    if (job.sessionKey !== work.sessionKey || !this.store.isStrategyActive(work.strategyID)
      || this.data.pendingDecision(work.id) || this.data.uncertainStrategyRuns(work.strategyID).length || !this.schedules.canStart(work.id, false)) return;
    if (job.delivery === 'not_sent' || (job.delivery === 'queued' && !job.startedAt)) return 'requeue';
    if (this.store.query('SELECT 1 FROM agent_session WHERE id=? AND provider=? AND nativeSessionID IS NOT NULL', job.sessionKey, job.provider).length) return 'continue';
  }
  retry(id: string) {
    this.store.transaction(() => {
      const job = this.data.job(id), mode = job && this.retryMode(job);
      if (!job || !mode) throw new PolarisError('conflict', 'This native run cannot be replayed.');
      if (mode === 'continue') {
        const next = this.data.continueWork(job, 'retry');
        const model = this.store.query('SELECT value FROM metadata WHERE key=?', `agent_job_model:${id}`)[0]?.value;
        if (model !== undefined) this.pinJobModel(next, String(model), this.jobSettings(id));
      } else {
        this.data.setJob(id, 'queued');
        if (job.workID) {
          const work = this.data.work(job.workID);
          this.data.setWork(work.id, 'queued', work.progress);
        }
      }
    });
    this.changed(); this.pump();
  }
  async cancel(id: string, interrupted = false) {
    const job = this.data.job(id); if (!job || !job.provider) throw new PolarisError('not_found', 'Native run not found.');
    const current = this.active.get(id);
    if (!current) { if (['queued', 'waiting_connection', 'failed', 'waiting_decision'].includes(job.state)) this.data.setJob(id, 'cancelled'); this.changed(); this.pump(); return; }
    current.cancelled = true; current.interrupted = interrupted;
    if (!current.session) current.controller.abort();
    for (const settle of current.permissions.values()) settle('');
    try { await current.session?.cancel(); } catch { /* closing our own process confirms local termination */ }
    // Remote acknowledgement alone is not proof that the turn ended. Give the turn a bounded grace period.
    if (current.done) await Promise.race([current.done, new Promise(resolve => setTimeout(resolve, 1500))]);
    if (this.active.has(id)) await current.session?.close();
  }
  permission(id: string, option: string) {
    const request = this.permissionRequests.get(id);
    if (!request || !request.options.some(item => item.id === option)) throw new PolarisError('invalid_input', 'This permission request is no longer active.');
    this.active.get(request.jobID)?.permissions.get(id)?.(option);
  }
  private promptPermission(active: Active, request: Omit<NativePermission, 'id' | 'jobID' | 'provider'>) {
    if (active.cancelled) return Promise.resolve('');
    const id = randomUUID();
    this.data.runs.record(active.job.id, 'permission_requested', { requestID: id });
    if (active.job.kind === 'work') {
      active.permissionBlocked = true;
      this.data.runs.record(active.job.id, 'permission_settled', { requestID: id, answered: false });
      return Promise.resolve('');
    }
    this.permissionRequests.set(id, { ...request, id, jobID: active.job.id, provider: active.job.provider! }); this.changed();
    return new Promise<string>(resolve => active.permissions.set(id, answer => {
      this.data.runs.record(active.job.id, 'permission_settled', { requestID: id, answered: !!answer });
      active.permissions.delete(id); this.permissionRequests.delete(id); this.changed(); resolve(answer);
    }));
  }
  advanceStrategy(strategyID: string) {
    const note = 'Read the current decisions and scheduled tasks. Do useful work that can be done now within existing authorization. Preserve existing schedules and leave time-dependent work until it is due. Avoid repeating completed actions.';
    const result = this.data.startStrategy(strategyID, note, this.language, (input, id) => { this.queueWork(input, id); });
    queueMicrotask(() => this.pump());
    return result;
  }
  /** The loop state behind each strategy lane (R-D172). */
  loopStates(board = this.store.snapshot(), schedules = this.schedules.list()): Record<string, LoopState> {
    return Object.fromEntries(this.strategyStates(board, schedules).map(item => [item.id, item.loop]));
  }

  queueWork(input: string, id: string, fallback = this.selected(), inputs: ExecutionInputs = parseInputs({})) {
    const provider = this.subModel()?.provider ?? fallback, session = `native:${provider}:work:${id}`;
    return this.store.transaction(() => {
      this.store.query('UPDATE agent_work SET provider=?,sessionKey=? WHERE id=?', provider, session, id);
      const target = this.data.queue('work', input, id);
      this.data.setInputs(target, inputs);
      this.store.query('UPDATE agent_job SET provider=?,sessionKey=? WHERE id=?', provider, session, target);
      this.pinJobModel(target, this.workModel(this.data.work(id)).model);
      return target;
    });
  }
  private queueEffectChecks() {
    for (const row of this.store.query(`SELECT j.id,j.generation,w.strategyID,w.title FROM agent_job j JOIN agent_work w ON w.id=j.workID
      WHERE j.state='needs_review' AND j.provider IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM agent_run_review r WHERE r.jobID=j.id AND r.generation=j.generation)`)) {
      const key = `effect_check:${row.id}:${row.generation}`;
      if (this.store.query('SELECT 1 FROM metadata WHERE key=?', key).length) continue;
      this.store.transaction(() => {
        const provider = this.selected(), id = this.data.queue('main', JSON.stringify({
          instruction: 'Inspect this interrupted task and verify its actual effects using read-only checks. Do not repeat its actions. If the effects are established, call resolve_run and arrange only remaining authorized work. If necessary facts are only available from the user, submit a concise decision card. Do not ask the user to review execution IDs or logs.',
          jobID: row.id, generation: row.generation, strategyID: row.strategyID, title: row.title,
        }));
        this.store.query('UPDATE agent_job SET provider=?,sessionKey=?,title=? WHERE id=?', provider, this.mainSession(provider), String(row.title), id);
        this.pinJobModel(id, this.connections.get(provider)?.model ?? '');
        this.store.query('INSERT INTO metadata(key,value) VALUES(?,?)', key, id);
      });
    }
  }
  startScheduling() { this.schedules.start(); this.pump(); }
  private queueAutoAdvances() {
    for (const strategyID of this.data.autoAdvanceStrategies()) this.store.transaction(() => {
      if (!this.data.takeAutoAdvance(strategyID)) return;
      const strategy = this.store.get('strategy', strategyID);
      const work = this.data.createWork(strategyID, strategy.title, autoAdvanceTurn);
      const id = this.queueWork(work.instructions, work.id);
      this.store.query("UPDATE agent_job SET origin='auto_advance' WHERE id=?", id);
    });
  }
  pump() {
    clearTimeout(this.timer); if (this.stopped) return;
    this.queueEffectChecks();
    for (const id of this.data.reconcileOutcomes(this.selected(), this.mainSession(this.selected()))) this.pinJobModel(id, this.connections.get(this.selected())?.model ?? '');
    this.queueAutoAdvances();
    if (Date.now() - this.lastReconnect > 60_000) {
      this.lastReconnect = Date.now();
      for (const provider of providerIDs) if (this.store.query("SELECT 1 FROM agent_job WHERE provider=? AND state='waiting_connection'", provider).length && this.connections.get(provider)?.enabled && !this.probes.has(provider)) void this.checkConnection(provider, false);
    }
    for (const row of this.store.query("SELECT id FROM agent_job WHERE provider IS NOT NULL AND state='queued' ORDER BY seq")) {
      const job = this.data.job(String(row.id))!;
      if (job.origin === 'auto_advance' && !job.generation && job.workID) {
        const work = this.data.work(job.workID);
        if (!this.store.isStrategyActive(work.strategyID) || this.data.hasPendingCards(work.strategyID)) {
          this.data.setJob(job.id, 'cancelled'); this.data.setWork(work.id, 'cancelled', work.progress); continue;
        }
      }
      if (job.workID && !job.outcomeID && !job.outcomeContextID && this.data.uncertainStrategyRuns(this.data.work(job.workID).strategyID).length) continue;
      if ((job.workID || job.outcomeID) && !this.store.transaction(() => this.data.inputStatus(job).ready)) continue;
      if (job.workID && job.origin === 'user' && this.data.pendingDecision(job.workID)) { this.data.setJob(job.id, 'cancelled'); continue; }
      const running = [...this.active.values()];
      if (running.some(item => item.job.sessionKey === job.sessionKey)) continue;
      if (running.filter(item => item.job.kind === job.kind).length >= (job.kind === 'work' ? backgroundAgentLimit : 1)) continue;
      if (job.workID && !this.schedules.canStart(job.workID, !!job.outcomeID || job.origin === 'resume')) {
        this.data.setJob(job.id, 'cancelled', 'schedule_inactive');
        const work = this.data.work(job.workID); this.data.setWork(work.id, 'cancelled', work.progress); continue;
      }
      // Only an explicit chat continuation starts a fresh native context after uncertain delivery.
      if (this.data.unresolvedRun(job.sessionKey!)) { this.data.setJob(job.id, 'failed', 'native_delivery_unknown'); continue; }
      if (!this.connections.get(job.provider!)?.connected || !this.connections.get(job.provider!)?.enabled) { this.data.setJob(job.id, 'waiting_connection'); continue; }
      const active: Active = { controller: new AbortController(), job, generation: (job.generation ?? 0) + 1, cancelled: false, permissions: new Map() };
      this.active.set(job.id, active);
      const done = this.run(active).finally(() => { this.active.delete(job.id); this.changed(); this.pump(); }); active.done = done;
    }
    this.timer = setTimeout(() => this.pump(), 2000); this.timer.unref();
  }
  private async run(active: Active) {
    const { job, generation } = active;
    const connection = structuredClone(this.connections.get(job.provider!)!);
    const sub = job.kind === 'work' ? this.subModel() : null;
    if (sub && sub.provider === job.provider) connection.model = sub.model;
    const pinnedModel = this.store.query('SELECT value FROM metadata WHERE key=?', `agent_job_model:${job.id}`)[0]?.value;
    if (pinnedModel !== undefined) connection.model = String(pinnedModel);
    else this.pinJobModel(job.id, connection.model);
    connection.modelSettings = this.jobSettings(job.id);
    const connectionEpoch = this.connectionEpochs.get(job.provider!) ?? 0;
    const parts: AgentPart[] = [];
    const observeTool = this.data.runs.observeTools(job.id, generation);
    const currentRun = () => {
      const current = this.data.job(job.id);
      return this.active.get(job.id) === active && current?.generation === generation && current.state === 'running';
    };
    let lastSave = 0, saveTimer: ReturnType<typeof setTimeout> | undefined;
    let bridge: Awaited<ReturnType<typeof createBusinessMCP>> | undefined, submitted = false;
    let promptState: { native: string; rules: string; context: string } | undefined;
    const promptKey = `agent_prompt:${job.sessionKey}`;
    const assertActive = () => {
      const current = this.data.job(job.id);
      if (this.stopped || this.active.get(job.id) !== active || active.cancelled || current?.generation !== generation || current.state !== 'running') throw new PolarisError('agent_cancelled', 'This Polaris run is no longer active.');
      if (active.permissionBlocked) throw new PolarisError('work_permission', 'Background work requires native permission.');
      if (job.workID && !this.store.isStrategyActive(this.data.work(job.workID).strategyID)) throw new PolarisError('conflict', 'The work strategy is no longer active.');
    };
    const actions = new AgentActions(this.store, this.data, {
      assertActive, schedules: this.schedules, executionPlan: (goalID, offset) => this.executionPlan(goalID, offset), language: this.language,
      queueWork: (input, id, inputs) => { this.queueWork(input, id, job.provider!, inputs); },
      cancelWork: id => { this.nativeWork(id); cancelAgentWork(this.store, this.data, id, target => { void this.cancel(target); }); },
      retry: id => this.retry(id),
    }, () => this.changed());
    const save = (state = 'running') => {
      clearTimeout(saveTimer); saveTimer = undefined; lastSave = Date.now();
      {
        this.data.message(job.id, parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n'), state, parts);
        this.store.query('UPDATE agent_message SET provider=?,nativeSessionID=(SELECT nativeSessionID FROM agent_session WHERE id=?) WHERE id=?', job.provider!, job.sessionKey!, `${job.id}:assistant`);
      }
      this.changed();
    };
    try {
      this.store.transaction(() => {
        this.store.query('UPDATE agent_job SET generation=?,nativeRunID=NULL,runtimeVersion=?,runtimeSource=? WHERE id=?', generation, connection.version, `${connection.protocol}:${connection.executable}`, job.id);
        this.data.runs.delivery(job.id, 'preparing'); this.data.setJob(job.id, 'running');
        this.data.runs.record(job.id, 'runtime', { version: connection.version, protocol: connection.protocol, rulesVersion: polarisRulesVersion });
      });
      save();
      const work = job.workID ? this.data.work(job.workID) : undefined;
      const schedule = work && !job.outcomeID && !job.outcomeContextID ? this.schedules.workContext(work.id) : undefined;
      if (work) this.data.setWork(work.id, 'running', work.progress, this.data.pendingDecision(work.id));
      if (job.outcomeID || job.outcomeContextID) {
        const outcome = this.store.outcomes().find(item => item.id === (job.outcomeID ?? job.outcomeContextID) && !item.withdrawnAt);
        if (!outcome || (job.outcomeID && outcome.acknowledgedAt && !job.acceptedAt)) throw new PolarisError('execution_received', 'The decision was withdrawn or already acknowledged.', 'errors.decisionChanged');
      }
      bridge = await createBusinessMCP(actions.definitions(job, work), assertActive, () => {
        connection.verified.tools = true;
      });
      const cwd = path.join(path.dirname(this.store.file), 'agent-workspaces', job.sessionKey!.replace(/[^a-zA-Z0-9_-]/g, '_'));
      await mkdir(cwd, { recursive: true });
      this.store.query('INSERT OR IGNORE INTO agent_session(id,provider) VALUES(?,?)', job.sessionKey!, job.provider!);
      const saved = this.store.query('SELECT nativeSessionID FROM agent_session WHERE id=? AND provider=?', job.sessionKey!, job.provider!)[0];
      const options: DriverOptions = {
        signal: active.controller.signal, connection, cwd, sessionID: saved?.nativeSessionID ? String(saved.nativeSessionID) : undefined,
        mcp: { command: process.env.POLARIS_NODE_EXECUTABLE ?? process.execPath, args: [fileURLToPath(new URL('./agent-mcp.js', import.meta.url)), '--stdio-proxy'], env: { ELECTRON_RUN_AS_NODE: '1', POLARIS_MCP_ENDPOINT: bridge.endpoint, POLARIS_MCP_TOKEN: bridge.token, POLARIS_REQUEST_ID: job.id } },
        onSession: id => {
          if (!currentRun()) return;
          this.store.transaction(() => {
            this.store.query('UPDATE agent_session SET nativeSessionID=?,runtimeVersion=?,provider=? WHERE id=?', id, connection.version, job.provider!, job.sessionKey!);
            this.data.runs.record(job.id, 'session', {}, `session:${id}`);
          });
        },
        onRun: id => {
          if (!currentRun() || active.cancelled) return;
          this.store.transaction(() => {
            this.store.query('UPDATE agent_job SET nativeRunID=? WHERE id=?', id || null, job.id);
            this.data.runs.delivery(job.id, 'accepted');
            if (promptState) this.store.query('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)', promptKey, JSON.stringify(promptState));
            if (job.outcomeID || job.outcomeContextID) {
              const outcome = this.store.outcomes().find(item => item.id === (job.outcomeID ?? job.outcomeContextID) && !item.withdrawnAt);
              if (outcome && !outcome.acknowledgedAt) { outcome.acknowledgedAt = new Date().toISOString(); this.store.persistOutcome(outcome); this.store.query('UPDATE agent_job SET acceptedAt=? WHERE id=?', outcome.acknowledgedAt, job.id); }
            }
          });
        },
        onEvent: event => {
          if (!currentRun()) return;
          if (event.type === 'compaction') this.store.query('DELETE FROM metadata WHERE key=?', promptKey);
          if (['commands', 'models', 'usage', 'compaction', 'metadata'].includes(event.type)) this.store.query('INSERT OR IGNORE INTO agent_native_event(jobID,eventID,payload) VALUES(?,?,?)', job.id, event.id ?? randomUUID(), JSON.stringify({ ...event, receivedAt: new Date().toISOString() }));
          if (event.type === 'commands') connection.capabilities.nativeCommands = event.data;
          if (event.type === 'models') { connection.models = event.data.models; connection.modelControl = event.data.modelControl; }
          if (event.type === 'commands' || event.type === 'models') this.mergeRunObservation(connection, connectionEpoch);
          const call = this.project(parts, event);
          if (call) observeTool(call, (active.session?.capabilities ?? connection.capabilities).toolEvents === 'details' && !['declined', 'cancelled'].includes(event.data?.status));
          const delay = Math.max(0, 50 - (Date.now() - lastSave));
          if (!delay) save(); else saveTimer ??= setTimeout(() => save(), delay);
        },
        permission: request => this.promptPermission(active, request),
      };
      const idleKey = this.transportKey(job, connection), idle = this.idle.get(idleKey);
      if (idle) { this.idle.delete(idleKey); clearTimeout(idle.timer); if (idle.rpc.alive) options.transport = idle.rpc; else await idle.rpc.close(); }
      active.session = await (this.driver ?? (job.provider === 'chatgpt-codex' ? connectCodex : connectACP))(options);
      if (saved?.nativeSessionID) connection.verified.resume = true;
      assertActive();
      this.store.query('UPDATE agent_session SET capabilities=? WHERE id=?', JSON.stringify(active.session.capabilities), job.sessionKey!);
      const command = job.input.match(/^\/(\S+)(?:\s|$)/)?.[1];
      if (command && !active.session.capabilities.nativeCommands.some(item => item.name === command)) throw new PolarisError('native_command', 'This native Agent does not advertise that command.');
      const history = !command ? await conversationHistoryPrompt(this.store, job, cwd) : '';
      const rules = nativeRules(!!work, this.language, Intl.DateTimeFormat().resolvedOptions().timeZone);
      const attachments = JSON.parse(String(this.store.query('SELECT attachments FROM agent_message WHERE id=?', `${job.id}:user`)[0]?.attachments ?? '[]'));
      const full = actions.context(job);
      // Main turns repeat the slower-changing board only when it changed; activity is always current and compact.
      let activity = '', business: string;
      if (!work) {
        const { activity: states, runs, progress, artifacts, schedules, pendingQuestions, attention, ...board } = full;
        activity = JSON.stringify({ activity: states, schedules, pendingQuestions, attention, progress, artifacts, runs: runs?.filter(item => item.workID) });
        business = JSON.stringify(board);
      } else business = JSON.stringify(full);
      // A resumed native conversation already holds unchanged rules and context; resend them after compaction or a new native session.
      const nativeSession = String(this.store.query('SELECT nativeSessionID FROM agent_session WHERE id=?', job.sessionKey!)[0]?.nativeSessionID ?? '');
      const sent = JSON.parse(String(this.store.query('SELECT value FROM metadata WHERE key=?', `agent_prompt:${job.sessionKey}`)[0]?.value ?? 'null'));
      promptState = command ? undefined : { native: nativeSession, rules: hash(rules), context: hash(business) };
      // Only Codex reports compaction, so other platforms keep receiving the full rules and board.
      const same = (key: 'rules' | 'context') => job.provider === 'chatgpt-codex' && !!nativeSession && sent?.native === nativeSession && sent[key] === promptState![key];
      const volatile = `Current time: ${new Date().toISOString()}.${work ? ` Pending decision IDs: ${this.data.pendingDecision(work.id) ?? 'none'}.` : ''}${work && job.origin === 'user' ? ' Handle this additional instruction within the current task.' : ''}${work ? `\n${capabilityNote(this.browserCLI())}` : ''}`;
      const prompt = (command ? job.input : [same('rules') ? 'Polaris working rules: unchanged from earlier in this conversation; they still apply.' : rules,
        `Current turn scope: ${work ? 'current task ' + work.id : 'main conversation'}. Apply only this turn's scene instructions; earlier onboarding, timing or recovery scenes do not remain active. Current rules version: ${polarisRulesVersion}.`,
        schedule ? scheduledTurn : '',
        history.trim(), volatile,
        `Polaris business context:\n${same('context') ? 'Unchanged since your previous turn in this conversation.' : business}`, activity && `Current activity:\n${activity}`, `${work ? 'Task instructions' : 'User request'}:\n${job.input}`].filter(Boolean).join('\n\n'))
        + new AgentAttachments(this.store).prompt(attachments.map((item: { id: string }) => item.id));
      if (job.workID && !this.schedules.canStart(job.workID, !!job.outcomeID || job.origin === 'resume')) throw new PolarisError('schedule_inactive', 'This scheduled occurrence is no longer valid.');
      if ((job.workID || job.outcomeID) && !this.store.transaction(() => this.data.inputStatus(job).ready)) throw new PolarisError('execution_dependency', 'Waiting for required inputs.');
      this.data.runs.record(job.id, 'prompt', { bytes: Buffer.byteLength(prompt), contextBytes: command || same('context') ? 0 : Buffer.byteLength(business) });
      this.data.runs.delivery(job.id, 'sent'); submitted = true;
      let result = await active.session.prompt(prompt);
      active.ending = true; await active.inputs;
      if (active.permissionBlocked) throw new PolarisError('work_permission', 'Background work requires native permission.');
      const completedCapabilities = active.session.capabilities;
      this.store.transaction(() => {
        for (const part of parts) if (part.type === 'text') part.complete = true;
        this.data.runs.delivery(job.id, 'completed');
        this.data.setJob(job.id, active.cancelled ? 'cancelled' : result.status === 'cancelled' ? 'cancelled' : 'completed', active.interrupted ? 'app_quit' : '');
        connection.verified.turn ||= result.status === 'completed'; if (result.status === 'cancelled') connection.verified.cancel = true;
        connection.capabilities = completedCapabilities;
        this.store.query('UPDATE agent_job SET capabilities=? WHERE id=?', JSON.stringify(completedCapabilities), job.id);
        if (work && this.data.work(work.id).sessionKey === job.sessionKey) {
          const pending = this.data.pendingDecision(work.id);
          this.data.setWork(work.id, pending ? 'waiting_decision' : active.cancelled || result.status === 'cancelled' ? 'cancelled' : 'completed', this.data.work(work.id).progress, pending);
        }
        if (active.interrupted && work) this.data.continueWork(job, 'resume');
        save(active.cancelled ? 'interrupted' : 'completed');
        this.data.runs.finish(job.id);
      });
    } catch (error) {
      const code = active.permissionBlocked ? 'work_permission' : error instanceof PolarisError ? error.code : 'native_failed';
      // Quitting is not a user cancel: unsent work waits in the queue and sent work resumes in its own session (R-D122).
      const state = active.permissionBlocked && submitted ? 'needs_review' : active.interrupted ? submitted ? 'cancelled' : 'queued' : !submitted && code === 'execution_dependency' ? 'queued' : !submitted && code === 'execution_received' ? 'cancelled' : active.cancelled ? (submitted && job.workID && this.schedules.workContext(job.workID) ? 'needs_review' : 'cancelled') : submitted && ((job.workID && this.schedules.workContext(job.workID)) || ['native_disconnected', 'native_timeout'].includes(code)) ? 'needs_review' : 'failed';
      this.store.transaction(() => {
        this.data.setJob(job.id, state, active.permissionBlocked ? code : active.interrupted && submitted ? 'app_quit' : active.cancelled ? '' : code);
        if (job.workID && this.data.work(job.workID).sessionKey === job.sessionKey) this.data.setWork(job.workID, state, this.data.work(job.workID).progress, this.data.pendingDecision(job.workID));
        if (active.interrupted && submitted && job.workID && !active.permissionBlocked) this.data.continueWork(job, 'resume');
        this.data.runs.delivery(job.id, state === 'needs_review' ? 'unknown' : submitted ? 'failed' : 'not_sent');
        save('interrupted'); this.data.runs.finish(job.id);
      });
    } finally {
      active.ending = true; await active.inputs;
      if (this.store.query("SELECT 1 FROM agent_message WHERE jobID=? AND inputKind='steer' AND state IN ('sending','unknown')", job.id).length) {
        this.data.setJob(job.id, 'needs_review', 'native_delivery_unknown'); this.data.runs.delivery(job.id, 'unknown');
        if (job.workID) { const work = this.data.work(job.workID); this.data.setWork(work.id, 'needs_review', work.progress, work.waitingDecisionID); }
      }
      clearTimeout(saveTimer);
      for (const settle of active.permissions.values()) settle('');
      if (active.session) this.store.query('UPDATE agent_job SET capabilities=? WHERE id=?', JSON.stringify(active.session.capabilities), job.id);
      const retain = !this.stopped && !active.cancelled && this.data.job(job.id)?.delivery === 'completed' && this.data.job(job.id)?.state !== 'needs_review' && (job.kind === 'main' || this.store.query("SELECT 1 FROM agent_job WHERE sessionKey=? AND state='queued'", job.sessionKey!).length);
      if (retain && active.session?.release) {
        try {
          const rpc = await active.session.release();
          if (this.stopped || !this.connections.get(job.provider!)?.enabled) await rpc.close();
          else this.keepIdle(this.transportKey(job, connection), rpc);
        }
        catch { await active.session.close(); }
      } else await active.session?.close();
      await bridge?.close();
      this.mergeRunObservation(connection, connectionEpoch);
    }
  }
  private mergeRunObservation(observation: NativeConnection, epoch: number) {
    const current = this.connections.get(observation.provider);
    if (!current || (this.connectionEpochs.get(observation.provider) ?? 0) !== epoch || current.account !== observation.account || current.version !== observation.version) return;
    const observed = { capabilities: observation.capabilities, models: observation.models, modelControl: observation.modelControl,
      verified: Object.fromEntries(Object.entries(current.verified).map(([key, value]) => [key, value || observation.verified[key as keyof typeof observation.verified]])) as NativeConnection['verified'] };
    if (isDeepStrictEqual(observed, { capabilities: current.capabilities, models: current.models, modelControl: current.modelControl, verified: current.verified })) return;
    this.saveConnection({ ...current, ...structuredClone(observed) }, false);
  }
  private project(parts: AgentPart[], event: NativeEvent) {
    if (event.type === 'text') {
      let part = parts.find(part => part.type === 'text' && part.id === (event.nativeID ?? event.localID)) as Extract<AgentPart, { type: 'text' }> | undefined;
      if (!part) { part = { type: 'text', id: event.nativeID ?? event.localID, text: '', startedAt: event.timestamp ?? new Date().toISOString(), receivedAt: new Date().toISOString(), timeSource: event.timestamp ? 'native' : 'received' }; parts.push(part); }
      part.text = event.replace ? event.text ?? '' : part.text + (event.text ?? '');
      if (event.phase) { part.nativePhase = event.phase; if (['commentary', 'partial_answer', 'final_answer'].includes(event.phase)) part.phase = event.phase as typeof part.phase; }
      if (event.complete !== undefined) part.complete = event.complete;
    }
    if (event.type === 'tool') {
      const data = event.data ?? {}, id = event.nativeID; if (!id) return;
      let call = parts.flatMap(part => part.type === 'activity' ? part.calls : []).find(call => call.id === id);
      if (!call) {
        call = { id, nativeID: id, name: data.tool ?? data.type ?? data.title ?? 'Tool', state: 'running', startedAt: event.timestamp ?? new Date().toISOString(), receivedAt: new Date().toISOString(), timeSource: event.timestamp ? 'native' : 'received' };
        let last = parts.at(-1); if (last?.type !== 'activity') { last = { type: 'activity', calls: [] }; parts.push(last); } last.calls.push(call);
      }
      if (typeof data._meta?.claudeCode?.toolName === 'string') call.name = data._meta.claudeCode.toolName;
      if (data.source === 'files' || data.source === 'web') call.source = data.source;
      call.kind = data.kind ?? call.kind; call.title = data.title ?? call.title;
      if (!data.outputDelta) call.nativeDetails = JSON.stringify(data, (key, value) => /^(authorization|access_token|refresh_token|api_key|password|secret)$/i.test(key) ? '[redacted]' : value, 2).slice(0, 12000);
      if (data.command) { call.name = 'shell'; call.input = String(data.command); }
      else if (data.rawInput !== undefined || data.arguments !== undefined) call.input = JSON.stringify(data.rawInput ?? data.arguments, null, 2).slice(0, 12000);
      else if (data.changes) call.input = JSON.stringify(data.changes, null, 2).slice(0, 12000);
      const output = data.rawOutput ?? data.aggregatedOutput ?? data.result ?? data.content;
      if (output !== undefined) call.output = (typeof output === 'string' ? output : JSON.stringify(output, null, 2)).slice(0, 12000);
      if (data.outputDelta) call.output = ((call.output ?? '') + data.outputDelta).slice(-12000);
      if (data.error) { call.error = { code: 'native_tool', message: (typeof data.error === 'string' ? data.error : data.error.message ?? JSON.stringify(data.error)).slice(0, 1000) }; }
      if (data.status) call.state = ({ pending: 'running', in_progress: 'running', inProgress: 'running', completed: 'completed', failed: 'failed', declined: 'failed' } as Record<string,string>)[data.status] ?? data.status;
      if (event.complete) call.state = ['failed', 'declined', 'cancelled'].includes(data.status) || data.error ? 'failed' : 'completed';
      if (call.state !== 'running') call.completedAt = event.timestamp ?? new Date().toISOString();
      return call;
    }
  }
  running() { return this.active.size > 0; }
  async stop() {
    this.stopped = true; this.modelProbeAbort.abort();
    await Promise.allSettled([...this.modelProbes.values()].map(probe => probe.value)); this.modelProbes.clear();
    this.schedules.stop(); clearTimeout(this.timer);
    const probes = [...this.probes.values()]; for (const probe of probes) probe.controller.abort();
    await Promise.allSettled(probes.map(probe => probe.done));
    await this.clearIdle();
    await Promise.all([...this.active.values()].map(active => this.cancel(active.job.id, true)));
    await Promise.allSettled([...this.active.values()].map(item => item.done));
  }
}
