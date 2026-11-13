import { presentationPolicy } from './agent-presentation/index.ts';
import type { AgentJob, AgentMessage, AgentPart } from '../service/agent-store';
import type { AgentSnapshot } from '../service/agent-store';

export function onboardingTurnIdle(snapshot: AgentSnapshot) {
  return !snapshot.jobs.some(job => job.kind === 'main' &&
    (['queued', 'running'].includes(job.state) || snapshot.native?.activeJobIDs.includes(job.id) ||
      snapshot.messages.some(message => message.id === `${job.id}:assistant` && message.state === 'running')));
}

// Later work invalidates an earlier final answer. Missing phase is unknown until the turn finishes.
export function finalAnswerIndex(parts: AgentPart[], completed: boolean) {
  const index = parts.length - 1, last = parts[index];
  if (last?.type !== 'text' || !(last.text.trim() || last.complete)) return -1;
  return last.phase === 'final_answer' || (completed && last.phase === undefined && !!last.text.trim()) ? index : -1;
}

function timestamp(value: string | null | undefined) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : undefined;
}

export function projectTurn(message: AgentMessage | undefined, job: AgentJob | undefined) {
  const active = job?.state === 'running' || job?.state === 'queued';
  const completed = job ? ['completed', 'waiting_decision'].includes(job.state) : message?.state === 'completed';
  const parts: AgentPart[] = message?.parts?.length ? message.parts : message?.body ? [{ type: 'text', text: message.body }] : [];
  const policy = presentationPolicy(message?.provider);
  const finalIndex = policy.explicitFinal || completed ? finalAnswerIndex(parts, completed) : -1;
  const process = parts.slice(0, finalIndex < 0 ? parts.length : finalIndex);
  const answer = finalIndex < 0 ? undefined : parts[finalIndex] as Extract<AgentPart, { type: 'text' }>;
  const start = timestamp(job?.startedAt);
  const interrupted = !!job && !active && !completed;
  const end = interrupted ? timestamp(job?.completedAt) : answer && policy.freezeAtAnswer ? timestamp(answer.startedAt) : !active ? timestamp(job?.completedAt) : undefined;
  const canCollapse = !!answer && !interrupted && process.length > 0;
  // Old records have no reliable whole-turn timing; never substitute tool duration for it.
  const timing = start !== undefined && (active || end !== undefined) ? { start, end } : undefined;
  const status = job?.state === 'cancelled' ? 'stopped' : interrupted ? 'interrupted'
    : answer && timing?.end !== undefined ? 'worked' : job?.state === 'running' && !answer ? 'working' : 'unknown';
  return { process, answer, active, canCollapse, timing, status };
}

export function workLabel(status: string, start?: number, end?: number, now = Date.now()) {
  if (status === 'unknown') return 'Activity';
  if (status === 'interrupted') return 'Interrupted';
  if (start === undefined || (status !== 'working' && end === undefined)) return status === 'stopped' ? 'Stopped' : 'Activity';
  const seconds = Math.max(0, Math.floor(((end ?? now) - start) / 1000));
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return status === 'stopped' ? `You stopped after ${elapsed}` : status === 'working'
    ? seconds < 1 ? 'Working' : `Working for ${elapsed}` : `Worked for ${elapsed}`;
}
