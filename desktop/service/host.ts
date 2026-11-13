import type { Reply, DesktopResult } from './desktop-contract.js';
import { KnowledgeStore } from './knowledge.js';
import { matchLanguage } from '@polaris/i18n';
import { createInterface } from 'node:readline';
import { PolarisStore, defaultDatabase } from './store.js';
import { PolarisError, encode, object, string } from './model.js';
import { AgentCoordinator } from './agent-coordinator.js';
import { AgentOnboarding } from './agent-onboarding.js';
import type { ProviderID } from './agent-store.js';
import { AgentAttachments } from './agent-attachments.js';

const index = process.argv.indexOf('--database');
const database = index < 0 ? defaultDatabase : process.argv[index + 1];
let store: PolarisStore | undefined;
const open = () => store ??= new PolarisStore(database);
let knowledgeStore: KnowledgeStore | undefined;
const knowledge = () => knowledgeStore ??= new KnowledgeStore(open());
let coordinator: AgentCoordinator | undefined;
let onboarding: AgentOnboarding | undefined;
const onboardingAgent = () => onboarding ??= new AgentOnboarding(open(), () => send({ event: 'agentChanged' }));
let running = false;
function nativeAgent() {
  if (!coordinator) {
    // The main process keeps the Mac awake only while a native turn is executing (R-D122).
    const changed = () => { send({ event: 'agentChanged' }); const now = !!coordinator?.running(); if (now !== running) { running = now; send({ event: now ? 'agentRunning' : 'agentIdle' }); } };
    coordinator = new AgentCoordinator(open(), changed);
    void coordinator.refresh();
  }
  return coordinator;
}
function send(value: unknown) { if (parent) parent.postMessage(value); else process.stdout.write(`${encode(value)}\n`); }
function relativeDate(date: string, language: string) {
  const value = Date.parse(date); if (!Number.isFinite(value)) return date;
  const seconds = (value - Date.now()) / 1000, absolute = Math.abs(seconds);
  const unit: Intl.RelativeTimeFormatUnit = absolute < 60 ? 'second' : absolute < 3600 ? 'minute' : absolute < 86400 ? 'hour' : absolute < 604800 ? 'day' : absolute < 2592000 ? 'week' : absolute < 31536000 ? 'month' : 'year';
  const divisor = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[unit as 'second'];
  return new Intl.RelativeTimeFormat(matchLanguage(language) ?? 'en', { numeric: 'auto' }).format(Math.round(seconds / divisor), unit);
}
async function execute(method: string, p: Record<string, unknown>) {
  const required = (key: string) => { if (typeof p[key] !== 'string') throw new PolarisError('invalid_input', 'Missing or invalid desktop parameters.'); return p[key] as string; };
  switch (method) {
    case 'knowledgeList': return knowledge().list(p) satisfies Reply<'knowledgeList'>;
    case 'knowledgeRead': return knowledge().read(required('id')) satisfies Reply<'knowledgeRead'>;
    case 'knowledgeHistory': return knowledge().history(required('id')) satisfies Reply<'knowledgeHistory'>;
    case 'knowledgeRevision': {
      if (!Number.isSafeInteger(p.version) || Number(p.version) < 1) throw new PolarisError('invalid_input', 'Invalid version.', 'knowledge.invalid');
      return knowledge().revision(required('id'), Number(p.version));
    }
    case 'knowledgeRules': return knowledge().rules() satisfies Reply<'knowledgeRules'>;
    case 'knowledgeExport': return knowledge().exportMarkdown(required('id'));
    case 'knowledgeImportText': {
      const result = knowledge().importMarkdown(p);
      send({ event: 'agentChanged' }); return result;
    }
    case 'knowledgeSave': case 'knowledgeArchive': case 'knowledgeRestore': case 'knowledgeRulesSave': {
      const library = knowledge();
      const result = method === 'knowledgeSave' ? library.save(p) : method === 'knowledgeArchive' ? library.archive(p)
        : method === 'knowledgeRestore' ? library.restore(p) : library.saveRules(p);
      send({ event: 'agentChanged' }); return result;
    }
    case 'agentLocale': {
      const language = matchLanguage(p.language);
      if (!language) throw new PolarisError('invalid_input', 'Invalid language.');
      process.env.POLARIS_LANGUAGE = language;
      if (coordinator) coordinator.language = language;
      return null;
    }
    case 'workspaceStart': { const runtime = nativeAgent(); runtime.startScheduling(); return null; }
    case 'strategyRecords': {
      const strategy = open().get('strategy', required('strategyID'));
      const decisions = open().snapshot(true, strategy.goalID).decisions.filter(card => card.strategyID === strategy.id && card.outcome).sort((a,b) => b.outcome!.decidedAt.localeCompare(a.outcome!.decidedAt));
      return { strategy, decisions } satisfies DesktopResult<'strategyRecords'>;
    }
    case 'advanceStrategy': return nativeAgent().advanceStrategy(required('strategyID')) satisfies Reply<'advanceStrategy'>;
    case 'shutdown': await Promise.all([coordinator?.stop(), onboarding?.stop()]); return null;
    case 'agentOnboarding': return onboardingAgent().snapshot() satisfies Reply<'agentOnboarding'>;
    case 'agentOnboardingCheck': {
      const flow = onboardingAgent();
      if (p.stop === true) await flow.stop();
      else void flow.check(p.provider === undefined ? undefined : required('provider') as ProviderID).catch(() => {});
      return flow.snapshot();
    }
    case 'agentOnboardingContinue': return onboardingAgent().continue(async provider => {
      const runtime = nativeAgent();
      const result = await runtime.connect(provider);
      if (!result.connections.find(item => item.provider === provider)?.connected) return false;
      runtime.select(provider); return true;
    }) satisfies Reply<'agentOnboardingContinue'>;
    case 'agentSnapshot': return nativeAgent().conversation() satisfies Reply<'agentSnapshot'>;
    case 'agentActivity': {
      const runtime = nativeAgent();
      return { works: runtime.works(), results: runtime.data.executions.results(), latestReplyID: String(open().query("SELECT m.id FROM agent_message m JOIN agent_job j ON m.id=j.id||':assistant' WHERE j.kind='main' AND j.state IN ('completed','failed') AND m.role='assistant' ORDER BY j.seq DESC LIMIT 1")[0]?.id ?? '') } satisfies DesktopResult<'agentActivity'>;
    }
    case 'agentWorks': return nativeAgent().works() satisfies Reply<'agentWorks'>;
    case 'executionResults': return nativeAgent().data.executions.results() satisfies Reply<'executionResults'>;
    case 'agentWorkSnapshot': return nativeAgent().conversation(required('workID'), p.taskID === undefined ? undefined : required('taskID')) satisfies Reply<'agentWorkSnapshot'>;
    case 'agentWorkStop': return nativeAgent().stopWork(required('workID'), required('id')) satisfies Reply<'agentWorkStop'>;
    case 'agentAttachmentImport': return new AgentAttachments(open()).import(p.paths);
    case 'agentAttachmentDiscard': await new AgentAttachments(open()).discard(p.ids); return null;
    case 'agentSend': return nativeAgent().send(required('text'), p.requestID === undefined ? undefined : required('requestID'), p.attachments ?? []) satisfies Reply<'agentSend'>;
    case 'agentCancel': await nativeAgent().cancel(required('id')); return null;
    case 'agentRetry': nativeAgent().retry(required('id')); return null;
    case 'agentNative': {
      const runtime = nativeAgent(), provider = required('provider') as ProviderID;
      if (p.action === 'newSession') return runtime.newSession();
      if (p.action === 'connect') return runtime.connect(provider);
      if (p.action === 'disconnect') return runtime.disconnect(provider);
      if (p.action === 'select') return runtime.select(provider);
      if (p.action === 'modelOptions') return runtime.modelOptions(provider, required('model'));
      if (p.action === 'chooseModel') return runtime.chooseModel(provider, required('model'), p.taskID === undefined ? undefined : required('taskID'), p.settings);
      if (p.action === 'subModel') return runtime.selectSubModel(p.follow === true ? null : provider, p.follow === true ? '' : required('model'), p.settings as import('./agents/types.js').ModelSettings | undefined);
      if (p.action === 'permission') { runtime.permission(required('id'), required('option')); return runtime.snapshot(); }
      if (p.action === 'refresh') { await runtime.refresh(provider); return runtime.snapshot(); }
      throw new PolarisError('invalid_input', 'Unknown native Agent action.');
    }
    case 'snapshot': {
      const runtime = nativeAgent(), db = open(), changeToken = db.changeToken;
      if (p.changeToken === changeToken) return null;
      const hasData = !!db.query('SELECT 1 FROM goal LIMIT 1').length || ['knowledge', 'agent_job'].some(table => db.query('SELECT 1 FROM sqlite_master WHERE name=?', table).length && db.query(`SELECT 1 FROM ${table} LIMIT 1`).length);
      const board = db.snapshot();
      const schedules = runtime.schedules.list();
      return { board, hasData, changeToken, database: db.file, schedules, loops: runtime.loopStates(board, schedules) } satisfies DesktopResult<'snapshot'>;
    }
    case 'decide': {
      if (!Number.isSafeInteger(p.expectedVersion) || (p.optionID != null && typeof p.optionID !== 'string')) throw new PolarisError('invalid_input', 'Missing or invalid desktop parameters.');
      const runtime = nativeAgent();
      const outcome = open().decide(required('decisionID'), p.optionID == null ? undefined : string(p.optionID), string(p.note), p.expectedVersion as number);
      runtime.schedules.tick(); runtime.pump();
      return outcome;
    }
    case 'relativeDates': {
      if (!Array.isArray(p.dates) || p.dates.length > 5000 || !p.dates.every(value => typeof value === 'string')) throw new PolarisError('invalid_input', 'Missing or invalid desktop parameters.');
      return Object.fromEntries([...new Set(p.dates)].map(date => [date, relativeDate(date, string(p.language))]));
    }
    default: throw new PolarisError('invalid_input', 'Unknown desktop method.');
  }
}
type Parent = { on(event: 'message', callback: (event: { data: unknown }) => void): void; postMessage(value: unknown): void };
const parent = (process as NodeJS.Process & { parentPort?: Parent }).parentPort;
async function respond(input: unknown) {
  let id: unknown;
  let result: unknown;
  try {
    if (Buffer.byteLength(JSON.stringify(input)) > 1_048_576) throw new PolarisError('invalid_input', 'Request exceeds 1 MiB.');
    const request = object(input); id = request.id;
    if (!Number.isSafeInteger(id) || typeof request.method !== 'string') throw new PolarisError('invalid_input', 'Invalid request.');
    result = { id, result: await execute(request.method, request.params == null ? {} : object(request.params)) };
  } catch (error) {
    const failure = error instanceof PolarisError ? error : new PolarisError('storage', (error as Error).message);
    result = { ...(id === undefined ? {} : { id }), error: { code: failure.code, message: failure.message, ...(failure.messageKey ? { messageKey: failure.messageKey, params: failure.params } : {}) } };
  }
  send(result);
}
if (parent) parent.on('message', event => { void respond(event.data); });
else {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => { try { void respond(JSON.parse(line)); } catch { void respond(null); } });
  lines.on('close', () => { void Promise.all([coordinator?.stop(), onboarding?.stop()]).finally(() => store?.close()); });
}
