import { AgentStore, type ProviderID } from './agent-store.js';
import { PolarisStore } from './store.js';
import { PolarisError } from './model.js';
import { discover, inspectConnection, providerCommands, providerIDs } from './agents/discovery.js';
import { onboardingProviders, type AgentReadiness, type NativeConnection, type OnboardingAgent, type OnboardingSnapshot } from './agents/types.js';

export function onboardingState(connection: NativeConnection): AgentReadiness {
  if (!connection.installed) return 'missing';
  if (connection.error && !['native_missing', 'native_version', 'native_auth'].includes(connection.error)) return 'failed';
  if (!connection.compatible) return 'outdated';
  if (connection.authenticated === false) return 'signed_out';
  return connection.connected ? 'ready' : 'failed';
}
type Probe = (provider: ProviderID, saved: Partial<NativeConnection>, signal: AbortSignal) => Promise<NativeConnection>;
const inspectProvider: Probe = async (provider, saved, signal) => inspectConnection(await discover(provider, saved, signal), signal);

// Discovery has no coordinator and cannot enable an Agent, resume a job or read Polaris's OAuth store.
export class AgentOnboarding {
  private agents = new Map<ProviderID, OnboardingAgent>();
  private probes = new Map<ProviderID, { controller: AbortController; done: Promise<void> }>();
  private continuing?: Promise<boolean>;
  private checkedAt = new Map<ProviderID, number>();
  constructor(readonly store: PolarisStore, readonly notify: () => void, readonly probe: Probe = inspectProvider, readonly timeout = 10_000) {
    new AgentStore(store);
    for (const provider of providerIDs) this.set(provider, 'checking', false);
  }
  private set(provider: ProviderID, state: AgentReadiness, notify = true, models?: OnboardingAgent['models']) {
    const command = state === 'missing' ? providerCommands[provider].install : state === 'outdated' ? providerCommands[provider].update : state === 'signed_out' ? providerCommands[provider].login : undefined;
    this.agents.set(provider, { provider, name: onboardingProviders.find(item => item.provider === provider)!.name, state, ...(command ? { command } : {}), ...(state === 'ready' && models?.length ? { models } : {}) });
    if (notify) this.notify();
  }
  snapshot(): OnboardingSnapshot {
    const preferred = this.previous();
    return { agents: providerIDs.map(id => this.agents.get(id)!), ...(preferred ? { preferred } : {}) };
  }
  private previous() {
    const value = this.store.query("SELECT value FROM metadata WHERE key='agent_provider'")[0]?.value;
    return providerIDs.includes(value as ProviderID) ? value as ProviderID : undefined;
  }
  async check(provider?: ProviderID) {
    if (provider && !providerIDs.includes(provider)) throw new PolarisError('invalid_input', 'Unknown Agent provider.');
    await Promise.all((provider ? [provider] : providerIDs.filter(id => this.agents.get(id)?.state !== 'ready' || Date.now() - (this.checkedAt.get(id) ?? 0) >= 60_000)).map(id => this.checkOne(id)));
  }
  private checkOne(provider: ProviderID): Promise<void> {
    const active = this.probes.get(provider); if (active) return active.done;
    const controller = new AbortController();
    if (this.agents.get(provider)?.state !== 'ready') this.set(provider, 'checking');
    let timer: ReturnType<typeof setTimeout>;
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, this.timeout); });
    const saved = JSON.parse(String(this.store.query('SELECT payload FROM agent_connection WHERE provider=?', provider)[0]?.payload ?? '{}'));
    const done = Promise.race([Promise.resolve().then(() => this.probe(provider, saved, controller.signal)), expired])
      .then(connection => { if (this.probes.get(provider)?.controller === controller) { this.checkedAt.set(provider, Date.now()); this.set(provider, onboardingState(connection), true, connection.models); } })
      .catch(() => { if (this.probes.get(provider)?.controller === controller) this.set(provider, 'failed'); })
      .finally(() => { clearTimeout(timer); if (this.probes.get(provider)?.controller === controller) this.probes.delete(provider); });
    this.probes.set(provider, { controller, done }); return done;
  }
  continue(activate: (provider: ProviderID) => Promise<boolean>) {
    if (this.continuing) return this.continuing;
    this.continuing = (async () => {
      const ready = this.snapshot().agents.filter(agent => agent.state === 'ready');
      const provider = (ready.find(agent => agent.provider === this.previous()) ?? ready[0])?.provider;
      if (!provider) return false;
      try { if (await activate(provider)) return true; } catch { /* Keep the same page and its retry affordance. */ }
      this.set(provider, 'failed'); return false;
    })().finally(() => { this.continuing = undefined; });
    return this.continuing;
  }
  async stop() {
    const pending = [...this.probes.values()]; this.probes.clear();
    for (const entry of pending) entry.controller.abort();
    // Probe implementations must observe the signal; the deadline also bounds a broken child.
    await Promise.allSettled(pending.map(entry => entry.done));
  }
}
