import { useSyncExternalStore } from 'react';

// The main process decides the appearance (Settings: System, Light or Dark) and sends config.dark.
// The .theme-dark class selects the dark tokens in theme.css.
let dark: boolean | undefined;
const listeners = new Set<() => void>();
export function applyColorScheme(value: boolean) {
  if (value === dark) return;
  dark = value;
  document.documentElement.classList.toggle('theme-dark', value);
  for (const listener of listeners) listener();
}
// Components that read computed colors (avatars) redraw after the class changes.
export function useColorScheme() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => dark ? 'dark' : 'light');
}
