import test from 'node:test';
import assert from 'node:assert/strict';
import { finalAnswerIndex, projectTurn, workLabel } from '../src/agent-turn.ts';

const text = (phase, value = 'Text', extra = {}) => ({ type: 'text', text: value, phase, ...extra });
const tools = { type: 'activity', calls: [{ id: 'read', name: 'read_file', state: 'completed', startedAt: '2026-10-30T00:00:20Z', completedAt: '2026-10-30T00:00:25Z' }] };
const job = { state: 'running', startedAt: '2026-10-30T00:00:00Z' };

test('only the current explicit final answer ends running work; later work revokes it', () => {
  for (const phase of [undefined, 'commentary', 'partial_answer']) assert.equal(finalAnswerIndex([text(phase)], false), -1);
  const final = text('final_answer');
  assert.equal(finalAnswerIndex([tools, final], false), 1);
  assert.equal(finalAnswerIndex([tools, final, tools], false), -1);
  assert.equal(finalAnswerIndex([final, text('commentary')], false), -1);
  assert.equal(finalAnswerIndex([final, tools, text('final_answer')], false), 2);
  assert.equal(finalAnswerIndex([text('final_answer', '')], false), -1);
});

test('legacy final fallback uses only the trailing text of a completed turn', () => {
  const parts = [tools, text(undefined, 'I will check.'), tools, text(undefined, 'The result.')];
  const turn = projectTurn({ parts }, { state: 'completed' });
  assert.equal(turn.answer.text, 'The result.');
  assert.equal(turn.process.length, 3);
  assert.equal(turn.canCollapse, true);
  assert.equal(turn.timing, undefined);
  assert.equal(workLabel(turn.status), 'Activity');
  assert.equal(projectTurn({ parts }, { state: 'failed' }).answer, undefined);
  assert.equal(finalAnswerIndex([text('commentary')], true), -1);
  assert.equal(finalAnswerIndex([text('partial_answer')], true), -1);
});

test('whole-turn timing includes pre-tool work and freezes when the final message starts', () => {
  const parts = [text('commentary'), tools, text('final_answer', 'Done.', { startedAt: '2026-10-30T00:00:30Z' })];
  const turn = projectTurn({ parts }, job);
  assert.equal(turn.status, 'worked');
  assert.equal(workLabel(turn.status, turn.timing.start, turn.timing.end, Date.parse('2026-10-30T01:00:00Z')), 'Worked for 30s');
  assert.equal(projectTurn({ parts: [...parts, tools] }, job).status, 'working');
  assert.equal(projectTurn({ parts: [text('commentary'), parts[2]] }, job).canCollapse, true, 'Commentary alone is process too.');
});

test('stopping freezes the timer and errors cannot hide recovery behind automatic collapse', () => {
  const parts = [tools, text('final_answer', 'Partial result.')];
  const stopped = projectTurn({ parts }, { ...job, state: 'cancelled', completedAt: '2026-10-30T00:00:31Z' });
  assert.equal(stopped.canCollapse, false);
  assert.equal(workLabel(stopped.status, stopped.timing?.start, stopped.timing?.end), 'You stopped after 31s');
  assert.equal(projectTurn({ parts }, { ...job, state: 'failed' }).canCollapse, false);
  assert.equal(workLabel('working', 0, undefined, 500), 'Working');
  assert.equal(workLabel('worked', 0, 212000), 'Worked for 3m 32s');
});

test('ACP providers preserve unknown phases and time the completed turn', () => {
 const parts = [tools, text(undefined, 'Gemini result', { startedAt: '2026-10-30T00:00:05Z' })];
 const message = { provider: 'gemini-cli', parts };
 assert.equal(projectTurn(message, job).answer, undefined);
 const done = projectTurn(message, { ...job, state: 'completed', completedAt: '2026-10-30T00:00:40Z' });
 assert.equal(done.answer.text, 'Gemini result');
 assert.equal(done.timing.end, Date.parse('2026-10-30T00:00:40Z'));
 assert.equal(done.answer.phase, undefined);
});
