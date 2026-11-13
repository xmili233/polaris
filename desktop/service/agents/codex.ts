import { NativeRPC, nativeEnvironment } from './rpc.js';
import type { DriverOptions, NativeCapabilities, NativeSession } from './types.js';
import { PolarisError } from '../model.js';

export function codexProcess(executable: string, cwd?: string) {
  return new NativeRPC(executable, ['app-server'], { cwd, env: nativeEnvironment() });
}
export async function initializeCodex(rpc: NativeRPC) {
  await rpc.request('initialize', { clientInfo: { name: 'polaris', title: 'Polaris', version: '0.1.0' }, capabilities: { experimentalApi: false } });
  rpc.notify('initialized');
}
export async function connectCodex(options: DriverOptions): Promise<NativeSession> {
  const rpc = options.transport ?? codexProcess(options.connection.executable, options.cwd);
  const releaseAbort = rpc.closeOnAbort(options.signal);
  let threadID = '', turnID = '', resolveTurn: ((value: { status: 'completed' | 'cancelled'; nativeRunID: string }) => void) | undefined, rejectTurn: ((error: Error) => void) | undefined;
  const capabilities: NativeCapabilities = { ...options.connection.capabilities };
  let steering = false;
  rpc.onExit = () => { rejectTurn?.(new PolarisError('native_disconnected', 'Native Agent disconnected; verify the last run before retrying.')); };
  rpc.onNotification = (method, params) => {
    if (params.threadId && params.threadId !== threadID) return;
    if (method === 'turn/started') { turnID = params.turn.id; options.onRun(turnID); }
    if (method === 'item/agentMessage/delta') options.onEvent({ type: 'text', nativeID: params.itemId, text: params.delta });
    if (method === 'item/started' || method === 'item/completed') {
      const item = params.item; if (!item?.id) return;
      const complete = method === 'item/completed';
      const ms = complete ? params.completedAtMs : params.startedAtMs;
      const timestamp = typeof ms === 'number' ? new Date(ms).toISOString() : undefined;
      if (item.type === 'agentMessage') options.onEvent({ type: 'text', nativeID: item.id, text: item.text ?? '', replace: true, phase: item.phase, complete, timestamp });
      else if (!['userMessage', 'reasoning'].includes(item.type)) options.onEvent({ type: item.type === 'contextCompaction' ? 'compaction' : 'tool', nativeID: item.id, complete, timestamp, data: item });
    }
    if (method === 'item/commandExecution/outputDelta') options.onEvent({ type: 'tool', nativeID: params.itemId, data: { outputDelta: params.delta } });
    if (method === 'thread/tokenUsage/updated') { capabilities.contextUsage = true; options.onEvent({ type: 'usage', data: params.tokenUsage }); }
    if (method === 'thread/compacted') { options.onEvent({ type: 'compaction', data: params }); }
    if (method === 'turn/completed' && resolveTurn) {
      steering = false;
      const turn = params.turn;
      if (turn.status === 'completed' || turn.status === 'interrupted') resolveTurn({ status: turn.status === 'completed' ? 'completed' : 'cancelled', nativeRunID: turn.id });
      else rejectTurn?.(new PolarisError('native_failed', turn.error?.message ?? 'The native Agent did not finish.'));
      resolveTurn = undefined; rejectTurn = undefined;
    }
  };
  rpc.onRequest = async (method, params) => {
    if (params.threadId !== threadID) throw new Error('Foreign native session.');
    if (method === 'mcpServer/elicitation/request') {
      // Native MCP tool approval uses an empty form. Never invent values for other forms.
      if (params.mode !== 'form' || Object.keys(params.requestedSchema?.properties ?? {}).length) throw new Error('This MCP form is not supported.');
      const choice = await options.permission({ title: params.message, detail: JSON.stringify(params._meta?.tool_params ?? {}, null, 2),
        options: [{ id: 'accept', label: 'Allow once', labelKey: 'permissions.allowOnce', kind: 'allow_once' }, { id: 'decline', label: 'Decline', labelKey: 'permissions.decline', kind: 'reject_once' }, { id: 'cancel', label: 'Cancel', labelKey: 'common.cancel', kind: 'cancel' }] });
      return { action: choice || 'cancel', ...(choice === 'accept' ? { content: {} } : {}) };
    }
    if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) throw new Error('Unsupported native request.');
    const choices = params.availableDecisions ?? ['accept', 'decline'];
    const strings = choices.filter((value: unknown): value is string => typeof value === 'string' && ['accept', 'acceptForSession', 'decline', 'cancel'].includes(value));
    const answer = await options.permission({ title: method.includes('fileChange') ? 'Approve file changes' : 'Approve command', titleKey: method.includes('fileChange') ? 'permissions.approveChanges' : 'permissions.approveCommand', detail: String(params.command ?? params.reason ?? 'Native Agent requests permission.'), options: strings.map((id: string) => ({ id, label: id === 'accept' ? 'Allow once' : id === 'acceptForSession' ? 'Allow for session' : id === 'cancel' ? 'Cancel turn' : 'Decline', labelKey: id === 'accept' ? 'permissions.allowOnce' : id === 'acceptForSession' ? 'permissions.allowSession' : id === 'cancel' ? 'permissions.cancelTurn' : 'permissions.decline', kind: id })) });
    return { decision: strings.includes(answer) ? answer : 'decline' };
  };
  try {
    if (!options.transport) await initializeCodex(rpc);
    const account = await rpc.request('account/read', { refreshToken: false });
    if (account.account?.type !== 'chatgpt') throw new PolarisError('native_auth', 'Sign in to the Codex CLI with ChatGPT. API billing is not enabled by Polaris.');
    const config = { mcp_servers: { polaris: { command: options.mcp.command, args: options.mcp.args, env: options.mcp.env, startup_timeout_sec: 30, default_tools_approval_mode: 'approve' } }, model_provider: 'openai' };
    const result = await rpc.request(options.sessionID ? 'thread/resume' : 'thread/start', {
      ...(options.sessionID ? { threadId: options.sessionID, excludeTurns: true } : {}), cwd: options.cwd, approvalPolicy: 'never', sandbox: 'danger-full-access', config,
      ...(options.connection.model ? { model: options.connection.model } : {}),
    });
    threadID = result.thread.id; options.onSession(threadID);
    return {
      id: threadID, capabilities,
      async prompt(text) {
        if (text.startsWith('/compact ') || text.startsWith('/compact\n')) throw new PolarisError('native_command', 'The native compaction operation does not accept arguments.');
        const completion = new Promise<{ status: 'completed' | 'cancelled'; nativeRunID: string }>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
        steering = text !== '/compact';
        try {
          if (text === '/compact') await rpc.request('thread/compact/start', { threadId: threadID });
          else {
            const result = await rpc.request('turn/start', { threadId: threadID, input: [{ type: 'text', text }], clientUserMessageId: options.mcp.env.POLARIS_REQUEST_ID,
              ...(options.connection.model ? { model: options.connection.model } : {}),
              ...(options.connection.modelSettings?.reasoningEffort !== undefined ? { effort: options.connection.modelSettings.reasoningEffort } : {}),
              ...(options.connection.modelSettings?.serviceTier !== undefined ? { serviceTierForTurn: options.connection.modelSettings.serviceTier } : {}) });
            turnID = result.turn.id; options.onRun(turnID);
          }
        } catch (error) { steering = false; resolveTurn = undefined; rejectTurn = undefined; throw error; }
        return completion;
      },
      canSteer: () => steering && !!resolveTurn && !!turnID && rpc.alive,
      async steer(text, requestID) {
        if (!steering || !resolveTurn || !turnID) return false;
        const expectedTurnId = turnID;
        try {
          const result = await rpc.request('turn/steer', { threadId: threadID, expectedTurnId, input: [{ type: 'text', text }], clientUserMessageId: requestID });
          if (result.turnId !== expectedTurnId) throw new PolarisError('native_protocol', 'The native Agent did not confirm the target turn.');
          return true;
        } catch (error) {
          if ([-32601, -32602].includes((error as { rpcCode?: number }).rpcCode ?? 0)) return false;
          throw error;
        }
      },
      async release() {
        releaseAbort(); rpc.onNotification = () => {}; rpc.onExit = () => {}; rpc.onRequest = async () => { throw new Error('No active turn.'); };
        // A subscribed thread ignores resume config; detach before installing the next turn's MCP scope.
        await rpc.request('thread/unsubscribe', { threadId: threadID });
        return rpc;
      },
      async cancel() { if (turnID) await rpc.request('turn/interrupt', { threadId: threadID, turnId: turnID }); },
      async close() { releaseAbort(); rejectTurn?.(new PolarisError('native_disconnected', 'The owned native process was stopped.')); resolveTurn = undefined; rejectTurn = undefined; await rpc.close(); },
    };
  } catch (error) { releaseAbort(); await rpc.close(); throw error; }
}
