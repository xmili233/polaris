import { taskInputs, saveInputs, inputStatus } from './execution-inputs.js';
import { Executions } from './execution.js';
import { KnowledgeStore } from './knowledge.js';
import { matchLanguage, translator } from '@polaris/i18n';
import { randomUUID } from 'node:crypto';
import { PolarisStore } from './store.js';
import { type Outcome, PolarisError, now, requireText } from './model.js';
import type { AgentAttachment } from './agent-attachments.js';
import { AgentRuns } from './agent-runs.js';

export type ProviderID = 'claude-code' | 'chatgpt-codex' | 'gemini-cli' | 'opencode';
export type JobState = 'queued' | 'running' | 'waiting_connection' | 'waiting_decision' | 'completed' | 'failed' | 'cancelled' | 'needs_review';
export interface AgentJob { id: string; kind: 'main' | 'work'; workID: string | null; input: string; outcomeID: string | null; outcomeContextID?: string | null; title?: string | null; handoffDecisionID?: string | null; state: JobState; error: string; createdAt: string; acceptedAt?: string | null; startedAt?: string | null; completedAt?: string | null; provider?: ProviderID; sessionKey?: string; nativeRunID?: string; delivery?: string; generation?: number; origin?: string }
const resumeInstruction = 'Polaris was quit while you were working on this task, so your previous turn stopped early. Your earlier messages and tool results in this conversation are preserved. Before acting, check what you already completed, including external actions, and do not repeat them. Then continue the remaining work of this task.';
const retryInstruction = 'Your previous turn stopped early. Review the earlier messages and tool results, and verify what already happened before acting. Continue only the remaining authorized work. If you cannot verify whether an external action happened, leave that action untouched and ask through a decision card.';
const autoAdvanceKey = 'strategy_auto_advance:';
export interface AgentWork { id: string; strategyID: string; title: string; instructions: string; progress: string; state: JobState; waitingDecisionID: string | null; provider?: ProviderID; sessionKey?: string }
export interface ToolFailure { code: string; message: string }
export interface AgentToolCall {
  id: string; name: string; state: string; error?: ToolFailure;
  input?: string; output?: string; startedAt?: string; completedAt?: string;
  nativeDetails?: string;
  source?: 'files' | 'web'; kind?: string; title?: string; nativeID?: string; timeSource?: 'received' | 'native'; receivedAt?: string;
}
export type AgentPhase = 'commentary' | 'partial_answer' | 'final_answer';
export type AgentPart = { type: 'text'; text: string; id?: string; phase?: AgentPhase; nativePhase?: string; complete?: boolean; startedAt?: string; timeSource?: 'received' | 'native'; receivedAt?: string } | { type: 'activity'; calls: AgentToolCall[] };
export interface AgentMessage { id: string; role: 'user' | 'assistant'; body: string; state: string; createdAt: string; parts?: AgentPart[]; attachments?: AgentAttachment[]; provider?: ProviderID; nativeSessionID?: string; jobID?: string | null; inputKind?: string | null }
export interface AgentWorkSummary extends Pick<AgentWork, 'id' | 'strategyID' | 'title' | 'state' | 'waitingDecisionID' | 'provider' | 'sessionKey'> { createdAt: string | null; startedAt: string | null; lastJobID: string | null; error: string }
export interface AgentSnapshot { waitingFor?: Record<string, ReturnType<AgentStore['inputStatus']>>; work?: AgentWork; canSend?: boolean; retryJobID?: string; sessionKey?: string; messages: AgentMessage[]; jobs: AgentJob[]; decisionCards?: { id: string; title: string; jobID: string }[]; artifacts: { id: string; title: string; body: string }[]; revision: number; native?: { modelSettings?: import('./agents/types.js').ModelSettings; model?: string; activeJobIDs: string[]; selected: ProviderID; sub?: { provider: ProviderID; model: string; settings?: import('./agents/types.js').ModelSettings } | null; connections: import('./agents/types.js').NativeConnection[]; permissions: import('./agents/types.js').NativePermission[] } }

export class AgentStore {
  revision = 0;
  readonly runs: AgentRuns;
  readonly executions: Executions;
  readonly knowledge: KnowledgeStore;
  constructor(readonly store: PolarisStore) {
    this.runs = new AgentRuns(store);
    this.executions = new Executions(store);
    this.knowledge = new KnowledgeStore(store);
  }
  changed() { this.revision++; }
  snapshot(): AgentSnapshot {
    const { store } = this;
    return {
      messages: store.query(`SELECT m.* FROM agent_message m JOIN agent_job j
        ON m.jobID=j.id OR m.id=j.id||':user' OR m.id=j.id||':assistant'
        WHERE j.kind='main' AND (j.id IN (SELECT id FROM agent_job WHERE kind='main' ORDER BY seq DESC LIMIT 100) OR (j.provider IS NOT NULL AND j.state IN ('queued','running','waiting_connection')))
        ORDER BY j.seq,CASE m.role WHEN 'user' THEN 0 ELSE 1 END,m.seq`)
        .map(row => ({ ...row, parts: JSON.parse(String(row.parts)), attachments: JSON.parse(String(row.attachments)) })) as unknown as AgentMessage[],
      jobs: store.query(`SELECT id,kind,workID,input,outcomeID,state,error,createdAt,startedAt,completedAt,provider,sessionKey,nativeRunID,delivery FROM agent_job
        WHERE kind='main' AND provider IS NOT NULL AND (state IN ('queued','running','waiting_connection','failed')
        OR id IN (SELECT id FROM agent_job WHERE kind='main' ORDER BY seq DESC LIMIT 100)) ORDER BY seq DESC`) as unknown as AgentJob[],
      artifacts: [], revision: this.revision,
    };
  }
  decisionCards(work?: AgentWork) {
    return this.store.query(`SELECT d.id,json_extract(d.payload,'$.title') AS title,h.sourceJobID AS jobID
      FROM decision_source h JOIN decision d ON d.id=h.decisionID JOIN agent_job j ON j.id=h.sourceJobID
      WHERE d.status='active' AND ((? IS NULL AND j.kind='main') OR (j.workID=? AND j.sessionKey=?))
      AND NOT EXISTS(SELECT 1 FROM outcome o WHERE o.decision_id=d.id AND o.active=1)
      ORDER BY h.rowid`, work?.id ?? null, work?.id ?? null, work?.sessionKey ?? null) as unknown as AgentSnapshot['decisionCards'];
  }
  workList(): AgentWorkSummary[] {
    return this.store.query(`SELECT w.id,w.strategyID,w.title,w.provider,w.sessionKey,w.waitingDecisionID,j.createdAt,j.startedAt,j.id AS lastJobID,j.error,j.state
      FROM agent_work w JOIN strategy s ON s.id=w.strategyID JOIN goal g ON g.id=s.parent_id
      JOIN agent_job j ON j.id=(SELECT id FROM agent_job WHERE workID=w.id AND sessionKey=w.sessionKey
        AND state IN ('running','queued','waiting_connection') ORDER BY CASE state WHEN 'running' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,seq LIMIT 1)
      WHERE w.provider IS NOT NULL AND w.state<>'waiting_decision' AND s.status='active' AND g.status='active'
      ORDER BY (SELECT MIN(seq) FROM agent_job WHERE sessionKey=w.sessionKey)`).filter(w => !this.unresolvedRun(String(w.sessionKey))) as unknown as AgentWorkSummary[];
  }
  unresolvedRun(sessionKey: string): AgentJob | undefined {
    return this.store.query(`SELECT j.* FROM agent_job j WHERE j.sessionKey=? AND j.state='needs_review' ORDER BY j.seq DESC LIMIT 1`, sessionKey)[0] as unknown as AgentJob | undefined;
  }
  activeStrategyWork(strategyID: string) {
    // Card executions and decision preparation are separate from strategy rounds.
    return this.store.query(`SELECT w.id FROM agent_work w JOIN agent_job j ON j.workID=w.id WHERE w.strategyID=? AND j.provider IS NOT NULL AND j.outcomeID IS NULL AND j.outcomeContextID IS NULL
      AND NOT EXISTS(SELECT 1 FROM agent_job source WHERE source.workID=w.id AND source.origin='auto_advance')
      AND j.state IN ('queued','running','waiting_connection') AND j.seq=(SELECT MAX(seq) FROM agent_job WHERE workID=w.id) ORDER BY j.seq DESC LIMIT 1`, strategyID)[0];
  }
  uncertainStrategyRuns(strategyID: string): AgentJob[] {
    return this.store.query(`SELECT j.* FROM agent_job j JOIN agent_work w ON w.id=j.workID
      WHERE w.strategyID=? AND j.provider IS NOT NULL AND j.state='needs_review'
      AND NOT EXISTS(SELECT 1 FROM agent_run_review r WHERE r.jobID=j.id AND r.generation=j.generation)
      ORDER BY j.seq`, strategyID) as unknown as AgentJob[];
  }
  requireResolved(strategyID: string) {
    if (this.uncertainStrategyRuns(strategyID).length) throw new PolarisError('conflict', 'Inspect actual effects and resolve the uncertain run before starting more work.', 'loop.reviewRequired');
  }
  resolveRun(id: string, generation: number, completed: boolean, evidence: string) {
    requireText(evidence, 'Evidence', 4000);
    return this.store.transaction(() => {
      const job = this.job(id);
      if (!job || job.state !== 'needs_review' || job.generation !== generation || !job.workID)
        throw new PolarisError('conflict', 'The uncertain run changed; inspect it again.');
      const prior = this.store.query('SELECT payload FROM agent_run_review WHERE jobID=? AND generation=?', id, generation)[0];
      if (prior) throw new PolarisError('conflict', 'This run has already been resolved.');
      this.store.query('INSERT INTO agent_run_review(jobID,generation,payload) VALUES(?,?,?)', id, generation,
        JSON.stringify({ completed, evidence, createdAt: new Date().toISOString() }));
      this.runs.record(id, 'effects_verified', { completed, evidence });
      return { resolved: true, completed };
    });
  }
  startStrategy(strategyID: string, note: string, language: string, queue: (input: string, workID: string) => void) {
    return this.store.transaction(() => {
      const strategy = this.store.get('strategy', strategyID);
      if (!this.store.isStrategyActive(strategyID)) throw new PolarisError('conflict', 'The strategy is no longer active.');
      this.requireResolved(strategyID);
      const busy = this.activeStrategyWork(strategyID);
      if (busy) return { workID: String(busy.id), status: 'already_running' };
      const instruction = translator(matchLanguage(language) ?? 'en')('schedule.runStrategy', { title: strategy.title });
      const input = `${instruction}${note.trim() ? `\n\n${note.trim()}` : ''}`;
      const target = this.createWork(strategyID, strategy.title, input);
      queue(input, target.id);
      return { workID: target.id, status: 'started' };
    });
  }
  hasPendingCards(strategyID: string) {
    return !!this.store.query(`SELECT 1 FROM decision d WHERE d.parent_id=? AND d.status='active'
      AND NOT EXISTS(SELECT 1 FROM outcome o WHERE o.decision_id=d.id AND o.active=1) LIMIT 1`, strategyID).length;
  }
  autoAdvanceStrategies() {
    return this.store.query(`SELECT s.id FROM strategy s JOIN goal g ON g.id=s.parent_id
      WHERE s.status='active' AND g.status='active'`).map(row => String(row.id));
  }
  activeStrategyHandoff(strategyID: string) {
    return this.store.query(`SELECT j.* FROM agent_job j JOIN outcome o ON o.id=j.outcomeID JOIN decision d ON d.id=o.decision_id
      WHERE d.parent_id=? AND o.active=1 AND j.state IN ('queued','running','waiting_connection','needs_review')
      ORDER BY CASE j.state WHEN 'needs_review' THEN 1 WHEN 'running' THEN 2 ELSE 3 END,j.seq LIMIT 1`, strategyID)[0] as unknown as AgentJob | undefined;
  }
  activeDecisionPreparation(strategyID: string) {
    return this.store.query(`SELECT j.state FROM agent_job j JOIN agent_work w ON w.id=j.workID WHERE w.strategyID=? AND j.sessionKey=w.sessionKey
      AND j.state IN ('queued','running','waiting_connection')
      AND EXISTS(SELECT 1 FROM agent_job source WHERE source.workID=w.id AND source.origin='auto_advance')
      ORDER BY j.seq DESC LIMIT 1`, strategyID)[0]?.state as 'queued' | 'running' | 'waiting_connection' | undefined;
  }
  takeAutoAdvance(strategyID: string) {
    const key = autoAdvanceKey + strategyID, row = this.store.query('SELECT value FROM metadata WHERE key=?', key)[0];
    if (!this.store.isStrategyActive(strategyID)) return false;
    const value = String(row?.value ?? 'ready');
    if (this.hasPendingCards(strategyID)) {
      if (value !== 'ready') this.store.query("UPDATE metadata SET value='ready' WHERE key=?", key);
      return false;
    }
    if (value === 'prepared' || this.activeDecisionPreparation(strategyID) || this.activeStrategyHandoff(strategyID)
      || this.uncertainStrategyRuns(strategyID).length) return false;
    const afterJobID = value.startsWith('{') ? (JSON.parse(value) as { afterJobID: string }).afterJobID : undefined;
    if (afterJobID && this.job(afterJobID)?.state !== 'completed') return false;
    this.store.query("INSERT INTO metadata(key,value) VALUES(?,'prepared') ON CONFLICT(key) DO UPDATE SET value=excluded.value", key);
    return true;
  }
  isAutoAdvanceWork(workID: string) {
    return !!this.store.query("SELECT 1 FROM agent_job WHERE workID=? AND origin='auto_advance' LIMIT 1", workID).length;
  }
  workSnapshot(id: string, sessionKey?: string): AgentSnapshot {
    const work = { ...this.work(id) };
    if (sessionKey && sessionKey !== work.sessionKey) {
      const last = this.store.query('SELECT * FROM agent_job WHERE workID=? AND sessionKey=? ORDER BY seq DESC LIMIT 1', id, sessionKey)[0];
      if (!last) throw new PolarisError('not_found', 'Task record not found.');
      Object.assign(work, { sessionKey, provider: last.provider, state: last.state, title: last.title ?? work.title, instructions: last.input, progress: '', waitingDecisionID: null });
    }
    const messages = this.store.query(`SELECT m.* FROM agent_message m JOIN agent_job j ON m.jobID=j.id OR m.id=j.id||':user' OR m.id=j.id||':assistant'
      WHERE j.workID=? AND j.sessionKey=? ORDER BY j.seq,CASE m.role WHEN 'user' THEN 0 ELSE 1 END,m.seq`, id, work.sessionKey ?? null)
      .map(row => ({ ...row, parts: JSON.parse(String(row.parts)), attachments: JSON.parse(String(row.attachments)) })) as unknown as AgentMessage[];
    const jobs = this.store.query('SELECT * FROM agent_job WHERE workID=? AND sessionKey=? ORDER BY seq DESC', id, work.sessionKey ?? null) as unknown as AgentJob[];
    // Older runs and automatic starts have no user bubble. Show their actual instructions, never another chat's messages.
    for (const job of [...jobs].reverse()) if (!messages.some(m => m.id === `${job.id}:user`)) {
      let body = job.input;
      if (job.origin === 'auto_advance') body = translator(matchLanguage(process.env.POLARIS_LANGUAGE) ?? 'en')('work.autoAdvance');
      else if (job.origin === 'resume' || job.origin === 'retry') body = translator(matchLanguage(process.env.POLARIS_LANGUAGE) ?? 'en')(job.origin === 'retry' ? 'common.retry' : 'work.resumedAfterQuit');
      else if (job.outcomeID) {
        const outcome = this.store.outcomes().find(o => o.id === job.outcomeID);
        if (!outcome) continue;
        const decision = this.store.get('decision', outcome.decisionID);
        body = translator(matchLanguage(process.env.POLARIS_LANGUAGE) ?? 'en')(outcome.withdrawnAt ? 'work.decisionWithdrawn' : 'work.decisionConfirmed', { title: decision.title, choice: decision.options.find(o => o.id === outcome.optionID)?.label ?? outcome.note });
      }
      const index = messages.findIndex(m => m.id === `${job.id}:assistant`);
      messages.splice(index < 0 ? messages.length : index, 0, { id: `${job.id}:user`, role: 'user', body, state: 'completed', createdAt: job.createdAt });
    }
    return { work, messages, jobs, artifacts: this.store.query('SELECT a.id,a.title,a.body FROM agent_artifact a JOIN agent_job j ON j.id=a.jobID WHERE a.workID=? AND j.sessionKey=?', id, work.sessionKey ?? null) as unknown as AgentSnapshot['artifacts'], revision: this.revision };
  }
  inputStatus(job: AgentJob) { return inputStatus(this.store, job); }
  inputs(job: AgentJob) { return taskInputs(this.store, job); }
  setInputs(jobID: string, input: unknown) { saveInputs(this.store, jobID, input); }
  readArtifact(job: AgentJob, id: string) {
    const item = this.store.query('SELECT id,title,body,workID FROM agent_artifact WHERE id=?', id)[0];
    if (!item || (job.workID && item.workID !== job.workID && !this.inputs(job).artifactIDs.includes(id))) throw new PolarisError('not_found', 'Artifact not found in this task.', 'execution.inputMissing');
    return item;
  }
  pendingDecision(workID: string): string | null {
    const row = this.store.query(`SELECT d.decisionID FROM decision_source d JOIN decision c ON c.id=d.decisionID JOIN agent_job j ON j.id=d.sourceJobID WHERE j.workID=? AND c.status='active'
      AND NOT EXISTS(SELECT 1 FROM outcome o WHERE o.decision_id=c.id AND o.active=1) ORDER BY d.rowid LIMIT 1`, workID)[0];
    return row ? String(row.decisionID) : null;
  }
  liveInput(job: AgentJob, id: string, text: string, attachments: AgentAttachment[]) {
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) throw new PolarisError('invalid_input', 'Invalid request ID.');
    if (typeof text !== 'string' || text.length > 20000 || (!text.trim() && !attachments.length)) throw new PolarisError('invalid_input', 'Invalid message.');
    id = id.toLowerCase();
    if (this.job(id) || this.store.query('SELECT 1 FROM agent_message WHERE id=?', `${id}:user`).length) throw new PolarisError('conflict', 'Request ID already used.');
    this.store.query("INSERT INTO agent_message(id,role,body,state,createdAt,attachments,provider,jobID,inputKind) VALUES(?,'user',?,'sending',?,?,?,?,?)",
      `${id}:user`, text.trim(), now(), JSON.stringify(attachments), job.provider!, job.id, 'steer');
    this.runs.record(job.id, 'input', { requestID: id, kind: 'steer', state: 'sending' });
    this.changed(); return id;
  }
  inputState(id: string, state: 'accepted' | 'sent' | 'unknown') {
    const message = this.store.query('SELECT jobID,inputKind FROM agent_message WHERE id=?', `${id}:user`)[0];
    if (!message?.jobID) return;
    this.store.transaction(() => {
      this.store.query('UPDATE agent_message SET state=? WHERE id=?', state, `${id}:user`);
      this.runs.record(String(message.jobID), 'input', { requestID: id, kind: message.inputKind, state });
    }); this.changed();
  }
  /** Continue in the same native session, which keeps the evidence of what already ran. */
  continueWork(job: AgentJob, origin: 'resume' | 'retry') {
    const id = randomUUID(), work = this.work(job.workID!), instruction = origin === 'retry' ? retryInstruction : resumeInstruction;
    this.store.query("INSERT INTO agent_job(id,kind,workID,input,state,createdAt,provider,sessionKey,origin,title,outcomeContextID) VALUES(?,'work',?,?,'queued',?,?,?,?,?,?)",
      id, work.id, instruction, now(), job.provider ?? null, job.sessionKey ?? null, origin, job.title ?? work.title, job.outcomeID ?? job.outcomeContextID ?? null);
    this.setWork(work.id, 'queued', work.progress, work.waitingDecisionID);
    return id;
  }
  job(id: string) { return this.store.query('SELECT * FROM agent_job WHERE id=?', id)[0] as unknown as AgentJob | undefined; }
  work(id: string) {
    const value = this.store.query('SELECT * FROM agent_work WHERE id=?', id)[0] as unknown as AgentWork | undefined;
    if (!value) throw new PolarisError('not_found', 'Work not found.');
    return value;
  }
  queue(kind: 'main' | 'work', input: string, workID: string | null = null, outcomeID: string | null = null) {
    const id = randomUUID();
    this.store.query('INSERT INTO agent_job(id,kind,input,workID,outcomeID,state,createdAt,title) VALUES(?,?,?,?,?,?,?,?)', id, kind, input, workID, outcomeID, 'queued', now(), workID ? this.work(workID).title : null);
    this.changed(); return id;
  }
  send(text: string, requestID: string = randomUUID(), attachments: AgentAttachment[] = []) {
    if (attachments.length) { if (typeof text !== 'string' || text.length > 20000) throw new PolarisError('invalid_input', 'Invalid message.'); }
    else requireText(text, 'message');
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(requestID)) throw new PolarisError('invalid_input', 'Invalid request ID.');
    return this.store.transaction(() => {
      const id = requestID.toLowerCase(), existing = this.job(id);
      if (existing) {
        if (existing.kind !== 'main' || existing.input !== text.trim()) throw new PolarisError('conflict', 'Request ID already used.');
        if (String(this.store.query('SELECT attachments FROM agent_message WHERE id=?', `${id}:user`)[0]?.attachments ?? '[]') !== JSON.stringify(attachments)) throw new PolarisError('conflict', 'Request ID already used with other attachments.');
        return id;
      }
      this.store.query('INSERT INTO agent_job(id,kind,input,state,createdAt) VALUES(?,?,?,?,?)', id, 'main', text.trim(), 'queued', now());
      this.changed();
      this.store.query('INSERT INTO agent_message(id,role,body,state,createdAt,attachments) VALUES(?,?,?,?,?,?)', `${id}:user`, 'user', text.trim(), 'completed', now(), JSON.stringify(attachments));
      return id;
    });
  }
  createWork(strategyID: string, title: string, instructions: string) {
    requireText(title, 'title', 160); requireText(instructions, 'instructions');
    const strategy = this.store.get('strategy', strategyID);
    const goal = this.store.get('goal', strategy.goalID);
    if ([strategy, goal].some(item => item.status !== 'active')) throw new PolarisError('conflict', 'Strategy is not active.');
    const id = randomUUID();
    this.store.query('INSERT INTO agent_work(id,strategyID,title,instructions,state) VALUES(?,?,?,?,?)', id, strategyID, title, instructions, 'queued');
    this.changed(); return this.work(id);
  }
  enqueueOutcome(outcome: Outcome, provider: ProviderID, sessionKey: string) {
    return this.store.transaction(() => {
      if (this.store.query('SELECT id FROM agent_job WHERE outcomeID=?', outcome.id).length) return;
      const decision = this.store.get('decision', outcome.decisionID);
      const source = this.store.query('SELECT j.id AS jobID,w.id AS workID,w.title,w.instructions,w.progress,j.state FROM decision_source d JOIN agent_job j ON j.id=d.sourceJobID JOIN agent_work w ON w.id=j.workID WHERE d.decisionID=?', decision.id)[0] ?? null;
      const input = JSON.stringify({ source, instruction: 'The user confirmed this card. Read the current plan, apply only accepted changes, and dispatch only the remaining authorized work with its required inputs. Do not repeat completed actions.', decision, outcome });
      const id = this.queue('main', input, null, outcome.id);
      this.setInputs(id, decision.inputs);
      this.store.query('UPDATE agent_job SET provider=?,sessionKey=?,title=? WHERE id=?', provider, sessionKey, decision.title, id);
      const answer = decision.options.find(option => option.id === outcome.optionID)?.label ?? outcome.note;
      this.store.query("INSERT INTO agent_message(id,role,body,state,createdAt,provider,jobID) VALUES(?,'user',?,'completed',?,?,?)", `${id}:user`, `${decision.title}\n\n${answer}`, now(), provider, id);
      if (!this.hasPendingCards(decision.strategyID)) {
        this.store.query('INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', autoAdvanceKey + decision.strategyID, JSON.stringify({ afterJobID: id }));
      }
      return id;
    });
  }
  reconcileOutcomes(provider: ProviderID, sessionKey: string) {
    const ids: string[] = [];
    for (const row of this.store.query(`SELECT o.payload FROM outcome o JOIN decision_source s ON s.decisionID=o.decision_id
      LEFT JOIN agent_job j ON j.outcomeID=o.id WHERE o.active=1 AND o.acknowledged=0 AND j.id IS NULL`)) {
      const id = this.enqueueOutcome(JSON.parse(String(row.payload)), provider, sessionKey); if (id) ids.push(id);
    }
    // Only unsent jobs are moved here by the one-time migration.
    for (const row of this.store.query("SELECT id FROM agent_job WHERE kind='main' AND outcomeID IS NOT NULL AND provider IS NULL AND acceptedAt IS NULL AND state IN ('queued','waiting_connection')")) {
      this.store.query('UPDATE agent_job SET provider=?,sessionKey=? WHERE id=?', provider, sessionKey, String(row.id)); ids.push(String(row.id));
    }
    return ids;
  }
  setJob(id: string, state: JobState, error = '') {
    this.store.transaction(() => {
      const previous = this.job(id);
      if (state === 'waiting_decision' && previous?.workID) this.store.query('UPDATE agent_job SET handoffDecisionID=? WHERE id=?', this.work(previous.workID).waitingDecisionID, id);
      if (state === 'running') this.store.query('UPDATE agent_job SET startedAt=?,completedAt=NULL WHERE id=?', new Date().toISOString(), id);
      else if (state !== 'queued') this.store.query('UPDATE agent_job SET completedAt=COALESCE(completedAt,?) WHERE id=?', new Date().toISOString(), id);
      this.store.query('UPDATE agent_job SET state=?,error=? WHERE id=?', state, error, id);
      if (previous?.provider && (previous.state !== state || previous.error !== error)) this.runs.record(id, 'state', { from: previous.state, state, error });
    });
    this.changed();
  }
  setWork(id: string, state: JobState, progress: string, waiting: string | null = null) {
    this.store.query('UPDATE agent_work SET state=?,progress=?,waitingDecisionID=? WHERE id=?', state, progress, waiting, id); this.changed();
  }
  message(id: string, body: string, state = 'running', parts: AgentPart[] = []) {
    this.store.query(`INSERT INTO agent_message(id,role,body,state,createdAt,parts) VALUES(?,'assistant',?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET body=excluded.body,state=excluded.state,parts=excluded.parts`, `${id}:assistant`, body, state, now(), JSON.stringify(parts)); this.changed();
  }
  saveProgress(progress: string) { this.store.query("UPDATE agent_session SET progress=? WHERE id='main'", progress); }
  context(job?: AgentJob, goalID = '') {
    const work = job?.workID ? this.work(job.workID) : null;
    const scopedGoalID = work ? this.store.get('strategy', work.strategyID).goalID : goalID;
    const board = scopedGoalID ? this.store.snapshot(false, scopedGoalID) : null;
    if (board && work) {
      board.strategies = board.strategies.filter(strategy => strategy.id === work.strategyID);
      board.decisions = board.decisions.filter(card => card.strategyID === work.strategyID);
    }
    const input = job ? this.inputs(job) : { artifactIDs: [], knowledgeIDs: [] };
    const missing = job ? this.inputStatus(job).missing : [];
    return {
      goals: this.store.records('goal').filter(goal => goal.status === 'active' && (!work || goal.id === scopedGoalID)).map(({ id, title }) => ({ id, title })),
      board, work, inputs: { ...input, missing },
      progress: work?.progress ?? String(this.store.query("SELECT progress FROM agent_session WHERE id='main'")[0]?.progress ?? ''),
      runs: this.runs.overview(work?.sessionKey), knowledge: this.knowledge.overview(scopedGoalID || undefined),
      artifacts: work ? this.store.query('SELECT a.id,a.title FROM agent_artifact a JOIN agent_job j ON j.id=a.jobID WHERE a.workID=? AND j.sessionKey=?', work.id, work.sessionKey ?? null)
        : this.store.query('SELECT id,title,workID FROM agent_artifact ORDER BY rowid DESC LIMIT 50'),
    };
  }
}
