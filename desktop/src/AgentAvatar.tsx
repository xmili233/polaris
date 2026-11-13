import { useEffect, useRef, useState } from 'react';
import { mountAvatar, type MountedAvatar } from 'open-bot-avatar/dom';
import type { AvatarDefinition } from 'open-bot-avatar';
import type { JobState } from '../service/agent-store';
import catalog from './agent-avatars.json';
import { useColorScheme } from './color-scheme';

export const mainAgentAvatarID = "main-agent";

const avatars = catalog as { color: string; depth: number; definition: AvatarDefinition }[];
// R-D169: the main Agent keeps the first avatar for itself; tasks that would land on it take the next one.
const mainAvatar = 0;

export function AgentAvatar({ id, state, visible = true, reducedMotion = false }: {
  id: string; state: JobState; visible?: boolean; reducedMotion?: boolean;
}) {
  const seed = [...id].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
  const index = id === mainAgentAvatarID ? mainAvatar : seed % avatars.length === mainAvatar ? mainAvatar + 1 : seed % avatars.length;
  const entry = avatars[index];
  const host = useRef<HTMLSpanElement>(null), renderer = useRef<MountedAvatar | null>(null);
  const [onScreen, setOnScreen] = useState(false), [foreground, setForeground] = useState(!document.hidden);
  const [systemReduced, setSystemReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const scheme = useColorScheme();

  useEffect(() => {
    const node = host.current!;
    const avatar = mountAvatar(node, { definition: entry.definition, still: true, label: '' });
    renderer.current = avatar;
    const observer = new IntersectionObserver(([item]) => setOnScreen(item.isIntersecting));
    observer.observe(node);
    const visibility = () => setForeground(!document.hidden);
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setSystemReduced(preference.matches);
    document.addEventListener('visibilitychange', visibility);
    preference.addEventListener('change', motion);
    return () => {
      observer.disconnect(); document.removeEventListener('visibilitychange', visibility);
      preference.removeEventListener('change', motion); avatar.destroy(); renderer.current = null;
    };
  }, []);

  useEffect(() => {
    const theme = getComputedStyle(document.documentElement);
    renderer.current?.update({
      definition: entry.definition, depth: entry.depth,
      color: theme.getPropertyValue(entry.color).trim(),
      // Ink bodies turn light in the dark appearance, so their eyes turn dark.
      eyeColor: theme.getPropertyValue(entry.color === '--ink' ? '--work-avatar-ink-eyes' : '--work-avatar-eyes').trim(),
      mood: state === 'running' ? 'thinking' : 'idle', followPointer: false,
      still: !visible || !onScreen || !foreground || reducedMotion || systemReduced || state !== 'running',
      reducedMotion: reducedMotion || systemReduced,
    });
  }, [entry, state, visible, onScreen, foreground, reducedMotion, systemReduced, scheme]);

  return <span ref={host} className="work-face" data-avatar-id={entry.definition.id} aria-hidden="true" />;
}
