import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderID } from '../agent-store.js';
import { emptyCapabilities, type NativeConnection } from './types.js';
import { acpProcess, initializeACP, acpSessionCatalog } from './acp.js';
import { codexProcess, initializeCodex } from './codex.js';
import { nativeEnvironment } from './rpc.js';
import { codexModel } from './models.js';
import { applyModelCatalog, refreshModelCatalog } from './model-catalog.js';
const exec = promisify(execFile);
export const providerIDs: ProviderID[] = ['claude-code', 'chatgpt-codex', 'gemini-cli', 'opencode'];
export const providerSpecs = {
  opencode: { name: 'opencode', label: 'OpenCode', minimum: [1, 15, 5], instructions: 'Install OpenCode 1.x (1.15.5 or later), then run opencode auth login to configure a model provider. Polaris uses OpenCode-managed credentials; usage and billing depend on the selected provider. A successful ACP connection does not verify model credentials.' },
  'claude-code': { name: 'claude', label: 'Claude Code', minimum: [2, 1, 312], instructions: 'Install Claude Code, then run claude auth login. The ACP adapter uses the unmodified CLI. Subscription eligibility remains subject to Anthropic’s terms; Polaris does not provide or resell usage.' },
  'chatgpt-codex': { name: 'codex', label: 'Codex', minimum: [0, 162, 1], instructions: 'Install Codex CLI and run codex login with ChatGPT. This creates an independent native session; your open ChatGPT Desktop chat is not attached.' },
  'gemini-cli': { name: 'gemini', label: 'Gemini CLI', minimum: [0, 66, 0], instructions: 'Run npm install -g @google/gemini-cli@0.66.0, then run gemini and choose Sign in with Google. Use the account associated with your eligible subscription; API keys are not used by Polaris.' },
};
// Commands are provider data, never extracted from instructions or executed by the renderer.
export const providerCommands = {
  opencode: { install: 'npm install -g opencode-ai@1.15.5', update: 'npm install -g opencode-ai@1.15.5', login: 'opencode auth login' },
  'claude-code': { install: 'npm install -g @anthropic-ai/claude-code', update: 'claude update', login: 'claude auth login' },
  'chatgpt-codex': { install: 'npm install -g @openai/codex', update: 'npm install -g @openai/codex@latest', login: 'codex login' },
  'gemini-cli': { install: 'npm install -g @google/gemini-cli@0.66.0', update: 'npm install -g @google/gemini-cli@0.66.0', login: 'gemini' },
};
export function compatibleVersion(provider: ProviderID, version: string) {
  const found = version.match(/(\d+)\.(\d+)\.(\d+)/); if (!found) return false;
  const actual = found.slice(1).map(Number), minimum = providerSpecs[provider].minimum;
  // The Google-only process override is verified against the 0.66 release line.
  if (provider === 'gemini-cli' && (actual[0] !== 0 || actual[1] !== 66)) return false;
  if (provider === 'opencode' && actual[0] !== 1) return false;
  for (let i = 0; i < 3; i++) if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  return true;
}
async function locate(name: string) {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), path.join(homedir(), '.local/bin'), path.join(homedir(), '.npm-global/bin'), ...(name === 'opencode' ? [path.join(homedir(), '.opencode/bin')] : []), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const directory of dirs.filter(Boolean)) {
    const candidate = path.resolve(directory, name); try { await access(candidate, constants.X_OK); return candidate; } catch { /* next official installation */ }
  }
  return '';
}
export async function discover(provider: ProviderID, saved?: Partial<NativeConnection>, signal?: AbortSignal): Promise<NativeConnection> {
  const spec = providerSpecs[provider];
  const fixtures = process.env.POLARIS_TEST === '1' ? JSON.parse(process.env.POLARIS_TEST_NATIVE_AGENTS ?? '{}') : undefined;
  const testExecutable = fixtures?.[provider] ?? (provider === 'chatgpt-codex' ? process.env.POLARIS_TEST_NATIVE_CODEX : undefined);
  let executable = fixtures ? typeof testExecutable === 'string' && path.isAbsolute(testExecutable) ? testExecutable : '' : await locate(spec.name);
  if (executable) try { await access(executable, constants.X_OK); } catch { executable = ''; }
  let version = '', error = '';
  if (executable) try {
    version = (await exec(provider === 'gemini-cli' ? process.env.POLARIS_NODE_EXECUTABLE ?? process.execPath : executable, provider === 'gemini-cli' ? [realpathSync(executable), '--version'] : ['--version'], { env: nativeEnvironment({ ELECTRON_RUN_AS_NODE: '1' }), timeout: 10_000, signal })).stdout.trim().slice(0, 100);
    if (!/\d+\.\d+\.\d+/.test(version)) error = 'native_version_check';
  } catch { error = signal?.aborted ? 'native_timeout' : 'native_version_check'; }
  return { provider, label: spec.label, installed: !!executable, executable, version, compatible: !error && compatibleVersion(provider, version), protocol: provider === 'chatgpt-codex' ? 'app-server' : 'acp', protocolReady: false, authenticated: null, connected: false, enabled: saved?.enabled === true, account: '', error, instructions: spec.instructions, model: saved?.model ?? '', modelSettings: saved?.modelSettings ?? {}, modelPreferences: saved?.modelPreferences ?? {}, models: [], capabilities: emptyCapabilities(), verified: saved?.version === version && saved?.verified ? saved.verified : { turn: false, tools: false, resume: false, cancel: false } };
}
export async function inspectConnection(connection: NativeConnection, signal?: AbortSignal, model?: string): Promise<NativeConnection> {
  refreshModelCatalog();
  if (connection.error) return connection;
  if (!connection.installed || !connection.compatible) return { ...connection, error: connection.installed ? 'native_version' : 'native_missing' };
  const probeDirectory = await mkdtemp(path.join(tmpdir(), 'polaris-agent-check-'));
  const rpc = connection.provider === 'chatgpt-codex' ? codexProcess(connection.executable, probeDirectory) : acpProcess(connection.executable, connection.provider, probeDirectory);
  const releaseAbort = rpc.closeOnAbort(signal);
  let commandsSeen = false;
  let receiveCommands: () => void = () => {};
  const commandsReady = new Promise<void>(resolve => { receiveCommands = resolve; });
  rpc.onNotification = (method, params) => {
    if (method === 'session/update' && params.update?.sessionUpdate === 'available_commands_update') { connection.capabilities.nativeCommands = params.update.availableCommands ?? []; commandsSeen = true; receiveCommands(); }
  };
  try {
    if (connection.provider === 'chatgpt-codex') {
      await initializeCodex(rpc); connection.protocolReady = true;
      const auth = await rpc.request('account/read', { refreshToken: false });
      connection.authenticated = auth.account?.type === 'chatgpt';
      connection.account = connection.authenticated ? auth.account.email ?? 'ChatGPT' : '';
      const models = [], cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const response = await rpc.request('model/list', cursor ? { cursor } : {});
        models.push(...(response.data ?? []).map(codexModel));
        cursor = response.nextCursor || undefined;
        if (cursor && cursors.has(cursor)) throw new Error('Repeated model cursor');
        if (cursor) cursors.add(cursor);
      } while (cursor && cursors.size < 100);
      connection.models = models;
      try {
        const config = await rpc.request('config/read', { includeLayers: false }, 1500);
        for (const item of connection.models) for (const option of item.options ?? []) {
          let value = option.id === 'serviceTier' ? config.config?.service_tier : config.config?.model_reasoning_effort;
          if (option.id === 'serviceTier' && value === 'fast' && option.choices.some(choice => choice.value === 'priority')) value = 'priority';
          if (option.choices.some(choice => choice.value === value)) option.currentValue = value;
        }
      } catch { /* Optional user defaults do not block model discovery. */ }
      connection.capabilities = { textStream: true, toolEvents: 'details', messagePhases: 'explicit', resume: true, cancel: 'remote', cancelScope: 'turn', permissionRequests: true, nativeCommands: [{ name: 'compact', description: 'Compact this native session' }], contextUsage: false, compactionEvents: true };
    } else {
      const hello = await initializeACP(rpc); connection.protocolReady = true;
      connection.capabilities = { ...emptyCapabilities(), textStream: true, toolEvents: 'details', messagePhases: 'completion-only', resume: hello.agentCapabilities?.loadSession === true, cancel: 'remote', cancelScope: 'turn', permissionRequests: true };
      if (connection.provider === 'claude-code') {
        {
          const status = await exec(connection.executable, ['auth', 'status'], { cwd: probeDirectory, env: nativeEnvironment(), timeout: 15_000, signal })
            .catch(error => { if (error.code === 1 && typeof error.stdout === 'string') return { stdout: error.stdout }; throw error; });
          const auth = JSON.parse(status.stdout);
          connection.authenticated = auth.loggedIn === true && ['oauth_token', 'claude.ai', 'oauth'].includes(auth.authMethod);
          connection.account = connection.authenticated ? auth.email ?? 'Claude Code' : '';
        }
      }
    }
    if (connection.provider === 'opencode' || connection.provider === 'gemini-cli' || (connection.provider === 'claude-code' && connection.authenticated)) {
      const session = await rpc.request('session/new', { cwd: probeDirectory, mcpServers: [] });
      if (connection.provider === 'gemini-cli') { connection.authenticated = true; connection.account = 'Google account'; }
      if (connection.provider === 'opencode') { connection.authenticated = null; connection.account = 'OpenCode'; }
      let catalog = acpSessionCatalog(session, connection.models);
      const wanted = model ?? connection.model;
      if (wanted && catalog.modelControl && catalog.models.some(item => item.id === wanted)) {
        const control = catalog.modelControl;
        const response = await rpc.request(control.method, { sessionId: session.sessionId, ...(control.configID ? { configId: control.configID, value: wanted } : { modelId: wanted }) });
        if (response.configOptions) catalog = acpSessionCatalog(response, catalog.models);
      }
      connection.models = catalog.models; connection.modelControl = catalog.modelControl;
      if (!commandsSeen) await Promise.race([commandsReady, new Promise(resolve => setTimeout(resolve, 1000))]);
    }
    connection.models = applyModelCatalog(connection, connection.models);
    // OpenCode can offer models before provider credentials are checked by a prompt.
    connection.connected = connection.protocolReady && (connection.provider === 'opencode' ? connection.models.length > 0 : connection.authenticated === true);
    connection.error = connection.connected ? '' : connection.provider === 'opencode' ? 'agent_models' : 'native_auth';
  } catch (error) { connection.error = signal?.aborted ? 'native_timeout' : (error as { code?: string }).code ?? 'native_protocol'; connection.connected = false; if (connection.error === 'native_auth') connection.authenticated = false; }
  finally { releaseAbort(); await rpc.close(); await rm(probeDirectory, { recursive: true, force: true }); }
  return connection;
}
