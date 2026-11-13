import type { ProviderID } from './agent-store.js';
import { PolarisStore } from './store.js';
import { PolarisError } from './model.js';
export interface ExecutionSummary {
  jobID: string; workID: string; taskID: string; generation: number; title: string; goalID: string; goalTitle: string; strategyID: string; strategyTitle: string;
  provider: ProviderID; state: string; status: string; summary: string; updatedAt: string; decisionID: string | null;
}
const changed = () => new PolarisError('conflict', 'Execution changed; reload before reviewing.', 'execution.changed');
const joins = `FROM agent_job j JOIN agent_work w ON w.id=j.workID JOIN strategy s ON s.id=w.strategyID JOIN goal g ON g.id=s.parent_id
  LEFT JOIN outcome o ON o.id=COALESCE(j.outcomeID,j.outcomeContextID) LEFT JOIN decision d ON d.id=COALESCE(o.decision_id,j.handoffDecisionID)
  LEFT JOIN agent_run_result r ON r.jobID=j.id AND r.generation=j.generation
  LEFT JOIN agent_run_review v ON v.jobID=j.id AND v.generation=j.generation
  LEFT JOIN metadata dismissed ON dismissed.key='execution_dismissed:'||j.id||':'||j.generation`;
const fields = `j.id AS jobID,j.workID,j.sessionKey AS taskID,j.generation,j.state,j.provider,
  COALESCE(j.handoffDecisionID,(SELECT prior.handoffDecisionID FROM agent_job prior WHERE prior.sessionKey=j.sessionKey AND prior.seq<=j.seq AND prior.handoffDecisionID IS NOT NULL ORDER BY prior.seq LIMIT 1)) AS handoffDecisionID,
  COALESCE(j.title,json_extract(d.payload,'$.title'),w.title) AS title,s.id AS strategyID,g.id AS goalID,
  json_extract(g.payload,'$.title') AS goalTitle,json_extract(s.payload,'$.title') AS strategyTitle,d.id AS decisionID,
  COALESCE(r.updatedAt,j.completedAt,j.createdAt) AS updatedAt,r.payload AS result`;


export class Executions {
  constructor(readonly store: PolarisStore) {
    store.db.exec(`CREATE INDEX IF NOT EXISTS agent_jobs_session ON agent_job(sessionKey,seq);
      CREATE TABLE IF NOT EXISTS agent_run_review(jobID TEXT NOT NULL REFERENCES agent_job(id),generation INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(jobID,generation));`);
  }
  private summary(row: Record<string, any>): ExecutionSummary {
    const result = row.result ? JSON.parse(row.result) : null;
    return { provider: row.provider, jobID: row.jobID, workID: row.workID, taskID: row.taskID, generation: row.generation, title: row.title, goalID: row.goalID, goalTitle: row.goalTitle,
      strategyID: row.strategyID, strategyTitle: row.strategyTitle, state: row.state, status: row.state, summary: (result?.summary ?? '').slice(0, 800), updatedAt: row.updatedAt,
      decisionID: row.decisionID };
  }
  /** Only unresolved failures need an entry after the native run ends. */
  results() {
    const rows = this.store.query(`SELECT ${fields} ${joins}
      WHERE j.provider IS NOT NULL AND j.kind='work' AND j.state IN ('failed','needs_review')
      AND dismissed.key IS NULL AND v.jobID IS NULL
      AND j.seq=(SELECT MAX(last.seq) FROM agent_job last WHERE last.sessionKey=j.sessionKey) ORDER BY j.seq DESC`);
    return rows.map(row => ({ ...this.summary(row), kind: 'attention' as const }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  dismiss(workID: string, jobID: string, generation: number) {
    const target = this.store.query(`SELECT 1 FROM agent_job j LEFT JOIN agent_run_result r ON r.jobID=j.id AND r.generation=j.generation
      WHERE j.id=? AND j.workID=? AND j.generation=? AND j.provider IS NOT NULL AND j.kind='work'
      AND (j.state IN ('failed','needs_review') )
      AND j.seq=(SELECT MAX(last.seq) FROM agent_job last WHERE last.sessionKey=j.sessionKey)`, jobID, workID, generation)[0];
    if (!target) throw changed();
    // Acknowledging the alert is separate from approving a schedule to run again.
    this.store.query('INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)', `execution_dismissed:${jobID}:${generation}`, new Date().toISOString());
  }
}
