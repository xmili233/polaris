import type { ProviderID } from '../agent-store.js';
import type { NativeRPC } from './rpc.js';
import type { MessageKey } from '@polaris/i18n';
export const backgroundAgentLimit = 5;
export type AgentReadiness = 'checking' | 'ready' | 'signed_out' | 'missing' | 'outdated' | 'failed';
export interface ModelOption { id: string; kind: 'reasoning' | 'speed'; name: string; description?: string; defaultValue?: string | boolean; currentValue?: string | boolean; choices: { value: string | boolean; name: string; fast?: boolean }[] }
export type ModelSettings = Record<string, string | boolean>;
export interface NativeModel { id: string; name: string; options?: ModelOption[]; isDefault?: boolean; legacy?: boolean }
export interface OnboardingAgent { provider: ProviderID; name: string; state: AgentReadiness; command?: string; models?: NativeModel[] }
// preferred: the provider chosen before, which a restored launch waits for (R-D85).
export interface OnboardingSnapshot { agents: OnboardingAgent[]; preferred?: ProviderID }
export const onboardingProviders: { provider: ProviderID; name: string }[] = [
  { provider: 'claude-code', name: 'Claude Code' }, { provider: 'chatgpt-codex', name: 'Codex' }, { provider: 'gemini-cli', name: 'Gemini CLI' }, { provider: 'opencode', name: 'OpenCode' },
];
export interface NativeCapabilities {
  textStream: boolean; toolEvents: 'none' | 'status' | 'details'; messagePhases: 'explicit' | 'completion-only' | 'unknown';
  resume: boolean; cancel: 'remote' | 'local-process' | 'none'; cancelScope: 'turn' | 'unknown';
  permissionRequests: boolean; nativeCommands: { name: string; description: string }[]; contextUsage: boolean; compactionEvents: boolean;
}
export interface NativeConnection {
  provider: ProviderID; label: string; installed: boolean; executable: string; version: string; compatible: boolean;
  protocol: 'acp' | 'app-server'; protocolReady: boolean; authenticated: boolean | null; connected: boolean; enabled: boolean;
  account: string; error: string; instructions: string; model: string; modelSettings?: ModelSettings; modelPreferences?: Record<string, ModelSettings>; modelControl?: { method: 'session/set_model' | 'session/set_config_option'; configID?: string }; models: NativeModel[];
  capabilities: NativeCapabilities; verified: { turn: boolean; tools: boolean; resume: boolean; cancel: boolean };
}
export interface NativePermission { id: string; jobID: string; provider: ProviderID; title: string; titleKey?: MessageKey; detail: string; options: { id: string; label: string; labelKey?: MessageKey; kind: string }[] }
export interface NativeEvent { id?: string; type: 'text' | 'tool' | 'usage' | 'compaction' | 'commands' | 'models' | 'metadata'; nativeID?: string; localID?: string; text?: string; replace?: boolean; complete?: boolean; phase?: string; timestamp?: string; data?: any }
export interface NativeSession {
  id: string; capabilities: NativeCapabilities; prompt(text: string): Promise<{ status: 'completed' | 'cancelled'; nativeRunID?: string }>;
  canSteer?(): boolean;
  steer?(text: string, requestID: string): Promise<boolean>;
  release?(): Promise<NativeRPC>;
  cancel(): Promise<void>; close(): Promise<void>;
}
export interface DriverOptions {
  transport?: NativeRPC;
  signal?: AbortSignal; connection: NativeConnection; cwd: string; sessionID?: string; mcp: { command: string; args: string[]; env: Record<string, string> };
  onEvent(event: NativeEvent): void; onSession(id: string): void; onRun(id: string): void;
  permission(request: Omit<NativePermission, 'id' | 'jobID' | 'provider'>): Promise<string>;
}
export const emptyCapabilities = (): NativeCapabilities => ({ textStream: false, toolEvents: 'none', messagePhases: 'unknown', resume: false, cancel: 'none', cancelScope: 'unknown', permissionRequests: false, nativeCommands: [], contextUsage: false, compactionEvents: false });
