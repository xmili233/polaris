import { useCallback, useEffect, useState } from 'react';
import { call } from './types';
import type { OnboardingAgent, OnboardingSnapshot } from '../service/agents/types';
import { onboardingProviders } from '../service/agents/types';

export function useOnboardingAgents(visible: boolean) {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot>(() => ({ agents: onboardingProviders.map(agent => ({ ...agent, state: 'checking' })) }));
  useEffect(() => {
    if (!visible) return;
    let alive = true, reading = false, dirty = false;
    const read = async () => {
      if (reading) { dirty = true; return; }
      reading = true;
      try { const value = await call('agentOnboarding'); if (alive) setSnapshot(value); }
      catch { if (alive) setSnapshot(value => ({ ...value, agents: value.agents.map(item => ({ ...item, state: 'failed' })) })); }
      finally { reading = false; if (alive && dirty) { dirty = false; void read(); } }
    };
    const check = () => { void call('agentOnboardingCheck').then(read, read); };
    const unsubscribe = window.polaris.onAgent(() => void read());
    const foreground = () => { if (document.visibilityState === 'visible') check(); };
    check();
    const timer = setInterval(check, 5000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', foreground);
    return () => {
      alive = false; clearInterval(timer); unsubscribe(); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', foreground);
      void call('agentOnboardingCheck', { stop: true }).catch(() => {});
    };
  }, [visible]);
  const retry = useCallback((agent?: OnboardingAgent) => { void call('agentOnboardingCheck', agent ? { provider: agent.provider } : {}).catch(() => {}); }, []);
  const connect = useCallback(async () => {
    try { return await call('agentOnboardingContinue'); } catch { return false; }
  }, []);
  return { agents: snapshot.agents, preferred: snapshot.preferred, retry, connect };
}
