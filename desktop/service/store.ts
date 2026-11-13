import { parseInputs, validateInputs } from './execution-inputs.js';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backupDatabase, initializeAgentSchema, initializeScheduleSchema, schemaVersion, upgradeWorkspace, simplifyWorkspace, consolidateRecords } from './migrations.js';
import { existingGoalIcon, findGoalIcon } from './goal-icons.js';
import { type Board, type Decision, type Entity, type Kind, type Option, type Outcome, type Records,
  PolarisError, encode, length, now, object, requireText, string } from './model.js';

export const defaultDatabase = path.join(os.homedir(), 'Library/Application Support/Polaris Desktop/Workspace/polaris.sqlite');
const fields: Record<Kind, string[]> = {
  goal: ['id', 'title', 'milestone', 'symbol', 'constraints'],
  strategy: ['id', 'goalID', 'title', 'body', 'origin'],
  decision: ['id', 'strategyID', 'title', 'body', 'excerpt', 'options', 'recommendedOptionID', 'inputs'],
};
const baseFields = ['version', 'status', 'createdAt', 'updatedAt'];
function parent(kind: Kind, record: Entity): string | null {
  if (kind === 'goal') return null;
  return (record as unknown as Record<string, string>)[{ strategy: 'goalID', decision: 'strategyID' }[kind]];
}

export class PolarisStore {
  onOutcome?: (outcome: Outcome) => void;
  private transactionDepth = 0;
  private readonly readEpoch = randomUUID();
  readonly db: DatabaseSync;
  readonly file: string;
  constructor(file = defaultDatabase) {
    this.file = path.resolve(file);
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA busy_timeout = 3000; PRAGMA foreign_keys = ON');
    chmodSync(this.file, 0o600);
    try {
      const version = Number(this.query('PRAGMA user_version')[0].user_version);
      if (version !== 0 && version !== 2 && version !== 3 && version !== 4 && version !== schemaVersion) throw new PolarisError('schema', 'This database schema is incompatible with Polaris. Use a matching version or open a separate workspace.', 'errors.databaseVersion');
      if (version === schemaVersion) return;
      if (version > 0) backupDatabase(this);
      this.db.exec('PRAGMA foreign_keys = OFF');
      try { this.transaction(() => {
        if (Number(this.query('PRAGMA user_version')[0].user_version) === schemaVersion) return;
        for (const [table, reference] of [['goal', ''], ['policy', ' REFERENCES goal(id)'], ['strategy', ' REFERENCES goal(id)'], ['decision', ' REFERENCES strategy(id)']]) {
          this.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, parent_id TEXT${reference}, version INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS ${table}_parent ON ${table}(parent_id)`);
        }
        this.db.exec(`CREATE TABLE IF NOT EXISTS outcome (id TEXT PRIMARY KEY, decision_id TEXT NOT NULL REFERENCES decision(id), active INTEGER NOT NULL, acknowledged INTEGER NOT NULL, payload TEXT NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS one_active_outcome ON outcome(decision_id) WHERE active=1;
          CREATE TABLE IF NOT EXISTS request (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, response TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS revision (kind TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind, entity_id, version));
          CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
        if (version < 4) {
          initializeAgentSchema(this, version === 2);
          initializeScheduleSchema(this);
          if (version === 2) upgradeWorkspace(this);
          simplifyWorkspace(this);
        }
        consolidateRecords(this);
        if (this.query('PRAGMA foreign_key_check').length) throw new PolarisError('migration', 'Workspace references failed migration verification.');
        this.db.exec(`PRAGMA user_version = ${schemaVersion}`);
      }); } finally { this.db.exec('PRAGMA foreign_keys = ON'); }
    } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  query(sql: string, ...values: (string | number | null)[]) { return this.db.prepare(sql).all(...values); }
  transaction<T>(body: () => T, write = true): T {
    const depth = this.transactionDepth++, savepoint = `polaris_${depth}`;
    try {
      this.db.exec(depth ? `SAVEPOINT ${savepoint}` : write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try { const result = body(); this.db.exec(depth ? `RELEASE ${savepoint}` : 'COMMIT'); return result; }
      catch (error) { this.db.exec(depth ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK'); throw error; }
    } finally { this.transactionDepth--; }
  }
  get changeToken() { return `${this.readEpoch}:${this.query('PRAGMA data_version')[0].data_version}:${this.query('SELECT total_changes() AS changes')[0].changes}`; }
  private decode<K extends Kind>(kind: K, raw: unknown): Records[K] {
    const value = JSON.parse(String(raw));
    const required = fields[kind].filter(key => !['excerpt', 'recommendedOptionID', 'options', 'inputs'].includes(key));
    if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.version) || !['active', 'archived', 'cancelled'].includes(value.status)
      || required.some(key => typeof value[key] !== 'string') || !Number.isFinite(Date.parse(value.createdAt)) || !Number.isFinite(Date.parse(value.updatedAt))
      || (kind === 'decision' && (!Array.isArray(value.options) || value.options.some((option: Option) => !option || typeof option.id !== 'string' || typeof option.label !== 'string')))) {
      throw new PolarisError('storage', `Invalid stored ${kind} record.`);
    }
    if (kind === 'goal') value.symbol = existingGoalIcon(value.symbol);
    // Old snapshots can contain removed fields such as basis; do not re-export them.
    return Object.fromEntries([...fields[kind], ...baseFields].filter(key => value[key] !== undefined && value[key] !== null).map(key => [key, value[key]])) as unknown as Records[K];
  }
  records<K extends Kind>(kind: K, parentID?: string): Records[K][] {
    const rows = parentID === undefined ? this.query(`SELECT payload FROM ${kind} ORDER BY rowid`)
      : this.query(`SELECT payload FROM ${kind} WHERE parent_id=? ORDER BY rowid`, parentID);
    return rows.map(row => this.decode(kind, row.payload));
  }
  get<K extends Kind>(kind: K, id: string): Records[K] {
    const row = this.query(`SELECT payload FROM ${kind} WHERE id=?`, id)[0];
    if (!row) throw new PolarisError('not_found', `${kind} not found: ${id}`);
    return this.decode(kind, row.payload);
  }
  history<K extends Kind>(kind: K, id: string): Records[K][] {
    return this.query('SELECT payload FROM revision WHERE kind=? AND entity_id=? ORDER BY version', kind, id).map(row => JSON.parse(String(row.payload)));
  }
  persist(kind: Kind, record: Entity) {
    const payload = encode(record);
    this.query(`INSERT INTO ${kind}(id,parent_id,version,status,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,version=excluded.version,status=excluded.status,payload=excluded.payload`, record.id, parent(kind, record), record.version, record.status, payload);
    this.query('INSERT INTO revision(kind,entity_id,version,payload) VALUES(?,?,?,?)', kind, record.id, record.version, payload);
  }
  persistOutcome(outcome: Outcome) {
    this.query('INSERT INTO outcome(id,decision_id,active,acknowledged,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,acknowledged=excluded.acknowledged,payload=excluded.payload',
      outcome.id, outcome.decisionID, outcome.withdrawnAt ? 0 : 1, outcome.acknowledgedAt ? 1 : 0, encode(outcome));
  }
  outcomes(unacknowledged = false): Outcome[] {
    return this.query(`SELECT payload FROM outcome${unacknowledged ? ' WHERE active=1 AND acknowledged=0' : ''} ORDER BY rowid`).map(row => JSON.parse(String(row.payload)));
  }
  private currentOutcome(id: string): Outcome | undefined {
    const row = this.query('SELECT payload FROM outcome WHERE decision_id=? AND active=1', id)[0];
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  snapshot(includeArchived = false, goalID?: string): Board { return this.transaction(() => this.snapshotInside(includeArchived, goalID), false); }
  snapshotInside(includeArchived = false, goalID?: string): Board {
    const goals = (goalID === undefined ? this.records('goal') : [this.get('goal', goalID)]).filter(record => includeArchived || record.status === 'active');
    const strategies = this.records('strategy', goalID).filter(record => goals.some(parent => parent.id === record.goalID) && (includeArchived || record.status === 'active'));
    const cards = goalID === undefined ? this.records('decision') : this.query(`SELECT d.payload FROM decision d
      JOIN strategy s ON s.id=d.parent_id WHERE s.parent_id=? ORDER BY d.rowid`, goalID).map(row => this.decode('decision', row.payload));
    const rows = goalID === undefined ? this.query('SELECT payload FROM outcome WHERE active=1') : this.query(`SELECT o.payload FROM outcome o
      JOIN decision d ON d.id=o.decision_id JOIN strategy s ON s.id=d.parent_id WHERE o.active=1 AND s.parent_id=?`, goalID);
    const byDecision = new Map(rows.map(row => JSON.parse(String(row.payload)) as Outcome).map(outcome => [outcome.decisionID, outcome]));
    const decisions = cards.filter(record => strategies.some(parent => parent.id === record.strategyID) && (includeArchived || record.status === 'active'))
      .map(record => ({ ...record, ...(byDecision.has(record.id) ? { outcome: byDecision.get(record.id) } : {}) }));
    return { goals, strategies, decisions };
  }
  context(goalID?: string) {
    return this.transaction(() => {
      const board = this.snapshotInside(true, goalID), ids = new Set(board.decisions.map(decision => decision.id));
      const outcomes = goalID === undefined ? this.outcomes() : this.query(`SELECT o.payload FROM outcome o JOIN decision d ON d.id=o.decision_id
        JOIN strategy s ON s.id=d.parent_id WHERE s.parent_id=? ORDER BY o.rowid`, goalID).map(row => JSON.parse(String(row.payload)) as Outcome);
      return { board, outcomes: outcomes.filter(outcome => ids.has(outcome.decisionID)) };
    }, false);
  }
  isStrategyActive(id: string) {
    return this.query("SELECT 1 FROM strategy s JOIN goal g ON g.id=s.parent_id WHERE s.id=? AND s.status='active' AND g.status='active'", id).length > 0;
  }
  mutate(kind: Kind, action: string, id: string | undefined, input: unknown): Entity {
    if (!Object.hasOwn(fields, kind)) throw new PolarisError('invalid_input', 'Unknown record kind.');
    const request = object(input);
    if (typeof request.requestID !== 'string') throw new PolarisError('invalid_input', 'requestID must be a string.');
    if (request.expectedVersion != null && (!Number.isSafeInteger(request.expectedVersion) || typeof request.expectedVersion !== 'number')) throw new PolarisError('invalid_input', 'expectedVersion must be an integer.');
    for (const field of fields[kind].filter(field => !['options', 'inputs'].includes(field))) string(request[field]);
    let options: Option[] | undefined;
    if (request.options != null) {
      if (!Array.isArray(request.options)) throw new PolarisError('invalid_input', 'options must be an array.');
      options = request.options.map(value => {
        const option = object(value);
        if (Object.keys(option).some(key => !['id', 'label', 'detail'].includes(key))) throw new PolarisError('invalid_input', 'Options accept only id, label and detail.');
        if (typeof option.id !== 'string' || typeof option.label !== 'string') throw new PolarisError('invalid_input', 'Options require string values for id and label.');
        return { id: option.id, label: option.label, ...(option.detail != null ? { detail: string(option.detail) } : {}) };
      });
    }
    const allowed = new Set(['requestID', 'expectedVersion', ...(['archive', 'cancel'].includes(action) ? [] : fields[kind].filter(field => ['create', 'submit'].includes(action) || field !== 'id'))]);
    const unknown = Object.keys(request).filter(key => !allowed.has(key)).sort();
    if (unknown.length) throw new PolarisError('invalid_input', `Unknown fields: ${unknown.join(', ')}`);
    const requestID = request.requestID;
    if (!requestID.trim() || length(requestID) > 200) throw new PolarisError('invalid_input', 'requestID must contain 1–200 characters.');
    // Foundation's original request fingerprints escape slashes, unlike CLI output.
    const fingerprint = `${kind}/${action}/${id ?? ''}:${encode(request).replaceAll('/', '\\/')}`;
    return this.transaction(() => {
      const cached = this.query('SELECT fingerprint,response FROM request WHERE id=?', requestID)[0];
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw new PolarisError('conflict', 'requestID was used for a different request. Use a new ID.');
        return JSON.parse(String(cached.response));
      }
      const key = id ?? string(request.id, randomUUID().toLowerCase());
      if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) throw new PolarisError('invalid_input', 'ID must contain 1–120 letters, digits, hyphens, underscores or dots.');
      let value: Entity;
      const base = { id: key, version: 1, status: 'active' as const, createdAt: now(), updatedAt: now() };
      if (kind === 'goal') value = { ...base, title: string(request.title), milestone: string(request.milestone), symbol: string(request.symbol, 'Target'), constraints: string(request.constraints) };
      else if (kind === 'strategy') value = { ...base, goalID: string(request.goalID), title: string(request.title), body: string(request.body), origin: string(request.origin) };
      else value = { ...base, strategyID: string(request.strategyID), title: string(request.title), body: string(request.body),
        ...(request.inputs !== undefined ? { inputs: parseInputs(request.inputs) } : {}), options: options ?? [], ...Object.fromEntries(['excerpt', 'recommendedOptionID'].filter(key => request[key] != null).map(key => [key, string(request[key])])) } as Decision;
      if (['update', 'archive', 'cancel'].includes(action)) {
        const old = this.active(kind, key);
        this.checkVersion(old.version, request.expectedVersion);
        if (kind === 'goal' && request.constraints === undefined) (value as Records['goal']).constraints = (old as Records['goal']).constraints;
        if (kind === 'decision' && action === 'update' && request.inputs === undefined) (value as Decision).inputs = (old as Decision).inputs;
        if (kind === 'decision' && this.currentOutcome(key)) throw new PolarisError('conflict', action === 'cancel' ? 'A decision with a user outcome cannot be cancelled.' : 'A decision with a user outcome cannot be edited. Submit a new decision.');
        if (action === 'archive' || action === 'cancel') {
          if (action === 'archive' && kind === 'decision') throw new PolarisError('invalid_input', 'Use cancel for pending decisions.');
          if (action === 'archive') this.ensureNoOpenDecisions(kind, key);
          value = { ...old, status: action === 'cancel' ? 'cancelled' : 'archived' };
        } else if (parent(kind, value) !== parent(kind, old)) throw new PolarisError('conflict', 'Records cannot move between parents. Create a new record.');
        value.createdAt = old.createdAt; value.version = old.version + 1;
      } else if (['create', 'submit'].includes(action)) {
        if (this.query(`SELECT id FROM ${kind} WHERE id=?`, key).length) throw new PolarisError('conflict', `ID already exists: ${key}`);
        if (request.expectedVersion != null) throw new PolarisError('invalid_input', 'Omit expectedVersion when creating a record.');
      } else throw new PolarisError('invalid_input', 'Unsupported operation.');
      if (!['archive', 'cancel'].includes(action)) this.validate(kind, value);
      value.updatedAt = now();
      this.persist(kind, value);
      const response = value;
      this.query('INSERT INTO request(id,fingerprint,response) VALUES(?,?,?)', requestID, fingerprint, encode(response));
      return response;
    });
  }
  private active<K extends Kind>(kind: K, id: string): Records[K] {
    const value = this.get(kind, id);
    if (value.status !== 'active') throw new PolarisError('conflict', `${kind} is archived or cancelled.`);
    return value;
  }
  private validate(kind: Kind, record: Entity) {
    requireText(record.title, 'title', 160);
    if (kind === 'goal') {
      const value = record as Records['goal']; requireText(value.milestone, 'milestone'); requireText(value.symbol, 'symbol', 100);
      const icon = findGoalIcon(value.symbol);
      if (!icon) throw new PolarisError('invalid_input', `Unknown built-in icon: ${value.symbol}. Use one of the 20 icons listed in help, such as Armchair, or Target as the default.`, 'errors.goalIconUnknown', { name: value.symbol });
      value.symbol = icon;
      if (length(value.constraints) > 20000) throw new PolarisError('invalid_input', 'Goal constraints must contain at most 20000 characters.');
    } else if (kind === 'strategy') {
      const value = record as Records['strategy']; this.active('goal', value.goalID); requireText(value.body, 'body'); requireText(value.origin, 'origin');
    } else {
      const value = record as Decision, strategy = this.active('strategy', value.strategyID);
      if (value.inputs) validateInputs(this, value.inputs, strategy.goalID);
      this.active('goal', strategy.goalID); requireText(value.body, 'body');
      if (value.options.length > 9 || new Set(value.options.map(option => option.id)).size !== value.options.length) throw new PolarisError('invalid_input', 'Provide at most 9 options with distinct IDs.');
      if (length(value.excerpt ?? '') > 20000) throw new PolarisError('invalid_input', 'excerpt must contain at most 20000 characters.');
      for (const option of value.options) {
        requireText(option.id, 'option.id', 100); requireText(option.label, 'option.label', 300);
        if (length(option.detail ?? '') > 20000) throw new PolarisError('invalid_input', 'option.detail must contain at most 20000 characters.');
      }
      if (value.recommendedOptionID !== undefined) {
        if (!value.options.some(option => option.id === value.recommendedOptionID)) throw new PolarisError('invalid_input', 'The recommended option does not exist.');
      }
    }
  }
  private ensureNoOpenDecisions(kind: Kind, id: string) {
    const board = this.snapshotInside();
    const strategies = kind === 'strategy' ? [id] : board.strategies.filter(strategy => strategy.goalID === id).map(strategy => strategy.id);
    if (board.decisions.some(decision => strategies.includes(decision.strategyID) && !decision.outcome?.acknowledgedAt)) throw new PolarisError('conflict', 'Pending decisions or unacknowledged outcomes remain. Resolve or cancel them first.');
  }
  private checkVersion(current: number, expected: unknown) {
    if (expected !== current) throw new PolarisError('conflict', `expectedVersion is missing or stale. Read the current version (${current}) and retry.`, 'errors.versionChanged', { version: current });
  }
  decide(id: string, optionID: string | undefined, note: string, expectedVersion: number): Outcome {
    return this.transaction(() => {
      const decision = this.active('decision', id);
      this.checkVersion(decision.version, expectedVersion);
      if (this.currentOutcome(id)) throw new PolarisError('conflict', 'This card already has a decision. Refresh to see the current outcome.', 'errors.decisionChanged');
      const text = note.trim();
      if (optionID !== undefined) {
        if (!decision.options.some(option => option.id === optionID)) throw new PolarisError('invalid_input', 'This option no longer exists. Refresh to see the current card.', 'errors.optionMissing');
        if (text) throw new PolarisError('invalid_input', 'Choose an option or enter a custom decision.', 'errors.chooseOrWrite');
      } else requireText(text, 'Custom decision');
      const strategy = this.active('strategy', decision.strategyID);
      this.active('goal', strategy.goalID);
      if (decision.inputs) validateInputs(this, decision.inputs, strategy.goalID);
      const outcome: Outcome = { id: randomUUID().toUpperCase(), decisionID: id, decisionVersion: decision.version, ...(optionID !== undefined ? { optionID } : {}), note: text, decidedAt: now() };
      this.persistOutcome(outcome); decision.version++; decision.updatedAt = now(); this.persist('decision', decision);
      this.onOutcome?.(outcome);
      return outcome;
    });
  }
}
