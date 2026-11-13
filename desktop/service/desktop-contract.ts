import type { Board, Outcome, Decision, Strategy } from './model.js';
import type { AgentSnapshot, AgentWorkSummary, ProviderID } from './agent-store.js';
import type { AgentCoordinator } from './agent-coordinator.js';
import type { AgentAttachment } from './agent-attachments.js';
import type { Executions } from './execution.js';
import type { KnowledgeDocument, KnowledgeRules, KnowledgeStore, KnowledgeSummary } from './knowledge.js';
import type { LoopState } from './strategy-state.js';
import type { ScheduleSnapshot } from './strategy-schedule.js';
import type { ModelSettings, NativeModel, OnboardingSnapshot } from './agents/types.js';

type Empty = Record<string, never>;
type Method<P, R> = { params: P; result: R };
type Native = ReturnType<AgentCoordinator['snapshot']>;
type Versioned = { id: string; expectedVersion: number; requestID: string };
export interface Snapshot { hasData: boolean; schedules: ScheduleSnapshot[]; loops: Record<string, LoopState>; board: Board; changeToken: string; database: string }
export interface AgentActivity { works: AgentWorkSummary[]; results: ReturnType<Executions['results']>; latestReplyID: string }
export interface NativeMethods {
  newSession: Method<{ provider: ProviderID }, Native>;
  connect: Method<{ provider: ProviderID }, Native>;
  disconnect: Method<{ provider: ProviderID }, Native>;
  select: Method<{ provider: ProviderID }, Native>;
  refresh: Method<{ provider: ProviderID }, Native>;
  modelOptions: Method<{ provider: ProviderID; model: string }, NativeModel>;
  chooseModel: Method<{ provider: ProviderID; model: string; taskID?: string; settings?: ModelSettings }, AgentSnapshot>;
  subModel: Method<{ provider: ProviderID } & ({ follow: true } | { follow?: false; model: string; settings?: ModelSettings }), Native>;
  permission: Method<{ provider: ProviderID; id: string; option: string }, Native>;
}
export type NativeRequest<A extends keyof NativeMethods = keyof NativeMethods> = { [K in A]: { action: K } & NativeMethods[K]['params'] }[A];
export interface DesktopMethods {
  snapshot: Method<{ changeToken?: string }, Snapshot | null>;
  symbols: Method<{ symbols: string[] }, Record<string, string>>;
  relativeDates: Method<{ dates: string[]; language: string }, Record<string, string>>;
  decide: Method<{ decisionID: string; expectedVersion: number; optionID?: string; note?: string }, Outcome>;
  strategyRecords: Method<{ strategyID: string }, { strategy: Strategy; decisions: Decision[] }>;
  advanceStrategy: Method<{ strategyID: string }, ReturnType<AgentCoordinator['advanceStrategy']>>;
  agentSnapshot: Method<Empty, AgentSnapshot>;
  agentActivity: Method<Empty, AgentActivity>;
  agentWorks: Method<Empty, AgentWorkSummary[]>;
  executionResults: Method<Empty, ReturnType<Executions['results']>>;
  agentWorkSnapshot: Method<{ workID: string; taskID?: string }, AgentSnapshot>;
  agentWorkStop: Method<{ workID: string; id: string }, AgentSnapshot>;
  agentSend: Method<{ text: string; requestID?: string; attachments?: AgentAttachment[] }, ReturnType<AgentCoordinator['send']>>;
  agentCancel: Method<{ id: string }, null>;
  agentRetry: Method<{ id: string }, null>;
  agentAttachmentDiscard: Method<{ ids: string[] }, null>;
  agentNative: Method<NativeRequest, Native | AgentSnapshot | NativeModel>;
  agentOnboarding: Method<Empty, OnboardingSnapshot>;
  agentOnboardingCheck: Method<{ provider?: ProviderID; stop?: boolean }, OnboardingSnapshot>;
  agentOnboardingContinue: Method<Empty, boolean>;
  knowledgeList: Method<{ query?: string; goalID?: string; status?: 'active' | 'archived'; offset?: number; limit?: number }, ReturnType<KnowledgeStore['list']>>;
  knowledgeRead: Method<{ id: string }, KnowledgeDocument>;
  knowledgeHistory: Method<{ id: string }, KnowledgeSummary[]>;
  knowledgeRevision: Method<{ id: string; version: number }, KnowledgeDocument>;
  knowledgeSave: Method<Partial<Pick<KnowledgeDocument, 'title' | 'body' | 'category' | 'tags' | 'aliases' | 'sources' | 'goalIDs'>> & Omit<Versioned, 'id'> & { id?: string }, KnowledgeDocument>;
  knowledgeArchive: Method<Versioned, KnowledgeDocument>;
  knowledgeRestore: Method<Versioned & { version: number }, KnowledgeDocument>;
  knowledgeRules: Method<Empty, KnowledgeRules>;
  knowledgeRulesSave: Method<{ body: string; expectedVersion: number; requestID: string }, KnowledgeRules>;
  knowledgeImport: Method<{ requestID: string; goalID?: string }, KnowledgeDocument | null>;
  knowledgeExport: Method<{ id: string }, { exported: true } | null>;
}
export type DesktopMethod = keyof DesktopMethods;
export type DesktopParams<M extends DesktopMethod> = DesktopMethods[M]['params'];
export type DesktopResult<M extends DesktopMethod> = DesktopMethods[M]['result'];
export type DesktopArgs<M extends DesktopMethod> = Empty extends DesktopParams<M> ? [params?: DesktopParams<M>] : [params: DesktopParams<M>];
export type Reply<M extends DesktopMethod> = DesktopResult<M> | Promise<DesktopResult<M>>;

export const desktopMethods = [
  'snapshot', 'symbols', 'relativeDates', 'decide', 'strategyRecords', 'advanceStrategy',
  'agentSnapshot', 'agentActivity', 'agentWorks', 'executionResults', 'agentWorkSnapshot', 'agentWorkStop',
  'agentSend', 'agentCancel', 'agentRetry', 'agentAttachmentDiscard', 'agentNative', 'agentOnboarding', 'agentOnboardingCheck',
  'agentOnboardingContinue', 'knowledgeList', 'knowledgeRead', 'knowledgeHistory', 'knowledgeRevision', 'knowledgeSave',
  'knowledgeArchive', 'knowledgeRestore', 'knowledgeRules', 'knowledgeRulesSave', 'knowledgeImport', 'knowledgeExport',
] as const satisfies readonly DesktopMethod[];
