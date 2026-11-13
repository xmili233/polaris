import { randomUUID } from 'node:crypto';
import { Cron } from 'croner';
import { z } from 'zod';
import type { PolarisStore } from './store.js';
import type { AgentStore, AgentWork } from './agent-store.js';
import { executionInputsSchema, parseInputs, validateInputs, type ExecutionInputs } from './execution-inputs.js';
import { PolarisError, encode } from './model.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const instant = z.string().datetime({ offset: true });
export const scheduleInputSchema = z.object({
  timezone: z.string().min(1).max(100).optional(),
  rule: z.discriminatedUnion('frequency', [
    z.object({ frequency: z.literal('once'), at: instant }).strict(),
    z.object({ frequency: z.literal('daily'), time }).strict(),
    z.object({ frequency: z.literal('weekly'), time, days: z.array(z.number().int().min(0).max(6)).min(1).max(7) }).strict(),
    z.object({ frequency: z.literal('monthly'), time, day: z.number().int().min(1).max(31) }).strict(),
  ]),
  expiresAt: instant.nullable().optional(),
}).strict();
export type ScheduleConfig = z.infer<typeof scheduleInputSchema> & { timezone: string };
export const scheduledTaskSchema = z.object({
  title: z.string().trim().min(1).max(160), instructions: z.string().trim().min(1).max(20000),
  config: scheduleInputSchema, inputs: executionInputsSchema.optional(),
}).strict();
export interface ScheduledTask {
  id: string; strategyID: string; version: number; title: string; instructions: string;
  config: ScheduleConfig; inputs: ExecutionInputs; nextAt: string | null; pendingAt: string | null;
}
export interface ScheduleSnapshot {
  strategyID: string; blocked: boolean; tasks: ScheduledTask[]; nextAt: string | null; pendingAt: string | null;
}
const failure = (message: string) => new PolarisError('conflict', message);
export function validateSchedule(input: unknown): ScheduleConfig {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) throw new PolarisError('invalid_input', 'Provide a valid schedule rule and execution time.');
  const c = { ...parsed.data, timezone: parsed.data.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone };
  try {
    const { timeZone } = new Intl.DateTimeFormat('en', { timeZone: c.timezone }).resolvedOptions();
    if (timeZone.startsWith('+') || timeZone.startsWith('-')) throw new Error('Offset time zone');
  } catch { throw new PolarisError('invalid_input', 'Invalid IANA time zone.'); }
  if (c.rule.frequency === 'weekly') c.rule.days = [...new Set(c.rule.days)].sort();
  return c;
}
function cron(c: ScheduleConfig) {
  if (c.rule.frequency === 'once') throw new Error('One-time rule has no cron expression');
  const [h, m] = c.rule.time.split(':');
  return new Cron(`${m} ${h} ${c.rule.frequency === 'monthly' ? c.rule.day : '*'} * ${c.rule.frequency === 'weekly' ? c.rule.days.join(',') : '*'}`, { timezone: c.timezone, mode: '5-part', paused: true });
}
export function nextScheduleTime(c: ScheduleConfig, after: Date): string | null {
  const date = c.rule.frequency === 'once' ? new Date(c.rule.at) : cron(c).nextRun(after);
  return date && (!c.expiresAt || date.getTime() <= Date.parse(c.expiresAt)) ? date.toISOString() : null;
}
export function futureSchedule(input: unknown, now: Date) {
  const config = validateSchedule(input), nextAt = nextScheduleTime(config, now);
  if (config.rule.frequency === 'once' && Date.parse(config.rule.at) <= now.getTime()) throw failure('Choose a future time.');
  if (!nextAt || (config.expiresAt && Date.parse(config.expiresAt) <= now.getTime())) throw failure('The schedule has no future occurrence before its expiry.');
  return { config, nextAt };
}
export function persistSchedule(store: PolarisStore, timing: {
  strategyID: string; config: ScheduleConfig; nextAt: string; title: string; instructions: string; inputs?: ExecutionInputs;
}) {
  const id = randomUUID();
  store.query('INSERT INTO scheduled_task(id,strategyID,title,instructions,inputs,config,nextAt) VALUES(?,?,?,?,?,?,?)',
    id, timing.strategyID, timing.title, timing.instructions, encode(timing.inputs ?? parseInputs({})), encode(timing.config), timing.nextAt);
  return id;
}
export class StrategyScheduler {
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  constructor(readonly store: PolarisStore, readonly data: AgentStore,
    readonly queue: (work: AgentWork, inputs?: ExecutionInputs) => string, readonly notify: () => void = () => {}, readonly clock = () => new Date()) {}
  private task(row: Record<string, unknown>): ScheduledTask {
    return { id: String(row.id), strategyID: String(row.strategyID), version: Number(row.version), title: String(row.title), instructions: String(row.instructions),
      inputs: parseInputs(JSON.parse(String(row.inputs))), config: validateSchedule(JSON.parse(String(row.config))),
      nextAt: row.nextAt ? String(row.nextAt) : null, pendingAt: row.pendingAt ? String(row.pendingAt) : null };
  }
  snapshot(strategyID: string): ScheduleSnapshot {
    this.store.get('strategy', strategyID);
    const tasks = this.store.query('SELECT * FROM scheduled_task WHERE strategyID=? AND active=1 AND (nextAt IS NOT NULL OR pendingAt IS NOT NULL) ORDER BY rowid', strategyID).map(row => this.task(row));
    const first = (key: 'nextAt' | 'pendingAt') => tasks.map(task => task[key]).filter((at): at is string => !!at).sort()[0] ?? null;
    return { strategyID, tasks, nextAt: first('nextAt'), pendingAt: first('pendingAt'), blocked: !!this.data.uncertainStrategyRuns(strategyID).length };
  }
  list() { return this.store.records('strategy').filter(strategy => this.store.isStrategyActive(strategy.id)).map(strategy => this.snapshot(strategy.id)); }
  overview() {
    return this.list().map(({ strategyID, blocked, tasks }) => ({ strategyID, blocked,
      tasks: tasks.map(({ id, version, title, config, nextAt, pendingAt }) => ({ id, version, title, config, nextAt, pendingAt })) }));
  }
  save(strategyID: string, input: unknown, id?: string, expectedVersion = 0) {
    const parsed = scheduledTaskSchema.safeParse(input);
    if (!parsed.success) throw new PolarisError('invalid_input', 'Provide the scheduled task title, instructions and timing.');
    const { title, instructions } = parsed.data, inputs = parseInputs(parsed.data.inputs ?? {}), timing = futureSchedule(parsed.data.config, this.clock());
    return this.store.transaction(() => {
      if (!this.store.isStrategyActive(strategyID)) throw failure('Strategy is no longer active.');
      validateInputs(this.store, inputs, this.store.get('strategy', strategyID).goalID);
      if (id) {
        const old = this.store.query('SELECT * FROM scheduled_task WHERE id=? AND strategyID=? AND active=1', id, strategyID)[0];
        if (!old || Number(old.version) !== expectedVersion) throw failure('Scheduled task changed; read it again.');
        this.cancelQueued(id);
        this.store.query('UPDATE scheduled_task SET title=?,instructions=?,inputs=?,config=?,nextAt=?,pendingAt=NULL,version=version+1 WHERE id=?', title, instructions, encode(inputs), encode(timing.config), timing.nextAt, id);
      } else {
        if (expectedVersion !== 0) throw failure('A new scheduled task has version zero.');
        id = persistSchedule(this.store, { strategyID, title, instructions, inputs, ...timing });
      }
      this.notify(); queueMicrotask(() => this.arm());
      return this.task(this.store.query('SELECT * FROM scheduled_task WHERE id=?', id)[0]);
    });
  }
  cancel(strategyID: string, id: string, expectedVersion: number) {
    return this.store.transaction(() => {
      const row = this.store.query('SELECT version FROM scheduled_task WHERE id=? AND strategyID=? AND active=1', id, strategyID)[0];
      if (!row || Number(row.version) !== expectedVersion) throw failure('Scheduled task changed; read it again.');
      this.cancelQueued(id);
      this.store.query('UPDATE scheduled_task SET active=0,nextAt=NULL,pendingAt=NULL,version=version+1 WHERE id=?', id);
      this.notify(); this.arm(); return { id, cancelled: true };
    });
  }
  private cancelQueued(id: string) {
    for (const row of this.store.query(`SELECT j.id,j.workID FROM agent_job j JOIN schedule_run r ON r.jobID=j.id WHERE r.scheduleID=? AND j.state IN ('queued','waiting_connection')`, id)) {
      this.data.setJob(String(row.id), 'cancelled'); const work = this.data.work(String(row.workID)); this.data.setWork(work.id, 'cancelled', work.progress);
    }
  }
  workContext(workID: string) {
    const row = this.store.query('SELECT r.id,r.plannedAt,t.config,t.title FROM schedule_run r JOIN scheduled_task t ON t.id=r.scheduleID WHERE r.workID=?', workID)[0];
    return row ? { runID: row.id, plannedAt: row.plannedAt, title: row.title, config: validateSchedule(JSON.parse(String(row.config))) } : null;
  }
  canStart(workID: string, continuation: boolean) {
    const row = this.store.query('SELECT r.*,t.active,t.version AS currentVersion,t.config FROM schedule_run r JOIN scheduled_task t ON t.id=r.scheduleID WHERE r.workID=?', workID)[0];
    if (!row) return true;
    if (!this.store.isStrategyActive(String(row.strategyID)) || this.data.uncertainStrategyRuns(String(row.strategyID)).length) return false;
    const config = validateSchedule(JSON.parse(String(row.config)));
    return continuation || (!!row.active && row.version === row.currentVersion && (!config.expiresAt || this.clock().getTime() <= Date.parse(config.expiresAt)));
  }
  tick() {
    if (this.stopped) return;
    let changed = false;
    this.store.transaction(() => {
      for (const row of this.store.query('SELECT * FROM scheduled_task WHERE active=1')) {
        const task = this.task(row), now = this.clock();
        if (!this.store.isStrategyActive(task.strategyID) || (task.config.expiresAt && now.getTime() > Date.parse(task.config.expiresAt))) {
          this.cancel(task.strategyID, task.id, task.version); changed = true; continue;
        }
        let pendingAt = task.pendingAt;
        if (task.nextAt && Date.parse(task.nextAt) <= now.getTime()) {
          // Coalesce missed occurrences into the latest one; never replay an offline backlog.
          pendingAt = task.config.rule.frequency === 'once' ? task.nextAt : cron(task.config).previousRuns(1, new Date(Math.floor(now.getTime() / 1000) * 1000 + 1000))[0]?.toISOString() ?? task.nextAt;
          this.store.query('UPDATE scheduled_task SET nextAt=?,pendingAt=? WHERE id=?', task.config.rule.frequency === 'once' ? null : nextScheduleTime(task.config, now), pendingAt, task.id); changed = true;
        }
        if (!pendingAt || this.data.uncertainStrategyRuns(task.strategyID).length || this.data.activeStrategyWork(task.strategyID)) continue;
        if (!this.store.query('SELECT 1 FROM schedule_run WHERE scheduleID=? AND version=? AND plannedAt=?', task.id, task.version, pendingAt).length) {
          const work = this.data.createWork(task.strategyID, task.title, task.instructions), jobID = this.queue(work, task.inputs);
          this.store.query('INSERT INTO schedule_run(id,scheduleID,strategyID,version,plannedAt,workID,jobID,createdAt) VALUES(?,?,?,?,?,?,?,?)', randomUUID(), task.id, task.strategyID, task.version, pendingAt, work.id, jobID, now.toISOString());
        }
        this.store.query('UPDATE scheduled_task SET pendingAt=NULL WHERE id=?', task.id); changed = true;
      }
    });
    if (changed) this.notify(); this.arm();
  }
  start() { this.stopped = false; this.tick(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }
  arm() {
    clearTimeout(this.timer); if (this.stopped) return;
    const next = this.store.query('SELECT MIN(nextAt) AS at FROM scheduled_task WHERE active=1')[0]?.at;
    const remaining = next ? Date.parse(String(next)) - this.clock().getTime() : 30_000;
    this.timer = setTimeout(() => { try { this.tick(); } catch { this.arm(); } }, remaining > 0 ? Math.max(250, Math.min(30_000, remaining)) : 30_000); this.timer.unref();
  }
}
