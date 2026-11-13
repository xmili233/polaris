import React from 'react';
import {AbsoluteFill, Img, spring, staticFile} from 'remotion';
import {Board, C, camMix, ease, FONT, FPS, L, locale, mix, OVERVIEW, Page, ramp} from './kit';
import {COPY} from './copy';
import T from './timeline.json';
import {NEW_STRATEGY_CAM} from './Strategy';

// The whole plan in view: goal, constraints and strategies stay clear while the Agents keep working.
export const FOCUS = {end: T.scenes.focus.duration};
export const Focus: React.FC<{f: number}> = ({f}) => {
  const cam = camMix(NEW_STRATEGY_CAM, OVERVIEW, ramp(f, 0, T.focus.pull, ease));
  const dim = ramp(f, T.focus.dim, 24, ease) * .55;
  const state = 'customers-communities';
  return <AbsoluteFill style={{background: C.canvas, overflow: 'hidden'}}>
    <Board state={state} cam={cam} f={f}/>
    <Page cam={cam}>
      {L().states[state].lanes.map(r => {
        const top = Math.min(...L().states[state].cards.filter(c => c.x >= r.x && c.x < r.x + r.w).map(c => c.y)) - 4;
        return <div key={r.id} style={{position: 'absolute', left: r.x, top, width: r.w, height: r.y + r.h - top, background: C.canvas, opacity: dim, borderRadius: '0 0 16px 16px'}}/>;
      })}
    </Page>
  </AbsoluteFill>;
};


export const END = {end: T.scenes.end.duration};
export const End: React.FC<{f: number}> = ({f}) => {
  // The logo lands on the final downbeat at 36 s.
  const p = spring({fps: FPS, frame: f, config: {damping: 24, stiffness: 110}});
  return <AbsoluteFill style={{background: C.canvas, opacity: ramp(f, 0, 10), color: C.ink, fontFamily: FONT, justifyContent: 'center', alignItems: 'center'}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 38, marginTop: -60, opacity: p, transform: `translateY(${(1 - p) * 24}px) scale(${mix(.96, 1, p)})`}}>
      <Img src={staticFile('icon.png')} style={{width: 160, height: 160, borderRadius: 34}}/>
      <span style={{fontSize: 132, fontWeight: 600, letterSpacing: '-6px'}}>Polaris</span>
    </div>
    <div style={{position: 'absolute', top: 610, textAlign: 'center'}}>
      {COPY[locale()].end.map((line, i) => <div key={line} style={{fontSize: 48, lineHeight: 1.3, fontWeight: 500, letterSpacing: locale() === 'zh-Hans' ? '0px' : '-1.2px', opacity: ramp(f, 22 + i * 15, 18)}}>{line}</div>)}
      <div style={{marginTop: 22, fontSize: 32, color: C.secondary, letterSpacing: '-.3px', opacity: ramp(f, 52, 18)}}>github.com/xmili233/polaris</div>
    </div>
  </AbsoluteFill>;
};
