import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from './App';
import { ConnectAgents } from './Onboarding';
import { useOnboardingAgents } from './useOnboardingAgents';
import { call } from './types';
import type { translator } from './i18n';

export function WorkspaceGate({ t }: { t: ReturnType<typeof translator> }) {
  const [route, setRoute] = useState<'checking' | 'connect' | 'workspace'>('checking');
  const { agents, preferred, retry, connect } = useOnboardingAgents(route !== 'workspace');
  const restoring = useRef(false);
  const localWorkspace = useRef(false);
  useEffect(() => {
    if (route === 'workspace') return;
    let alive = true;
    const read = () => void call('snapshot').then(snapshot => {
      if (alive && snapshot?.hasData) { localWorkspace.current = true; setRoute('workspace'); }
    }).catch(() => { if (alive) { localWorkspace.current = true; setRoute('workspace'); } });
    read(); const timer = setInterval(read, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [route]);
  const continueToWorkspace = useCallback(() => setRoute('workspace'), []);
  // R-D85: a restored launch waits only for the Agent it will use: the one chosen before, or else the first ready one.
  useEffect(() => {
    if (route !== 'checking' || restoring.current || agents.find(agent => agent.provider === preferred)?.state === 'checking') return;
    if (!agents.some(agent => agent.state === 'ready')) {
      if (!agents.some(agent => agent.state === 'checking')) setRoute('connect');
      return;
    }
    restoring.current = true;
    void connect().then(ready => { if (!localWorkspace.current) setRoute(ready ? 'workspace' : 'connect'); });
  }, [route, agents, preferred, connect]);
  if (route === 'workspace') return <App />;
  if (route === 'checking') return <main className="connect-screen starting" aria-busy="true" aria-labelledby="starting-title">
    <div className="window-drag-region" />
    <div className="connect-body"><img className="connect-mark" src="./polaris-icon.png" alt="" /><h1 id="starting-title">{t("onboarding.startingPolaris")}</h1></div>
  </main>;
  return <ConnectAgents agents={agents} onContinue={continueToWorkspace} prepareContinue={connect} onRetry={retry} onCopy={() => retry()} t={t} />;
}
