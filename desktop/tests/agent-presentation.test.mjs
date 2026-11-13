import test from 'node:test';
import assert from 'node:assert/strict';
import { activityIndicator, toolDuration, toolGroupIcons, toolGroupSummary, toolIconName, toolKind, toolLabel, toolState, toolTarget } from '../src/agent-activity.ts';

const call = (name, input, extra = {}) => ({ id: name, name, state: 'completed', ...(input ? { input: JSON.stringify(input) } : {}), ...extra });

test('Thinking follows the latest activity and final-answer phase, not arbitrary body text', () => {
  const message = parts => ({ id: 'm', role: 'assistant', body: 'Visible commentary', state: 'running', createdAt: '', parts });
  assert.equal(activityIndicator(message([]), true).kind, 'thinking', 'Text without phase cannot end a running turn.');
  assert.equal(activityIndicator({ ...message([]), body: '' }, true).kind, 'thinking');
  const commentary = { type: 'text', text: 'I will check.', phase: 'commentary', complete: true };
  assert.equal(activityIndicator(message([commentary]), true).kind, 'thinking');
  assert.deepEqual(activityIndicator(message([commentary, { type: 'activity', calls: [call('shell')] }]), true), { kind: 'thinking', index: 1 });
  assert.equal(activityIndicator(message([{ type: 'activity', calls: [call('read_file')] }]), true).kind, 'exploring');
  assert.equal(activityIndicator(message([{ type: 'activity', calls: [call('shell', {}, { state: 'running' })] }]), true).kind, 'tool');
  const answer = { type: 'text', text: 'The result is ready.', phase: 'final_answer', complete: false };
  assert.equal(activityIndicator(message([commentary, answer]), true).kind, 'none');
  assert.equal(activityIndicator(message([commentary]), false).kind, 'none');
});

test('completed activity summaries use English actions without per-call counts or reordering calls', () => {
  const calls = [call('read_file', { path: 'a.ts' }), call('web_search'), call('shell'), call('apply_patch', { path: 'a.ts' })];
  assert.equal(toolGroupSummary(calls), 'Edited files, read files, ran a command, and searched the web');
  assert.deepEqual(toolGroupIcons(calls), ['edit', 'terminal']);
  assert.deepEqual(calls.map(item => item.name), ['read_file', 'web_search', 'shell', 'apply_patch']);
});

test('workspace context is distinguished from file reads and tool icons reflect real categories', () => {
  assert.equal(toolGroupSummary([call('read_file'), call('list_directory'), call('shell')]), 'Read files and ran a command');
  assert.equal(toolGroupSummary([call('get_context'), call('get_capabilities')]), 'Read context');
  assert.equal(toolIconName(call('read_file')), 'terminal');
  assert.equal(toolIconName(call('list_directory')), 'folder');
  assert.equal(toolIconName(call('web_search')), 'globe');
  assert.equal(toolIconName(call('external_custom_tool')), 'plugin');
  assert.equal(toolKind(call('external_custom_tool')), 'other');
  for (const server of ['polaris', 'resolve']) assert.equal(toolKind(call(`mcp__${server}__get_context`)), toolKind(call('get_context')));
});

test('running calls become stopped or interrupted only when their run is no longer active', () => {
  const item = call('shell', {}, { state: 'running' });
  assert.equal(toolState(item, true, false), 'running');
  assert.equal(toolState(item, false, true), 'cancelled');
  assert.equal(toolState(item, false, false), 'interrupted');
  assert.equal(toolState({ ...item, state: 'failed' }, true, false), 'failed');
});

test('targets and details tolerate legacy calls and malformed saved input', () => {
  assert.equal(toolTarget(call('shell', { commands: ['pwd', 'ls -la'] })), 'pwd && ls -la');
  assert.equal(toolTarget(call('apply_patch', { operation: { path: 'src/App.tsx' } })), 'src/App.tsx');
  assert.equal(toolTarget(call('read_file', null, { input: '{partial' })), '');
  assert.deepEqual(toolLabel(call('get_context'), 'completed'), { label: 'Read', target: 'workspace context' });
  assert.deepEqual(toolLabel(call('get_capabilities'), 'running'), { label: 'Checking', target: 'capabilities' });
  assert.equal(toolDuration(call('shell')), '');
  assert.equal(toolDuration(call('shell', {}, { startedAt: '2026-10-29T00:00:00.000Z', completedAt: '2026-10-29T00:00:01.250Z' })), '1.3s');
});

test('native file reads and local searches never claim a web operation', () => {
  assert.equal(toolGroupSummary([call('Read'),call('Glob'),call('read_many_files')]),'Read files');
  assert.equal(toolGroupSummary([call('Grep'),call('grep_search')]),'Searched files');
  assert.equal(toolGroupSummary([call('custom',{},{kind:'search'})]),'Searched');
  assert.equal(toolGroupSummary([call('Grep'),call('WebSearch')]),'Searched files and the web');
  assert.equal(toolGroupSummary([call('Read'),call('get_context')]),'Read files and context');
  assert.equal(toolIconName(call('Grep')),'folder');
});
