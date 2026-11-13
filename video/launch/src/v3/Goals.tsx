import React from 'react';
import {AbsoluteFill, spring} from 'remotion';
import {C, card, ease, FPS, L, mix, PAGE, Piece, ramp, Rings, S, Shot} from './kit';
import T from './timeline.json';

// Three goals from different parts of life, cascaded so each title stays readable.
// Reading order follows the narration: growth, learning, then life.
const PLANES = ['customers-after-audience', 'japanese-board', 'marathon-board'];
const K = .56, DX = 236, DY = 152, LEFT = 150, TOP = 46;
export const GOALS = {exit: T.goals.exit, end: T.scenes.goals.duration};
// While the boards are fanned out, a new card arrives in the learning and the life goal on the beat.
const ARRIVALS: Record<string, {id: string; at: number}> = {'japanese-board': {id: 'commute', at: T.goals.arrivals[0]}, 'marathon-board': {id: 'shoes', at: T.goals.arrivals[1]}};
const Arrival: React.FC<{state: string; f: number}> = ({state, f}) => {
  const item = ARRIVALS[state];
  if (!item) return null;
  const r = card(state, item.id), rise = ramp(f, item.at, 12);
  return <>
    {f < item.at + 12 && <div style={{position: 'absolute', left: r.x - 2, top: r.y - 2, width: r.w + 4, height: r.h + 4, background: L().laneSurface}}/>}
    {f >= item.at && <Piece state={state} kind="card" r={r} style={{opacity: rise, transform: `translateY(${(1 - rise) * 10}px)`, boxShadow: `0 0 0 1px rgba(8,102,255,${1 - ramp(f, item.at + 18, 18)})`}}/>}
  </>;
};

export const Goals: React.FC<{f: number}> = ({f}) => {
  const fan = spring({fps: FPS, frame: f, config: {damping: 200, stiffness: 60}});
  const exit = ramp(f, GOALS.exit, GOALS.end - GOALS.exit, ease);
  const tilt = fan * (1 - exit);
  // A slow push across the fanned boards while new cards arrive, released on the way back.
  const push = mix(mix(1, 1.05, ramp(f, T.goals.push[0], T.goals.push[1] - T.goals.push[0], t => t)), 1, exit);
  const drift = Math.sin(f / 90) * 6 * (1 - exit);
  return <AbsoluteFill style={{background: C.canvas, overflow: 'hidden', perspective: 2600}}>
    <div style={{position: 'absolute', inset: 0, transformStyle: 'preserve-3d', transform: `scale(${push}) rotateY(${-7 * tilt}deg) rotateX(${3 * tilt}deg)`}}>
      {PLANES.map((name, i) => {
        // The growth board starts full-frame and steps back; the others arrive in front of it. On exit it returns.
        const p = i === 0 ? fan : spring({fps: FPS, frame: f - 15 * i, config: {damping: 200, stiffness: 70}});
        const slot = {x: LEFT + DX * i + drift * (i - 1), y: TOP + DY * i - drift * .5 * (i - 1), k: K};
        const from = i === 0 ? {x: 0, y: 0, k: 1} : {x: slot.x + 160, y: slot.y + 120, k: K};
        let x = mix(from.x, slot.x, p), y = mix(from.y, slot.y, p), k = mix(from.k, slot.k, p);
        if (i === 0) { x = mix(x, 0, exit); y = mix(y, 0, exit); k = mix(k, 1, exit); }
        const frame = i === 0 ? fan * (1 - exit) : 1;
        const away = i === 0 ? 0 : ramp(f, GOALS.exit, 14);
        return <div key={name} style={{position: 'absolute', left: x + away * 220, top: y + away * 160, width: PAGE.width * S, height: PAGE.height * S, transformOrigin: '0 0', transform: `scale(${k})`,
          opacity: i === 0 ? 1 : Math.min(1, p * 1.4) * (1 - away), zIndex: i, borderRadius: 22 * frame, overflow: 'hidden',
          boxShadow: `0 ${40 * frame}px 110px rgba(32,33,36,${.18 * frame})`, outline: `${2 * frame}px solid ${C.border}`}}>
          <div style={{position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, transformOrigin: '0 0', transform: `scale(${S})`}}>
            <Shot name={name}/><Arrival state={name} f={f}/><Rings state={name} f={f + i * 7}/>
          </div>
        </div>;
      })}
    </div>
  </AbsoluteFill>;
};
