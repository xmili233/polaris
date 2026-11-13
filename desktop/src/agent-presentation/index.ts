import type { ProviderID } from '../../service/agent-store';
// Stored provider identity controls historical presentation, not the currently selected provider.
export function presentationPolicy(provider?: ProviderID) {
  return {
    explicitFinal: !provider || provider === 'chatgpt-codex',
    freezeAtAnswer: !provider || provider === 'chatgpt-codex',
    label: provider === 'claude-code' ? 'Claude Code' : provider === 'gemini-cli' ? 'Gemini CLI' : provider === 'chatgpt-codex' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : '',
  };
}
