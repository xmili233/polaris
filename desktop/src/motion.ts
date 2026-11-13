import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { duration } from './theme';

// R-D169: shared motion helpers. Values live in theme.css; reduced motion keeps only opacity changes.
export function reducedMotion() {
  return document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
}
export function easing(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/** Keeps a surface mounted while its exit animation plays; `closing` drives the exit class. */
export function usePresence(open: boolean, exit = '--motion-exit') {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) { setPresent(true); return; }
    if (!present) return;
    const timer = setTimeout(() => setPresent(false), reducedMotion() ? 0 : duration(exit));
    return () => clearTimeout(timer);
  }, [open]);
  return { present: open || present, closing: !open && present };
}

/** Fades the current view out with a short shift before the next one replaces it. The outgoing view stops taking input. */
export function swapOut(element: Element | null | undefined, shift: string, time = '--motion-swap-out') {
  if (!(element instanceof HTMLElement) || reducedMotion()) return Promise.resolve();
  element.inert = true;
  element.getAnimations().forEach(animation => animation.cancel());
  return element.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: shift }],
    { duration: duration(time), easing: easing('--ease-exit'), fill: 'forwards' }).finished.then(() => {}, () => {});
}
/** Brings a new view in from a short shift. */
export function swapIn(element: Element | null | undefined, shift: string, time = '--motion-swap-in') {
  if (!(element instanceof HTMLElement)) return;
  element.inert = false;
  element.getAnimations().forEach(animation => animation.cancel());
  element.animate([{ opacity: 0, transform: reducedMotion() ? 'none' : shift }, { opacity: 1, transform: 'none' }],
    { duration: duration(time), easing: easing('--ease-enter'), fill: 'backwards' });
}

/** Moves list items to their new places after a render (FLIP). New keys after the first render go to `onEnter`. */
export function useListMotion(ref: RefObject<HTMLElement | null>, selector: string, onEnter?: (node: HTMLElement) => void) {
  const positions = useRef<Map<string, number> | null>(null), order = useRef('');
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || host.offsetParent === null) { positions.current = null; return; }
    const nodes = [...host.querySelectorAll<HTMLElement>(selector)];
    const next = new Map(nodes.map(node => [node.dataset.motionKey ?? '', node.offsetTop]));
    const previous = positions.current, keys = [...next.keys()].join('\n'), changed = keys !== order.current;
    positions.current = next; order.current = keys;
    // Only additions, removals and reordering move items; resizes and re-wrapping text do not.
    if (!previous || !changed || reducedMotion()) return;
    for (const node of nodes) {
      const before = previous.get(node.dataset.motionKey ?? '');
      if (before === undefined) { onEnter?.(node); continue; }
      const delta = before - node.offsetTop;
      if (delta) node.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], { duration: duration('--motion-list'), easing: easing('--spring') });
    }
  });
}

/** Keeps removed list items in place, marked as leaving, until their exit animation ends. */
export function useLeaving<T>(items: T[], keyOf: (item: T) => string, exit = '--motion-list-exit') {
  const [ghosts, setGhosts] = useState<{ key: string; item: T; after: string | null }[]>([]);
  const previous = useRef(items), timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useLayoutEffect(() => {
    const keys = new Set(items.map(keyOf));
    const old = previous.current;
    previous.current = items;
    const removed = old.flatMap((item, index) => keys.has(keyOf(item)) ? [] : [{ key: keyOf(item), item, after: index ? keyOf(old[index - 1]) : null }]);
    if (reducedMotion()) { setGhosts([]); return; }
    setGhosts(current => [...current.filter(ghost => !keys.has(ghost.key) && !removed.some(item => item.key === ghost.key)), ...removed]);
    for (const ghost of removed) {
      clearTimeout(timers.current.get(ghost.key));
      timers.current.set(ghost.key, setTimeout(() => { timers.current.delete(ghost.key); setGhosts(current => current.filter(item => item.key !== ghost.key)); }, duration(exit)));
    }
  }, [items]);
  useEffect(() => () => timers.current.forEach(timer => clearTimeout(timer)), []);
  const merged: { key: string; item: T; leaving: boolean }[] = items.map(item => ({ key: keyOf(item), item, leaving: false }));
  for (const ghost of ghosts) {
    if (merged.some(entry => entry.key === ghost.key)) continue;
    const index = ghost.after === null ? -1 : merged.findIndex(entry => entry.key === ghost.after);
    merged.splice(index + 1, 0, { key: ghost.key, item: ghost.item, leaving: true });
  }
  return merged;
}
