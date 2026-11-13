import { call } from '../src/types';
import { desktopMethods, type DesktopMethod, type Snapshot } from '../service/desktop-contract';
import type { AgentSnapshot } from '../service/agent-store';

const board: Promise<Snapshot | null> = call('snapshot');
const conversation: Promise<AgentSnapshot> = call('agentNative', { action: 'chooseModel', provider: 'chatgpt-codex', model: '' });
const exhaustive: Exclude<DesktopMethod, typeof desktopMethods[number]> extends never ? true : false = true;
void [board, conversation, exhaustive];
// @ts-expect-error Unknown method names are not part of the bridge.
void call('unknownMethod');
// @ts-expect-error A decision requires its version and identity.
void call('decide');
// @ts-expect-error Unknown input fields are rejected.
void call('snapshot', { unknown: true });
// @ts-expect-error Model choices require a model, not just a provider.
void call('agentNative', { action: 'chooseModel', provider: 'chatgpt-codex' });
// @ts-expect-error The caller cannot replace the method's actual reply type.
const wrong: Promise<AgentSnapshot> = call('snapshot');
void wrong;

// @ts-expect-error Confirmed decisions no longer have a withdrawal command.
void call('withdraw', { decisionID: 'decision', outcomeID: 'outcome' });

// @ts-expect-error Retired transient receipts have no read side-effect command.
void call('executionSeen', { id:'job', generation:1 });
void call('strategyRecords', { strategyID:'strategy' });
void call('knowledgeSave', { id:'document', body:'Changed paragraph', expectedVersion:1, requestID:'patch' });
