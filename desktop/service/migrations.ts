import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
import { matchLanguage, translator } from '@polaris/i18n';
import type { PolarisStore } from './store.js';
import { PolarisError } from './model.js';

export const schemaVersion = 5;
export function backupDatabase(store: PolarisStore) {
  const destination = `${store.file}.before-v${schemaVersion}-${Date.now()}.sqlite`;
  store.db.prepare('VACUUM INTO ?').run(destination);
  chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
      throw new PolarisError('migration', 'The workspace backup failed verification.');
  } finally { copy.close(); }
  return destination;
}

export function initializeAgentSchema(store: PolarisStore, upgrade: boolean) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS agent_session (id TEXT PRIMARY KEY, progress TEXT NOT NULL DEFAULT '', provider TEXT, nativeSessionID TEXT, capabilities TEXT NOT NULL DEFAULT '{}', runtimeVersion TEXT, historyStart INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS agent_message (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, createdAt TEXT NOT NULL, parts TEXT NOT NULL DEFAULT '[]', provider TEXT, nativeSessionID TEXT, attachments TEXT NOT NULL DEFAULT '[]', jobID TEXT, inputKind TEXT);
    CREATE TABLE IF NOT EXISTS agent_work (id TEXT PRIMARY KEY, strategyID TEXT NOT NULL REFERENCES strategy(id), title TEXT NOT NULL, instructions TEXT NOT NULL, progress TEXT NOT NULL DEFAULT '', state TEXT NOT NULL, waitingDecisionID TEXT REFERENCES decision(id), provider TEXT, sessionKey TEXT);
    CREATE TABLE IF NOT EXISTS agent_job (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, workID TEXT REFERENCES agent_work(id), input TEXT NOT NULL, outcomeID TEXT UNIQUE REFERENCES outcome(id), state TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', createdAt TEXT NOT NULL, acceptedAt TEXT, startedAt TEXT, completedAt TEXT, next TEXT, title TEXT, handoffDecisionID TEXT, outcomeContextID TEXT, origin TEXT NOT NULL DEFAULT 'system', provider TEXT, sessionKey TEXT, nativeRunID TEXT, delivery TEXT NOT NULL DEFAULT 'queued', generation INTEGER NOT NULL DEFAULT 0, runtimeVersion TEXT, runtimeSource TEXT, capabilities TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS agent_jobs_work ON agent_job(workID,seq);
    CREATE TABLE IF NOT EXISTS agent_job_inputs(jobID TEXT PRIMARY KEY REFERENCES agent_job(id),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_action (id TEXT PRIMARY KEY, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_artifact (id TEXT PRIMARY KEY, workID TEXT REFERENCES agent_work(id), title TEXT NOT NULL, body TEXT NOT NULL, jobID TEXT);
    CREATE TABLE IF NOT EXISTS agent_decision_work (decisionID TEXT PRIMARY KEY REFERENCES decision(id), workID TEXT NOT NULL REFERENCES agent_work(id), sourceJobID TEXT, issueKey TEXT NOT NULL DEFAULT '');
    INSERT OR IGNORE INTO agent_session(id) VALUES('main');
  `);
  if (upgrade && !store.query('PRAGMA table_info(agent_job)').some(column => column.name === 'acceptedAt')) store.db.exec('ALTER TABLE agent_job ADD COLUMN acceptedAt TEXT');
  if (upgrade && !store.query('PRAGMA table_info(agent_message)').some(column => column.name === 'parts')) store.db.exec("ALTER TABLE agent_message ADD COLUMN parts TEXT NOT NULL DEFAULT '[]'");
  if (upgrade && !store.query('PRAGMA table_info(agent_session)').some(column => column.name === 'progress')) store.db.exec("ALTER TABLE agent_session ADD COLUMN progress TEXT NOT NULL DEFAULT ''");
  if (upgrade) for (const column of ['startedAt', 'completedAt'])
    if (!store.query('PRAGMA table_info(agent_job)').some(item => item.name === column)) store.db.exec(`ALTER TABLE agent_job ADD COLUMN ${column} TEXT`);
  if (upgrade) for (const [table, columns] of Object.entries({
    agent_session: { provider: 'TEXT', nativeSessionID: 'TEXT', capabilities: "TEXT NOT NULL DEFAULT '{}'", runtimeVersion: 'TEXT', historyStart: 'INTEGER NOT NULL DEFAULT 0' },
    agent_job: { next: 'TEXT', title: 'TEXT', handoffDecisionID: 'TEXT', outcomeContextID: 'TEXT', origin: "TEXT NOT NULL DEFAULT 'system'", provider: 'TEXT', sessionKey: 'TEXT', nativeRunID: 'TEXT', delivery: "TEXT NOT NULL DEFAULT 'queued'", generation: 'INTEGER NOT NULL DEFAULT 0', runtimeVersion: 'TEXT', runtimeSource: 'TEXT', capabilities: "TEXT NOT NULL DEFAULT '{}'" },
    agent_message: { provider: 'TEXT', nativeSessionID: 'TEXT', attachments: "TEXT NOT NULL DEFAULT '[]'", jobID: 'TEXT', inputKind: 'TEXT' },
    agent_work: { provider: 'TEXT', sessionKey: 'TEXT' },
    agent_artifact: { jobID: 'TEXT' },
    agent_decision_work: { sourceJobID: 'TEXT', issueKey: "TEXT NOT NULL DEFAULT ''" },
  })) for (const [column, type] of Object.entries(columns)) {
    if (!store.query(`PRAGMA table_info(${table})`).some(item => item.name === column)) store.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  store.db.exec("CREATE TABLE IF NOT EXISTS agent_connection (provider TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS agent_native_event (jobID TEXT NOT NULL, eventID TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(jobID,eventID))");

}

export function initializeScheduleSchema(store: PolarisStore) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_schedule(strategyID TEXT PRIMARY KEY REFERENCES strategy(id),version INTEGER NOT NULL DEFAULT 0,revisionID TEXT,nextAt TEXT,pendingAt TEXT);
    CREATE TABLE IF NOT EXISTS schedule_revision(id TEXT PRIMARY KEY,strategyID TEXT NOT NULL REFERENCES strategy(id),baseVersion INTEGER NOT NULL,config TEXT NOT NULL,decisionID TEXT UNIQUE REFERENCES decision(id),decisionVersion INTEGER,decisionHash TEXT,status TEXT NOT NULL,outcomeID TEXT,review TEXT,createdAt TEXT NOT NULL,sourceJobID TEXT);
    CREATE TABLE IF NOT EXISTS schedule_run(id TEXT PRIMARY KEY,strategyID TEXT NOT NULL REFERENCES strategy(id),revisionID TEXT NOT NULL REFERENCES schedule_revision(id),plannedAt TEXT NOT NULL,workID TEXT UNIQUE REFERENCES agent_work(id),jobID TEXT REFERENCES agent_job(id),skipReason TEXT,reviewedAt TEXT,createdAt TEXT NOT NULL,UNIQUE(strategyID,revisionID,plannedAt));
    CREATE INDEX IF NOT EXISTS schedule_runs_strategy ON schedule_run(strategyID,plannedAt);
  `);
}

function upgradeSchedules(store: PolarisStore) {
  const legacy = store.query('PRAGMA table_info(strategy_schedule)').some(c => c.name === 'enabled');
  if (legacy) {
    // Rebuild the parent table atomically while preserving every historical run reference.
    store.transaction(() => {
      if (!store.query('PRAGMA table_info(strategy_schedule)').some(c => c.name === 'enabled')) return;
      store.db.exec(`
        CREATE TABLE schedule_revision_new(id TEXT PRIMARY KEY,strategyID TEXT NOT NULL REFERENCES strategy(id),baseVersion INTEGER NOT NULL,config TEXT NOT NULL,decisionID TEXT UNIQUE REFERENCES decision(id),decisionVersion INTEGER,decisionHash TEXT,status TEXT NOT NULL,outcomeID TEXT,review TEXT,createdAt TEXT NOT NULL,sourceJobID TEXT);
        INSERT INTO schedule_revision_new SELECT id,strategyID,baseVersion,config,decisionID,decisionVersion,decisionHash,status,outcomeID,review,createdAt,NULL FROM schedule_revision;
        DROP TABLE schedule_revision;
        ALTER TABLE schedule_revision_new RENAME TO schedule_revision;
        CREATE TABLE strategy_schedule_new(strategyID TEXT PRIMARY KEY REFERENCES strategy(id),version INTEGER NOT NULL DEFAULT 0,revisionID TEXT,nextAt TEXT,pendingAt TEXT);
        INSERT INTO strategy_schedule_new SELECT strategyID,version+CASE WHEN enabled=0 AND revisionID IS NOT NULL THEN 1 ELSE 0 END,CASE WHEN enabled=1 THEN revisionID ELSE NULL END,CASE WHEN enabled=1 THEN nextAt ELSE NULL END,CASE WHEN enabled=1 THEN pendingAt ELSE NULL END FROM strategy_schedule;
        DROP TABLE strategy_schedule;
        ALTER TABLE strategy_schedule_new RENAME TO strategy_schedule;
      `);
      if (store.query('PRAGMA foreign_key_check').length) throw new PolarisError('migration', 'Schedule migration failed its reference check.');
    });
  }
  store.transaction(() => {
    for (const row of store.query("SELECT id,decisionID FROM schedule_revision WHERE status='proposed'")) {
      if (!row.decisionID) continue;
      const d = JSON.parse(String(store.query('SELECT payload FROM decision WHERE id=?', String(row.decisionID))[0].payload));
      if (d.status === 'active' && !store.outcomes().some(o => o.decisionID === d.id && !o.withdrawnAt)) {
        d.status = 'cancelled'; d.version++; d.updatedAt = new Date().toISOString(); store.persist('decision', d);
      }
      store.query("UPDATE schedule_revision SET status='superseded' WHERE id=?", String(row.id));
    }
  });
}

export function upgradeWorkspace(store: PolarisStore) {
  upgradeSchedules(store);
  store.transaction(() => {
    // Retired question waits must never dispatch an answer after upgrading.
    store.query("UPDATE agent_work SET state='cancelled' WHERE state='waiting_answer'");
    store.query("UPDATE agent_job SET state='cancelled',error='question_retired' WHERE state='waiting_answer' OR (origin='answer' AND state IN ('queued','waiting_connection'))");
    store.query("UPDATE agent_message SET state='cancelled' WHERE inputKind='answer' AND state='queued'");
    // A retired dependency cannot silently become permission to execute.
    for (const row of store.query('SELECT jobID,payload FROM agent_job_inputs')) {
      const { dependsOnDecisionIDs = [], ...inputs } = JSON.parse(String(row.payload));
      if (dependsOnDecisionIDs.length) store.query("UPDATE agent_job SET state='needs_review',error='retired_dependency' WHERE id=? AND state IN ('queued','waiting_connection','running')", String(row.jobID));
      store.query('UPDATE agent_job_inputs SET payload=? WHERE jobID=?', JSON.stringify(inputs), String(row.jobID));
    }
    for (const { payload } of store.query('SELECT payload FROM decision')) {
      const card = JSON.parse(String(payload));
      const inputs = card.inputs as { artifactIDs: string[]; knowledgeIDs: string[]; dependsOnDecisionIDs?: string[] } | undefined;
      if (!inputs || !('dependsOnDecisionIDs' in inputs)) continue;
      const { dependsOnDecisionIDs, ...references } = inputs;
      card.inputs = references;
      if (dependsOnDecisionIDs?.length && card.status === 'active' && !store.outcomes().some(outcome => outcome.decisionID === card.id && !outcome.withdrawnAt)) card.status = 'cancelled';
      card.version++; card.updatedAt = new Date().toISOString(); store.persist('decision', card);
    }
    store.query("UPDATE agent_job SET state='needs_review',error='retired_recovery' WHERE origin='recovery' AND state IN ('queued','waiting_connection','running')");
    for (const row of store.query("SELECT j.id,j.workID,j.provider,o.payload AS outcome FROM agent_job j JOIN outcome o ON o.id=j.outcomeID WHERE j.provider IS NOT NULL AND j.state IN ('queued','waiting_connection') AND j.delivery IN ('queued','not_sent','preparing') AND j.sessionKey NOT LIKE 'native:%:task:%'")) {
      const outcome = JSON.parse(String(row.outcome)), decision = JSON.parse(String(store.query('SELECT payload FROM decision WHERE id=?', outcome.decisionID)[0].payload));
      const input = JSON.stringify({ decisionID: decision.id, decision, outcome }), session = `native:${row.provider}:task:${row.id}`;
      store.query("UPDATE agent_work SET title=?,instructions=?,progress='',provider=?,sessionKey=? WHERE id=?", decision.title, input, String(row.provider), session, String(row.workID));
      store.query('UPDATE agent_job SET sessionKey=?,input=?,title=? WHERE id=?', session, input, decision.title, String(row.id));
    }
    store.db.exec('DROP TABLE IF EXISTS agent_job_dependency');
  });
}


/** Upgrade once, with the original database already backed up by PolarisStore. */
export function simplifyWorkspace(store: PolarisStore) {
  store.db.exec(`
    CREATE TABLE scheduled_task(id TEXT PRIMARY KEY,strategyID TEXT NOT NULL REFERENCES strategy(id),title TEXT NOT NULL,instructions TEXT NOT NULL,inputs TEXT NOT NULL DEFAULT '{"artifactIDs":[],"knowledgeIDs":[]}',config TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,nextAt TEXT,pendingAt TEXT);
    CREATE TABLE schedule_run_new(id TEXT PRIMARY KEY,scheduleID TEXT NOT NULL REFERENCES scheduled_task(id),strategyID TEXT NOT NULL REFERENCES strategy(id),version INTEGER NOT NULL,plannedAt TEXT NOT NULL,workID TEXT UNIQUE REFERENCES agent_work(id),jobID TEXT REFERENCES agent_job(id),createdAt TEXT NOT NULL,UNIQUE(scheduleID,version,plannedAt));
    CREATE TABLE IF NOT EXISTS agent_run_review(jobID TEXT NOT NULL REFERENCES agent_job(id),generation INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(jobID,generation));
  `);
  for (const row of store.query('SELECT r.*,s.revisionID,s.nextAt,s.pendingAt FROM schedule_revision r LEFT JOIN strategy_schedule s ON s.strategyID=r.strategyID')) {
    const config = JSON.parse(String(row.config)), strategy = store.get('strategy', String(row.strategyID));
    const timing = { rule: config.rule, timezone: config.timezone, ...(config.expiresAt ? { expiresAt: config.expiresAt } : {}) };
    const active = row.id === row.revisionID ? 1 : 0;
    store.query('INSERT INTO scheduled_task(id,strategyID,title,instructions,config,version,active,nextAt,pendingAt) VALUES(?,?,?,?,?,?,?,?,?)', String(row.id), strategy.id, strategy.title,
      `Advance this strategy using the current goal, principles, decisions and knowledge.`, JSON.stringify(timing), Number(row.baseVersion) + 1, active, active ? row.nextAt as string | null : null, active ? row.pendingAt as string | null : null);
  }
  store.db.exec(`
    INSERT INTO schedule_run_new SELECT r.id,r.revisionID,r.strategyID,t.version,r.plannedAt,r.workID,r.jobID,r.createdAt FROM schedule_run r JOIN scheduled_task t ON t.id=r.revisionID;
    INSERT OR IGNORE INTO agent_run_review SELECT j.id,j.generation,json_object('action','checked','note','Schedule recovery was confirmed before upgrade.','createdAt',r.reviewedAt) FROM schedule_run r JOIN agent_job j ON j.workID=r.workID WHERE r.reviewedAt IS NOT NULL;
    DROP TABLE schedule_run;
    ALTER TABLE schedule_run_new RENAME TO schedule_run;
    DROP TABLE strategy_schedule;
    DROP TABLE schedule_revision;
    CREATE INDEX schedule_runs_strategy ON schedule_run(strategyID,plannedAt);
  `);
  if (store.query("SELECT 1 FROM sqlite_master WHERE name='strategy_loop'").length) {
    for (const row of store.query('SELECT * FROM strategy_loop WHERE waitUntil IS NOT NULL')) {
      const strategy = store.get('strategy', String(row.strategyID));
      store.query('INSERT INTO scheduled_task(id,strategyID,title,instructions,config,nextAt) VALUES(?,?,?,?,?,?)', `wait:${strategy.id}`, strategy.id, strategy.title,
        `Continue the authorized work using current context.\n${row.reason}`, JSON.stringify({ timezone: 'UTC', rule: { frequency: 'once', at: row.waitUntil } }), String(row.waitUntil));
    }
    store.db.exec('DROP TABLE strategy_loop');
  }
  // Preserve accepted follow-up instructions without preserving the old finish_task protocol.
  for (const row of store.query("SELECT j.id,j.workID,j.next,w.strategyID FROM agent_job j JOIN agent_work w ON w.id=j.workID WHERE j.next IS NOT NULL AND j.state IN ('queued','running','waiting_connection')")) {
    const next = JSON.parse(String(row.next));
    const strategy = store.get('strategy', String(row.strategyID));
    if (next.next === 'continue') {
      const at = new Date().toISOString();
      store.query('INSERT INTO scheduled_task(id,strategyID,title,instructions,inputs,config,nextAt) VALUES(?,?,?,?,?,?,?)', `next:${row.id}`, strategy.id,
        next.title, next.instruction, JSON.stringify({ artifactIDs: next.artifactIDs ?? [], knowledgeIDs: [] }), JSON.stringify({ timezone: 'UTC', rule: { frequency: 'once', at } }), at);
    } else if (next.next === 'wait') store.query('INSERT OR IGNORE INTO scheduled_task(id,strategyID,title,instructions,config,nextAt) VALUES(?,?,?,?,?,?)', `wait:${strategy.id}`, strategy.id, strategy.title,
      `Continue the authorized work using current context.\n${next.reason}`, JSON.stringify({ timezone: 'UTC', rule: { frequency: 'once', at: next.until } }), String(next.until));
  }
  store.db.exec(`ALTER TABLE agent_job DROP COLUMN next;
    CREATE TABLE decision_source(decisionID TEXT PRIMARY KEY REFERENCES decision(id),sourceJobID TEXT REFERENCES agent_job(id),issueKey TEXT NOT NULL DEFAULT '');
    INSERT INTO decision_source SELECT d.decisionID,j.id,CASE WHEN length(trim(d.issueKey))>0 THEN d.issueKey ELSE d.decisionID END FROM agent_decision_work d LEFT JOIN agent_job j ON j.id=d.sourceJobID;
    UPDATE agent_work SET state='cancelled',waitingDecisionID=NULL WHERE id IN (SELECT workID FROM agent_decision_work) AND NOT EXISTS(SELECT 1 FROM agent_job WHERE workID=agent_work.id);
    DROP TABLE agent_decision_work;
  `);
  for (const row of store.query('SELECT id,payload FROM decision')) {
    const card = JSON.parse(String(row.payload));
    const action = card.responseMode === 'action';
    if (card.tried) card.background += `\n\n${card.tried}`;
    if (action) card.options = [{ id: 'done', label: translator(matchLanguage(process.env.POLARIS_LANGUAGE) ?? 'en')('board.markDone') }];
    for (const option of card.options) {
      if (option.changes?.length) option.detail = [option.detail, ...option.changes.map((change: { before: string; after: string }) => `${change.before || '∅'} → ${change.after || '∅'}`)].filter(Boolean).join('\n\n');
      delete option.changes;
    }
    delete card.responseMode; delete card.tried;
    card.version++; store.persist('decision', card);
    if (action) for (const saved of store.query('SELECT payload FROM outcome WHERE decision_id=?', card.id)) {
      const outcome = JSON.parse(String(saved.payload));
      if (!outcome.optionID && !outcome.note?.trim()) { outcome.optionID = 'done'; store.persistOutcome(outcome); }
    }
  }
  // Unsent decisions return to the main coordinator; accepted runs are never replayed.
  store.query("UPDATE agent_job SET kind='main',workID=NULL,sessionKey=NULL,provider=NULL WHERE outcomeID IS NOT NULL AND state IN ('queued','waiting_connection') AND delivery IN ('queued','not_sent','preparing') AND acceptedAt IS NULL");
}


export function consolidateRecords(store: PolarisStore) {
  for (const row of store.query('SELECT payload FROM goal')) {
    const goal = JSON.parse(String(row.payload));
    const policies = store.query("SELECT payload FROM policy WHERE parent_id=? AND status='active' ORDER BY rowid", goal.id).map(item => JSON.parse(String(item.payload)));
    goal.constraints = [goal.constraints, ...policies.map(p => p.title.trim() === p.body.trim() ? p.body : `${p.title}\n${p.body}`)].filter(Boolean).join('\n\n');
    goal.version++; goal.updatedAt = new Date().toISOString(); store.persist('goal', goal);
  }
  // Original policy records remain immutable history; no live policy entity or write path survives.
  store.db.exec("INSERT OR IGNORE INTO revision(kind,entity_id,version,payload) SELECT 'policy',id,version,payload FROM policy; DROP TABLE policy;");
  for (const row of store.query('SELECT payload FROM decision')) {
    const card = JSON.parse(String(row.payload));
    card.body = card.summary && !card.background.startsWith(card.summary) ? `${card.summary}\n\n${card.background}` : card.background;
    const recommended = card.options.find((option: { id: string }) => option.id === card.recommendedOptionID);
    if (recommended && card.recommendationReason && !recommended.detail?.includes(card.recommendationReason)) recommended.detail = [recommended.detail, card.recommendationReason].filter(Boolean).join('\n\n');
    delete card.summary; delete card.background; delete card.recommendationReason; delete card.agent;
    card.version++; card.updatedAt = new Date().toISOString(); store.persist('decision', card);
  }
  for (const row of store.query("SELECT j.id,j.input,o.decision_id FROM agent_job j JOIN outcome o ON o.id=j.outcomeID WHERE j.state IN ('queued','waiting_connection') AND j.acceptedAt IS NULL AND j.delivery IN ('queued','not_sent','preparing')")) {
    let input; try { input = JSON.parse(String(row.input)); } catch { continue; }
    if (input && typeof input === 'object' && input.decision) {
      input.decision = store.get('decision', String(row.decision_id));
      store.query('UPDATE agent_job SET input=? WHERE id=?', JSON.stringify(input), String(row.id));
    }
  }
}
