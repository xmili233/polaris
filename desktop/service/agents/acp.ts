import { NativeRPC, nativeEnvironment } from './rpc.js';
import type { DriverOptions, NativeCapabilities, NativeConnection, NativeSession } from './types.js';
import { PolarisError } from '../model.js';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { acpModelOptions, validateModelSettings } from './models.js';
import { applyModelCatalog } from './model-catalog.js';
import type { MessageKey } from '@polaris/i18n';

export function acpProcess(executable: string, provider: string, cwd?: string, fullAccess = false) {
  if (provider === 'opencode') return new NativeRPC(executable, ['acp'], { cwd, env: nativeEnvironment({
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    ...(fullAccess ? { OPENCODE_PERMISSION: JSON.stringify({ '*': 'allow', question: 'deny' }) } : {}),
  }) });
  const claude = provider === 'claude-code';
  const fixture = process.env.POLARIS_TEST === '1' && JSON.parse(process.env.POLARIS_TEST_NATIVE_AGENTS ?? '{}')[provider] === executable;
  return new NativeRPC(process.env.POLARIS_NODE_EXECUTABLE ?? process.execPath,
    claude && !fixture ? [[new URL('../claude-acp.mjs', import.meta.url), new URL('./claude-acp.mjs', import.meta.url)].map(url => fileURLToPath(url)).find(existsSync) ?? ''] : [realpathSync(executable), '--acp', ...(!claude && fullAccess ? ['--approval-mode=yolo'] : [])],
    { cwd, authenticationPrompt: claude ? undefined : /(?:^|\n)(?:Please visit the following URL to authorize the application:|Enter the authorization code:)/,
      env: nativeEnvironment(claude ? { ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_EXECUTABLE: executable, NO_BROWSER: 'true' }
      // Gemini 0.66's launcher accepts this per-process override; it leaves global settings intact.
      : { ELECTRON_RUN_AS_NODE: '1', GEMINI_CLI_AUTH_OVERRIDE: 'oauth-personal', GEMINI_CLI_NO_RELAUNCH: 'true', NO_BROWSER: 'true' }) });
}
export async function initializeACP(rpc: NativeRPC) {
  const value = await rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'polaris', title: 'Polaris', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
  if (value.protocolVersion !== 1) throw new PolarisError('native_version', 'This ACP version is not supported.');
  return value;
}
export function acpSessionCatalog(session: any, previous: NativeConnection['models'] = []): Pick<NativeConnection, 'models' | 'modelControl'> {
  const selector = session.configOptions?.find((option: any) => option.category === 'model' && option.type === 'select');
  const current = selector?.currentValue ?? session.models?.currentModelId;
  const describe = (id: string, name: string) => ({ ...previous.find(model => model.id === id), id, name, isDefault: id === current,
    ...(!session.configOptions ? { options: [] } : id === current ? { options: acpModelOptions(session.configOptions) } : {}) });
  if (selector) {
    const options = (selector.options ?? []).flatMap((option: any) => option.options ?? [option]);
    return { models: options.filter((option: any) => typeof option.value === 'string').map((option: any) => describe(option.value, option.name ?? option.value)),
      modelControl: { method: 'session/set_config_option', configID: selector.id } };
  }
  if (Array.isArray(session.models?.availableModels)) return {
    models: session.models.availableModels.filter((model: any) => typeof model.modelId === 'string').map((model: any) => describe(model.modelId, model.name ?? model.modelId)),
    modelControl: { method: 'session/set_model' },
  };
  return { models: [] };
}
export async function connectACP(options: DriverOptions): Promise<NativeSession> {
  const rpc = acpProcess(options.connection.executable, options.connection.provider, options.cwd, true);
  const releaseAbort = rpc.closeOnAbort(options.signal);
  let accepting = false, serial = 0, prompting = false, observedRun = false;
  let hasOutput = false, cancelled = false;
  let lastUpdateAt = 0;
  const capabilities: NativeCapabilities = { ...options.connection.capabilities };
  let lastKind = '';
  let liveCatalog = { models: options.connection.models, modelControl: options.connection.modelControl };
  const updateCatalog = (response: any) => {
    const catalog = acpSessionCatalog(response, liveCatalog.models);
    if (catalog.models.length) { liveCatalog = { models: applyModelCatalog(options.connection, catalog.models), modelControl: catalog.modelControl }; options.onEvent({ type: 'models', data: liveCatalog }); }
  };
  rpc.onNotification = (method, params) => {
    if (method !== 'session/update') return;
    const update = params.update;
    if (!update || typeof update.sessionUpdate !== 'string') return;
    if (!accepting && !['available_commands_update', 'config_option_update'].includes(update.sessionUpdate)) return;
    lastUpdateAt = Date.now();
    if (prompting && !observedRun) { observedRun = true; options.onRun(''); }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update'
      || update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text' && update.content.text?.trim()
      || update.sessionUpdate === 'agent_message' && update.content?.some((part: any) => part.type === 'text' && part.text?.trim())) hasOutput = true;
    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        // Consecutive chunks form one ACP message. A tool boundary starts the next.
        if (lastKind !== 'text') serial++;
        if (update.content?.type === 'text') options.onEvent({ type: 'text', ...(typeof update.messageId === 'string' ? { nativeID: update.messageId } : { localID: `acp-text-${serial}` }), text: update.content.text });
        lastKind = 'text'; break;
      }
      case 'agent_message':
        if (typeof update.messageId === 'string' && Array.isArray(update.content)) options.onEvent({ type: 'text', nativeID: update.messageId, text: update.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join(''), replace: true });
        lastKind = 'text'; break;
      case 'config_option_update':
        updateCatalog(update); break;
      case 'tool_call': case 'tool_call_update':
        lastKind = 'tool'; options.onEvent({ type: 'tool', nativeID: update.toolCallId, data: update }); break;
      case 'available_commands_update':
        capabilities.nativeCommands = (update.availableCommands ?? []).map((c: any) => ({ ...c, name: c.name, description: c.description ?? '' }));
        options.onEvent({ type: 'commands', data: capabilities.nativeCommands }); break;
      case 'usage_update':
        capabilities.contextUsage = true; options.onEvent({ type: 'usage', data: update }); break;
      default: options.onEvent({ type: 'metadata', data: { sessionUpdate: update.sessionUpdate } });
    }
  };
  rpc.onRequest = async (method, params) => {
    if (method !== 'session/request_permission') throw new Error('Client filesystem and terminal are not enabled.');
    const labels: Record<string, MessageKey> = { allow_once: 'permissions.allowOnce', allow_always: 'permissions.allowAlways', reject_once: 'permissions.decline', reject_always: 'permissions.declineAlways' };
    const optionsList = (params.options ?? []).map((option: any) => ({ id: option.optionId, label: option.name, labelKey: labels[option.kind], kind: option.kind }));
    const selected = await options.permission({ title: params.toolCall?.title ?? 'Agent permission', ...(!params.toolCall?.title ? { titleKey: 'permissions.request' } : {}), detail: JSON.stringify(params.toolCall?.rawInput ?? {}, null, 2).slice(0, 12000), options: optionsList });
    return selected ? { outcome: { outcome: 'selected', optionId: selected } } : { outcome: { outcome: 'cancelled' } };
  };
  try {
    const hello = await initializeACP(rpc);
    capabilities.resume = hello.agentCapabilities?.loadSession === true;
    if (options.sessionID && !capabilities.resume) throw new PolarisError('native_resume', 'This Agent cannot resume the saved session. Start a new session.');
    const mcpServers = [{ name: 'polaris', command: options.mcp.command, args: options.mcp.args, env: Object.entries(options.mcp.env).map(([name, value]) => ({ name, value })) }];
    const session = await rpc.request(options.sessionID ? 'session/load' : 'session/new', { ...(options.sessionID ? { sessionId: options.sessionID } : {}), cwd: options.cwd, mcpServers });
    const sessionID = options.sessionID ?? session.sessionId;
    if (!sessionID) throw new PolarisError('native_protocol', 'The Agent did not return a session ID.');
    options.onSession(sessionID);
    // Apply the provider's own mode on both new and resumed sessions. Mandatory prompts still belong to the provider.
    const mode = options.connection.provider === 'claude-code' ? 'bypassPermissions' : options.connection.provider === 'opencode' ? 'build' : 'yolo';
    if (session.modes?.availableModes?.some((item: any) => item.id === mode)) {
      await rpc.request('session/set_mode', { sessionId: sessionID, modeId: mode });
      options.onEvent({ type: 'metadata', data: options.connection.provider === 'opencode' ? { agentMode: mode } : { permissionMode: mode } });
    }
    // Initial command/model updates can precede session/new's response.
    updateCatalog(session);
    const catalog = liveCatalog;
    if (options.connection.model) {
      if (!catalog.modelControl || !catalog.models.some(model => model.id === options.connection.model)) throw new PolarisError('native_models', 'The selected model is not offered by this native session.');
      const control = catalog.modelControl;
      const response = await rpc.request(control.method, { sessionId: sessionID, ...(control.configID ? { configId: control.configID, value: options.connection.model } : { modelId: options.connection.model }) });
      if (response.configOptions) updateCatalog(response);
    }
    const selectedModel = () => liveCatalog.models.find(model => options.connection.model ? model.id === options.connection.model : model.isDefault);
    const settings = validateModelSettings(selectedModel(), options.connection.modelSettings);
    for (const [configId, value] of Object.entries(settings)) {
      const response = await rpc.request('session/set_config_option', { sessionId: sessionID, configId, value });
      if (response.configOptions) updateCatalog(response);
      const actual = selectedModel()?.options?.find(option => option.id === configId);
      if (!actual || actual.currentValue !== value) throw new PolarisError('native_models', 'The native Agent did not apply this model option.', 'agent.modelOptionsChanged');
    }
    accepting = true;
    return {
      id: sessionID, capabilities,
      async prompt(text) {
        prompting = true; hasOutput = false; cancelled = false;
        const result = await rpc.request('session/prompt', { sessionId: sessionID, prompt: [{ type: 'text', text }] }, 0);
        // OpenCode 1.x can return end_turn before its queued stream notifications reach ACP.
        if (options.connection.provider === 'opencode') {
          const deadline = Date.now() + 3000;
          lastUpdateAt = Date.now();
          while (!cancelled && Date.now() - lastUpdateAt < 250) {
            if (Date.now() >= deadline) throw new PolarisError('native_incomplete', 'OpenCode is still sending updates after the turn ended.');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        }
        if (!observedRun) { observedRun = true; options.onRun(''); }
        if (cancelled || result.stopReason === 'cancelled') return { status: 'cancelled' };
        if (!['end_turn', 'max_tokens', 'max_turn_requests', 'refusal'].includes(result.stopReason)) throw new PolarisError('native_protocol', 'Agent returned an unknown completion state.');
        if (result.stopReason !== 'end_turn') throw new PolarisError('native_incomplete', `Agent stopped: ${result.stopReason}.`);
        // shortcut: OpenCode 1.x omits provider errors from ACP; reject empty turns until it forwards structured failures.
        if (options.connection.provider === 'opencode' && !hasOutput && result.usage?.totalTokens === 0)
          throw new PolarisError('native_incomplete', 'OpenCode returned no assistant output. Check provider authentication, model access and quota in OpenCode, then retry.');
        return { status: 'completed' };
      },
      async cancel() { cancelled = true; rpc.notify('session/cancel', { sessionId: sessionID }); },
      async close() { releaseAbort(); accepting = false; await rpc.close(); },
    };
  } catch (error) { releaseAbort(); await rpc.close(); throw error; }
}
