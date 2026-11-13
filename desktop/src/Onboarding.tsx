import { useEffect, useRef, useState } from 'react';
import type { translator, MessageKey } from './i18n';
import { duration } from './theme';

type T = ReturnType<typeof translator>;

// R-D76 / R-D78: what the connect page needs from detection. The service decides the state; this page only shows it.
import type { AgentReadiness, OnboardingAgent } from '../service/agents/types';
export type { AgentReadiness, OnboardingAgent } from '../service/agents/types';

const stateWords: Partial<Record<AgentReadiness, MessageKey>> = { signed_out: "onboarding.notSignedIn", missing: "onboarding.notInstalled", outdated: "onboarding.updateNeeded", failed: "onboarding.checkFailed" };

// R-D77: rows are grouped by spacing and a shared right edge; no frame, no dividers.
export function ConnectAgents({ agents, onContinue, prepareContinue, onCopy, onRetry, t }: {
  agents: OnboardingAgent[]; onContinue: () => void; prepareContinue: () => Promise<boolean>; onCopy?: (agent: OnboardingAgent) => void; onRetry?: (agent: OnboardingAgent) => void; t: T;
}) {
  const [open, setOpen] = useState('');
  const [copied, setCopied] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const pending = useRef(false);
  const ready = agents.some(agent => agent.state === 'ready');
  const checking = agents.some(agent => agent.state === 'checking');
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1500); return () => clearTimeout(timer); }, [copied]);
  // The page fades out (--state) before the full-window Agent takes its place.
  useEffect(() => { if (!leaving) return; const timer = setTimeout(onContinue, duration('--motion-exit')); return () => clearTimeout(timer); }, [leaving, onContinue]);
  async function proceed() {
    if (pending.current) return;
    pending.current = true; setConnecting(true);
    try { if (await prepareContinue()) setLeaving(true); }
    finally { pending.current = false; setConnecting(false); }
  }
  async function copy(agent: OnboardingAgent) {
    try { await window.polaris.copyText(agent.command ?? ''); setCopied(agent.provider); } catch { setCopied(''); }
    onCopy?.(agent);
  }
  return <main className={`connect-screen ${leaving ? 'leaving' : ''}`} aria-labelledby="connect-title">
    <div className="window-drag-region" />
    <div className="connect-body">
      <img className="connect-mark" src="./polaris-icon.png" alt="Polaris" />
      <h1 id="connect-title">{t("onboarding.connectYourAI")}</h1>
      <p>{t("onboarding.existingAccounts")}</p>
      <ul className="connect-agents" aria-labelledby="connect-title">
        {agents.map(agent => {
          // A state word opens its fix command; a failed check is retried directly.
          const fixable = agent.state === 'signed_out' || agent.state === 'missing' || agent.state === 'outdated';
          const expanded = fixable && open === agent.provider;
          return <li key={agent.provider} className="connect-agent" data-state={agent.state}>
            <span className="connect-agent-name">{agent.name}</span>
            <span className="connect-agent-state">
              {agent.state === 'checking' ? <span className="connect-spinner" role="img" aria-label={t("onboarding.checking")} />
                : agent.state === 'ready' ? <svg className="connect-check" viewBox="0 0 16 16" role="img" aria-label={t("onboarding.connected")}><path d="m3.5 8.5 3 3 6-7" /></svg>
                : agent.state === 'failed' ? <button className="connect-state-link" onClick={() => onRetry?.(agent)}>{t(stateWords.failed!)}</button>
                : <button className="connect-state-link" aria-expanded={expanded} aria-controls={`connect-fix-${agent.provider}`}
                  onClick={() => setOpen(expanded ? '' : agent.provider)}>{t(stateWords[agent.state]!)}</button>}
            </span>
            {expanded && agent.command && <div className="connect-fix" id={`connect-fix-${agent.provider}`}>
              <span>{t("onboarding.runInTerminal")}</span><code>{agent.command}</code>
              <button className="connect-link" onClick={() => void copy(agent)}>{t(copied === agent.provider ? "onboarding.copied" : "common.copy")}</button>
            </div>}
          </li>;
        })}
      </ul>
      {/* INT-STATE-01: while checking the spinners speak for themselves; the button appears once one AI can be used. */}
      <div className="connect-action" aria-live="polite">
        {ready ? <button className="connect-continue" disabled={leaving || connecting} onClick={() => void proceed()}>{t("common.continue")}</button>
          : !checking && <p>{t("onboarding.installOrSignInToAnyOne")}</p>}
      </div>
    </div>
  </main>;
}
