import { createHash } from 'node:crypto';
import type { AgentJob, AgentToolCall } from './agent-store.js';
import { PolarisStore } from './store.js';
import { encode, PolarisError } from './model.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class AgentRuns {
  constructor(readonly store: PolarisStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS agent_run_event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,jobID TEXT NOT NULL REFERENCES agent_job(id),generation INTEGER NOT NULL,
      eventKey TEXT,type TEXT NOT NULL,payload TEXT NOT NULL,createdAt TEXT NOT NULL,UNIQUE(jobID,generation,eventKey));
      CREATE INDEX IF NOT EXISTS agent_run_events ON agent_run_event(jobID,seq);
      CREATE TABLE IF NOT EXISTS agent_run_result (
        jobID TEXT NOT NULL REFERENCES agent_job(id),generation INTEGER NOT NULL,payload TEXT NOT NULL,
        updatedAt TEXT NOT NULL,finalizedAt TEXT,PRIMARY KEY(jobID,generation));`);
  }
  private job(id: string) {
    const job = this.store.query('SELECT * FROM agent_job WHERE id=?', id)[0] as unknown as AgentJob | undefined;
    if (!job) throw new PolarisError('not_found', 'Run not found.');
    return job;
  }
  record(id: string, type: string, data: Record<string, unknown> = {}, key: string | null = null) {
    const job = this.job(id);
    if (!job.provider) return false;
    const session = this.store.query('SELECT nativeSessionID FROM agent_session WHERE id=? AND provider=?', job.sessionKey ?? '', job.provider ?? '')[0];
    const payload = { ...data, provider: job.provider, sessionKey: job.sessionKey, nativeSessionID: session?.nativeSessionID ?? null, nativeRunID: job.nativeRunID ?? null };
    return this.store.query('INSERT OR IGNORE INTO agent_run_event(jobID,generation,eventKey,type,payload,createdAt) VALUES(?,?,?,?,?,?) RETURNING seq',
      id, job.generation ?? 0, key, type, encode(payload), new Date().toISOString()).length > 0;
  }
  delivery(id: string, delivery: string) {
    this.store.transaction(() => {
      const job = this.job(id);
      if (job.delivery === delivery) return;
      this.store.query('UPDATE agent_job SET delivery=? WHERE id=?', delivery, id);
      this.record(id, 'delivery', { from: job.delivery, delivery });
    });
  }
  inspect(id: string, after = 0, generation?: number) {
    const job = this.job(id);
    const events = this.store.query('SELECT seq,generation,type,payload,createdAt FROM agent_run_event WHERE jobID=? AND seq>? AND (? IS NULL OR generation=?) ORDER BY seq LIMIT 100', id, after, generation ?? null, generation ?? null)
      .map(({ payload, ...event }) => ({ ...event, seq: event.seq as number, data: JSON.parse(String(payload)) }));
    const result = this.store.query('SELECT generation,payload,updatedAt,finalizedAt FROM agent_run_result WHERE jobID=? AND generation=?', id, generation ?? job.generation ?? 0)[0];
    return { jobID: id, workID: job.workID, sessionKey: job.sessionKey, state: job.state, delivery: job.delivery, generation: job.generation ?? 0,
      result: result ? { ...JSON.parse(String(result.payload)), generation: result.generation, updatedAt: result.updatedAt, finalizedAt: result.finalizedAt } : null,
      events, nextAfter: events.at(-1)?.seq ?? after };
  }
  overview(sessionKey?: string) {
    return this.store.query(`SELECT j.id AS jobID,j.workID,j.state,j.delivery,j.generation,
      r.finalizedAt,
      EXISTS(SELECT 1 FROM agent_run_event e WHERE e.jobID=j.id AND e.generation=j.generation AND e.type='stalled') AS suspectedStall
      FROM agent_job j LEFT JOIN agent_run_result r ON r.jobID=j.id AND r.generation=j.generation
      WHERE j.provider IS NOT NULL AND (? IS NULL OR j.sessionKey=?) ORDER BY j.seq DESC LIMIT 30`, sessionKey ?? null, sessionKey ?? null);
  }
  private finalizeResult(job: AgentJob, result: Record<string, unknown>) {
    const payload = encode(result), previous = this.store.query('SELECT payload,finalizedAt FROM agent_run_result WHERE jobID=? AND generation=?', job.id, job.generation ?? 0)[0];
    if (previous?.payload === payload && previous.finalizedAt) return result;
    const time = new Date().toISOString();
    this.store.query(`INSERT INTO agent_run_result(jobID,generation,payload,updatedAt,finalizedAt) VALUES(?,?,?,?,?)
      ON CONFLICT(jobID,generation) DO UPDATE SET payload=excluded.payload,updatedAt=excluded.updatedAt,finalizedAt=excluded.finalizedAt`,
    job.id, job.generation ?? 0, payload, time, time);
    this.record(job.id, 'result_finalized', { state: job.state });
    return result;
  }
  finish(id: string) {
    const job = this.job(id);
    if (!job.provider || !job.workID || !['completed', 'failed', 'cancelled', 'needs_review'].includes(job.state)) return;
    this.store.transaction(() => {
      const artifacts = this.store.query(`SELECT a.id,a.title FROM agent_artifact a JOIN agent_job source ON source.id=a.jobID
        WHERE source.sessionKey=? AND source.seq<=(SELECT seq FROM agent_job WHERE id=?) ORDER BY a.rowid DESC LIMIT 20`, job.sessionKey ?? '', id);
      const previous = this.store.query("SELECT json_extract(payload,'$.summary') AS summary FROM agent_run_result WHERE jobID=? AND generation=?", id, job.generation ?? 0)[0];
      const result = { summary: String(this.store.query('SELECT body FROM agent_message WHERE id=?', `${id}:assistant`)[0]?.body || previous?.summary || '').slice(0, 4000), artifacts };
      this.finalizeResult(job, result);
    });
  }
  observeTools(id: string, generation: number) {
    const started = new Set<string>(), finished = new Set<string>();
    let previous = '', repeats = 0;
    return (call: AgentToolCall, details: boolean) => {
      if (this.job(id).generation !== generation) return;
      const name = /^[\w.:/-]{1,160}$/.test(call.name) ? call.name : 'native_tool';
      if (!started.has(call.id)) { started.add(call.id); this.record(id, 'tool_started', { toolID: call.id, name, detailsAvailable: details }, `tool:${call.id}:start`); }
      if (!['completed', 'failed', 'cancelled'].includes(call.state) || finished.has(call.id)) return;
      finished.add(call.id);
      const recorded = this.record(id, 'tool_finished', { toolID: call.id, name, state: call.state }, `tool:${call.id}:end`);
      if (!recorded) return;
      const output = call.error?.message ?? call.output;
      // Only complete, identical failures count; successful polling and truncated/absent details do not prove a stall.
      const comparable = details && call.state === 'failed' && call.input && call.input.length < 12000 && output && output.length < (call.error ? 1000 : 12000);
      const fingerprint = comparable ? hash(encode([name, call.input, output])) : '';
      repeats = fingerprint && fingerprint === previous ? repeats + 1 : fingerprint ? 1 : 0; previous = fingerprint;
      if (repeats === 3) this.record(id, 'stalled', { reason: 'repeated_tool_failure', name, toolID: call.id, repeats }, 'repeated_tool_failure');
    };
  }
}
