import type { DesktopArgs, DesktopMethod, DesktopParams, DesktopResult, NativeMethods, NativeRequest } from '../service/desktop-contract';
import type { Language, LanguagePreference } from '@polaris/i18n';
import type { Decision } from '../service/model';
import type { AgentAttachment } from '../service/agent-attachments';
export type { AgentAttachment } from '../service/agent-attachments';
export type { Board, Decision, Goal, Strategy, Option, Outcome } from '../service/model';
export type { LoopState } from '../service/strategy-state';
export type { AgentSnapshot, AgentJob, AgentMessage } from '../service/agent-store';
export type { Snapshot } from '../service/desktop-contract';
export interface Launch { goal?: string; select?: string; choose?: string; decide?: string; dumpLayout?: string }
export type Appearance = 'system' | 'light' | 'dark';
export interface Config { language: Language; languagePreference: LanguagePreference; appearance: Appearance; dark: boolean; reducedMotion: boolean; showSettings?: boolean; launch: Launch }
export interface DesktopAPI {
  onAgent(callback: () => void): () => void;
  config(): Promise<Config>;
  setLanguage(language: LanguagePreference): Promise<Config>;
  setAppearance(appearance: Appearance): Promise<Config>;
  onSettings(callback: () => void): () => void;
  onConfig(callback: (config: Config) => void): () => void;
  call<M extends DesktopMethod>(method: M, params?: DesktopParams<M>): Promise<{ result?: unknown; error?: { code: string; message: string } }>;
  copyText(text: string): Promise<void>;
  pickAttachments(): Promise<{ result?: AgentAttachment[]; error?: { code: string; message: string } }>;
  openLink(url: string): Promise<void>;
  captureLayout(frames: { [id: string]: number[] }): Promise<void>;
}
declare global { interface Window { polaris: DesktopAPI } }
export const pending = (decision: Decision) => decision.status === 'active' && !decision.outcome;
export const outcomeLabel = (decision: Decision) => decision.options.find(o => o.id === decision.outcome?.optionID)?.label ?? decision.outcome?.note ?? '';

export function call<A extends keyof NativeMethods>(method: 'agentNative', params: NativeRequest<A>): Promise<NativeMethods[A]['result']>;
export function call<M extends Exclude<DesktopMethod, 'agentNative'>>(method: M, ...args: DesktopArgs<M>): Promise<DesktopResult<M>>;
export async function call(method: DesktopMethod, params: object = {}): Promise<unknown> {
  const response = await window.polaris.call(method, params as DesktopParams<DesktopMethod>);
  if (response.error) throw Object.assign(new Error(response.error.message), response.error);
  return response.result;
}
