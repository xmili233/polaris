import { z } from 'zod';
import type { PolarisStore } from './store.js';
import type { AgentJob } from './agent-store.js';
import { PolarisError, encode } from './model.js';

const ids = z.array(z.string().regex(/^[a-zA-Z0-9_.-]{1,160}$/)).max(20).default([]);
export const executionInputsSchema = z.object({ artifactIDs: ids, knowledgeIDs: ids }).strict();
export type ExecutionInputs = z.infer<typeof executionInputsSchema>;
export function parseInputs(value: unknown): ExecutionInputs {
  const parsed = executionInputsSchema.safeParse(value ?? {});
  if (!parsed.success) throw new PolarisError('invalid_input', 'Invalid execution inputs.', 'execution.inputsInvalid');
  return { artifactIDs: [...new Set(parsed.data.artifactIDs)], knowledgeIDs: [...new Set(parsed.data.knowledgeIDs)] };
}
function hasTable(store: PolarisStore, name: string) { return !!store.query("SELECT 1 FROM sqlite_master WHERE name=?", name).length; }
function missingInputs(store: PolarisStore, input: ExecutionInputs, goalID: string) {
  const missing: { kind: 'artifact' | 'knowledge'; id: string }[] = [];
  for (const id of input.artifactIDs) if (!hasTable(store, 'agent_artifact') || !store.query("SELECT 1 FROM agent_artifact WHERE id=? AND length(trim(body))>0", id).length) missing.push({ kind: 'artifact', id });
  for (const id of input.knowledgeIDs) if (!hasTable(store, 'knowledge_goal') || !store.query("SELECT 1 FROM knowledge k JOIN knowledge_goal g ON g.documentID=k.id WHERE k.id=? AND k.status='active' AND g.goalID=?", id, goalID).length) missing.push({ kind: 'knowledge', id });
  return missing;
}
export function validateInputs(store: PolarisStore, value: unknown, goalID: string) {
  const input = parseInputs(value), missing = missingInputs(store, input, goalID);
  if (missing.length) throw new PolarisError('not_found', 'Required inputs are unavailable. Link knowledge to the target goal before assigning it.', 'execution.inputMissing');

}
function inputRecord(store: PolarisStore, job: AgentJob) {
  return store.query(`SELECT i.jobID,i.payload FROM agent_job_inputs i JOIN agent_job j ON j.id=i.jobID WHERE j.id=? OR (j.sessionKey=? AND j.seq<=(SELECT seq FROM agent_job WHERE id=?)) ORDER BY j.seq DESC LIMIT 1`, job.id, job.sessionKey ?? '', job.id)[0];
}
export function taskInputs(store: PolarisStore, job: AgentJob): ExecutionInputs {
  const row = inputRecord(store, job); return parseInputs(row ? JSON.parse(String(row.payload)) : {});
}
export function saveInputs(store: PolarisStore, jobID: string, input: unknown) {
  const parsed = parseInputs(input), payload = encode(parsed), prior = store.query('SELECT payload FROM agent_job_inputs WHERE jobID=?', jobID)[0];
  if (prior && encode(parseInputs(JSON.parse(String(prior.payload)))) !== payload) throw new PolarisError('conflict', 'Execution inputs are already bound to this task.', 'execution.changed');
  store.query('INSERT OR IGNORE INTO agent_job_inputs(jobID,payload) VALUES(?,?)', jobID, payload);

}
export function inputStatus(store: PolarisStore, job: AgentJob) {
  const input = taskInputs(store, job);
  const goalID = job.workID ? String(store.query('SELECT s.parent_id FROM agent_work w JOIN strategy s ON s.id=w.strategyID WHERE w.id=?', job.workID)[0]?.parent_id ?? '') : job.outcomeID ? String(store.query('SELECT s.parent_id FROM outcome o JOIN decision d ON d.id=o.decision_id JOIN strategy s ON s.id=d.parent_id WHERE o.id=?', job.outcomeID)[0]?.parent_id ?? '') : '';
  const missing = missingInputs(store, input, goalID);
  return { ready: missing.length === 0, missing };
}
