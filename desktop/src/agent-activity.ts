// R-D66: English activity presentation follows the inspected ChatGPT desktop renderer.
import type { AgentMessage, AgentToolCall } from '../service/agent-store';
import { finalAnswerIndex } from './agent-turn.ts';

export type ToolKind = 'read' | 'list' | 'edit' | 'command' | 'search' | 'update' | 'delegate' | 'decision' | 'other';
export type ToolIconName = 'terminal' | 'folder' | 'edit' | 'globe' | 'plugin';

export function toolState(call: AgentToolCall, active: boolean, stopped: boolean) {
  return call.state === 'running' && !active ? stopped ? 'cancelled' : 'interrupted' : call.state;
}

export function activityIndicator(message: AgentMessage | undefined, active: boolean): { kind: 'none' | 'thinking' | 'tool' | 'exploring'; index: number } {
  if (!active) return { kind: 'none', index: -1 };
  const parts = message?.parts ?? [];
  const index = parts.length - 1, last = parts[index];
  if (last?.type === 'activity') {
    if (last.calls.some(call => call.state === 'running')) return { kind: 'tool', index };
    const tail = last.calls.at(-1);
    if (tail?.state === 'completed' && ['read', 'list'].includes(toolKind(tail))) return { kind: 'exploring', index };
    return { kind: 'thinking', index };
  }
  if (message?.provider && message.provider !== 'chatgpt-codex' && last?.type === 'text' && last.text.trim()) return { kind: 'none', index: -1 };
  if (finalAnswerIndex(parts, false) >= 0) return { kind: 'none', index: -1 };
  return { kind: 'thinking', index: -1 };
}

// Saved activity may still contain the former MCP server name.
const canonicalName = (call: AgentToolCall) => call.name.replace(/^mcp__(?:polaris|resolve)__/, '');

export function toolKind(call: AgentToolCall): ToolKind {
  const name = canonicalName(call);
  const native = ({ read: 'read', edit: 'edit', delete: 'edit', move: 'edit', search: 'search', execute: 'command', think: 'other', fetch: 'search' } as Record<string, ToolKind>)[call.kind ?? ''];
  if (native) return native;
  if (['Read', 'Glob', 'Grep', 'read_file', 'read_many_files'].includes(name)) return name === 'Grep' ? 'search' : 'read';
  if (['Bash', 'run_shell_command', 'commandExecution'].includes(name)) return 'command';
  if (['Edit', 'Write', 'fileChange', 'write_file', 'replace'].includes(name)) return 'edit';
  if (['read_file', 'get_context', 'read_artifact', 'get_capabilities'].includes(name)) return 'read';
  if (name === 'list_directory') return 'list';
  if (name === 'apply_patch') return 'edit';
  if (name === 'shell') return 'command';
  if (['web_search', 'webSearch', 'WebSearch', 'WebFetch', 'web_fetch', 'google_web_search', 'grep_search', 'search_file_content'].includes(name)) return 'search';
  if (name === 'start_work') return 'delegate';
  if (name === 'request_decisions') return 'decision';
  if (['manage_context', 'manage_decision', 'manage_work', 'save_progress', 'write_artifact'].includes(name)) return 'update';
  return 'other';
}

function inputObject(call: AgentToolCall): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(call.input ?? '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

export function toolTarget(call: AgentToolCall) {
  const input = inputObject(call), operation = input.operation as { path?: unknown } | undefined;
  const value = toolKind(call) === 'command' ? (Array.isArray(input.commands) ? input.commands.join(' && ') : input.command)
    : toolKind(call) === 'search' ? input.query ?? input.pattern ?? (Array.isArray(input.queries) ? input.queries.join(', ') : undefined)
    : input.path ?? operation?.path ?? input.title;
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : call.title ?? (call.name === 'shell' ? call.input ?? '' : '');
}

const verbs: Record<ToolKind, [string, string, string]> = {
  read: ['Read', 'Reading', 'Read'], list: ['List', 'Listing', 'Listed'], edit: ['Edit', 'Editing', 'Edited'],
  command: ['Run', 'Running', 'Ran'], search: ['Search', 'Searching', 'Searched'], update: ['Update', 'Updating', 'Updated'],
  delegate: ['Delegate', 'Delegating', 'Delegated'], decision: ['Request', 'Requesting', 'Requested'], other: ['Call', 'Calling', 'Called'],
};
const namedTargets: Record<string, string> = {
  get_context: 'workspace context', get_capabilities: 'capabilities', read_artifact: 'artifact', list_directory: 'files', read_file: 'file',
  save_progress: 'progress', write_artifact: 'artifact', manage_context: 'goals and strategies',
  manage_decision: 'decision cards', manage_work: 'tasks', shell: 'command', web_search: 'the web', start_work: 'task', request_decisions: 'decision cards',
};

export function toolLabel(call: AgentToolCall, state: string) {
  const index = state === 'running' ? 1 : state === 'completed' ? 2 : 0;
  const label = call.name === 'get_capabilities' ? ['Check', 'Checking', 'Checked'][index] : verbs[toolKind(call)][index];
  return { label, target: toolTarget(call) || namedTargets[canonicalName(call)] || call.name };
}

const fileReaders = new Set(['read_file', 'read_many_files', 'list_directory', 'Read', 'Glob', 'glob', 'list_files']);
function searchSource(call: AgentToolCall) {
  if (['Grep', 'grep_search', 'search_file_content', 'glob'].includes(call.name) || call.source === 'files') return 'files';
  if (['web_search', 'webSearch', 'WebSearch', 'WebFetch', 'web_fetch', 'google_web_search'].includes(call.name) || call.kind === 'fetch' || call.source === 'web') return 'web';
  return 'unknown';
}
function groupedCalls(calls: AgentToolCall[]) {
  const groups = new Map<ToolKind, AgentToolCall[]>();
  for (const call of calls) {
    const kind = toolKind(call) === 'list' ? 'read' : toolKind(call);
    const group = groups.get(kind);
    if (group) group.push(call); else groups.set(kind, [call]);
  }
  const order: ToolKind[] = ['edit', 'read', 'command', 'search', 'update', 'delegate', 'decision', 'other'];
  return new Map([...groups].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)));
}

export function toolGroupSummary(calls: AgentToolCall[]) {
  const labels = [...groupedCalls(calls)].map(([kind, items]) => {
    const plural = items.length > 1;
    switch (kind) {
      case 'read': return items.every(call => fileReaders.has(call.name)) ? 'Read files'
        : items.every(call => call.name === 'get_capabilities') ? 'Checked capabilities'
        : items.some(call => fileReaders.has(call.name)) ? 'Read files and context' : 'Read context';
      case 'edit': return 'Edited files';
      case 'command': return plural ? 'Ran commands' : 'Ran a command';
      case 'search': {
        const sources = new Set(items.map(searchSource));
        return sources.size === 1 && sources.has('web') ? 'Searched the web'
          : sources.size === 1 && sources.has('files') ? 'Searched files'
          : !sources.has('unknown') ? 'Searched files and the web' : 'Searched';
      }
      case 'update': return 'Updated workspace';
      case 'delegate': return plural ? 'Delegated tasks' : 'Delegated a task';
      case 'decision': return plural ? 'Requested decisions' : 'Requested a decision';
      default: return plural ? 'Called tools' : 'Called a tool';
    }
  }).map((label, index) => index ? label.charAt(0).toLowerCase() + label.slice(1) : label);
  if (labels.length < 3) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

export function toolIconName(call: AgentToolCall): ToolIconName {
  const kind = toolKind(call);
  if (kind === 'read' || kind === 'command') return 'terminal';
  if (kind === 'list') return 'folder';
  if (kind === 'edit' || kind === 'update') return 'edit';
  return kind === 'search' ? searchSource(call) === 'web' ? 'globe' : searchSource(call) === 'files' ? 'folder' : 'plugin' : 'plugin';
}

export function toolGroupIcons(calls: AgentToolCall[]): ToolIconName[] {
  return [...new Set([...groupedCalls(calls).values()].map(group => toolIconName(group[0])))].slice(0, 2);
}

export function toolDuration(call: AgentToolCall) {
  if (!call.startedAt || !call.completedAt) return '';
  const seconds = (Date.parse(call.completedAt) - Date.parse(call.startedAt)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s` : '';
}
