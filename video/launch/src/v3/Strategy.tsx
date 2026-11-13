import React from 'react';
import {COPY} from './copy';
import T from './timeline.json';
import {DecisionFlow} from './Decide';
import {agent, card, lane, LaneCover, locale, mix, PAGE, Piece, ramp, Rings, Shot} from './kit';

// A background Agent suggests a fourth strategy as an ordinary decision card (R-D181). Once confirmed,
// the strategy's column appears, an Agent prepares its first cards (R-D188), and they land one by one.
const SUGGESTION = 'communities-suggestion', NEW_AGENT = 'launch-session-communities';
const CARDS = ['community', 'lead', 'intro'];
// From src/v3/timeline.json: confirm at 27.5 s, the column on the bar at 28 s, cards on beats at 30, 30.5 and 31 s.
export const STRATEGY = {...T.strategy, end: T.scenes.strategy.duration};
const zoom = PAGE.width / (PAGE.width - 76);
// Settles on the edge between the goal rail and the board, with the new column and the Agents in view.
export const NEW_STRATEGY_CAM = {zoom, cx: PAGE.width - PAGE.width / zoom / 2, cy: PAGE.height / zoom / 2};

export const Strategy: React.FC<{f: number}> = ({f}) => {
  const s = STRATEGY;
  const suggestion = card('customers-suggestion', SUGGESTION);
  const rise = ramp(f, s.arrive, 14);
  const arrival = <>
    <LaneCover r={{...suggestion, x: suggestion.x - 4, w: suggestion.w + 8}} top={suggestion.y - 2} opacity={f < s.arrive + 14 ? 1 : 0}/>
    {f >= s.arrive && <Piece state="customers-suggestion" kind="card" r={suggestion} style={{opacity: rise, transform: `translateY(${(1 - rise) * 10}px)`,
      boxShadow: `0 0 0 1px rgba(8,102,255,${1 - ramp(f, s.arrive + 20, 18)})`}}/>}
  </>;
  const column = lane('customers-preparing', COPY[locale()].added);
  const laneIn = ramp(f, s.laneIn, 24);
  const preparing = ramp(f, s.prepare, 12) * (1 - ramp(f, s.firstCard - 8, 8));
  const firstTop = Math.min(...CARDS.map(id => card('customers-communities', id).y));
  const handover = ramp(f, s.settle, 12);
  const newAgent = ramp(f, s.prepare - 6, 10) * (1 - ramp(f, s.agentDone, 12));
  const then = <>
    <div style={{opacity: laneIn, transform: `translateX(${(1 - laneIn) * 36}px)`}}>
      <Piece state="customers-preparing" kind="lane" r={column} radius={16}/>
      <LaneCover r={column} top={firstTop - 3} opacity={1 - preparing}/>
    </div>
    {CARDS.map((id, i) => {
      const r = card('customers-communities', id), start = s.firstCard + i * s.cardGap;
      if (f < start) return null;
      const p = ramp(f, start, s.drop, t => t * t), air = 1 - p, land = f >= start + s.drop;
      const settle = land ? mix(.99, 1, ramp(f, start + s.drop, 5)) : 1.05 - .05 * p;
      const outline = land ? 1 - ramp(f, start + s.drop + 6, 18) : 1;
      return <div key={id} style={{position: 'absolute', left: 0, top: 0, opacity: ramp(f, start, 4),
        transform: `perspective(900px) translateY(${-80 * air}px) rotateX(${14 * air}deg) scale(${settle})`, transformOrigin: `${r.x + r.w / 2}px ${r.y}px`,
        filter: air > .001 ? `drop-shadow(0 ${air * 16}px ${air * 20}px rgba(32,33,36,.16))` : undefined}}>
        <Piece state="customers-communities" kind="card" r={r} style={{boxShadow: `0 0 0 1px rgba(8,102,255,${outline})`}}/>
      </div>;
    })}
    {/* Once the cards are in, the captured board takes over: counts update and the new column is complete. */}
    {handover > 0 && <div style={{opacity: handover}}><Shot name="customers-communities"/><Rings state="customers-communities" f={f}/></div>}
    {CARDS.map((id, i) => {
      const r = card('customers-communities', id), start = s.firstCard + i * s.cardGap + s.drop;
      const outline = 1 - ramp(f, start + 6, 18);
      return handover > 0 && outline > 0 ? <div key={id} style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 12, boxShadow: `0 0 0 1px rgba(8,102,255,${outline * handover})`}}/> : null;
    })}
    {newAgent > 0 && <>
      <Piece state="customers-preparing" kind="agent" r={agent('customers-preparing', NEW_AGENT)} radius={40} style={{opacity: newAgent, transform: `scale(${mix(.6, 1, ramp(f, s.prepare - 6, 12))})`}}/>
      <Rings state="customers-preparing" f={f} only={[NEW_AGENT]} opacity={newAgent}/>
    </>}
  </>;
  return <DecisionFlow f={f} id={SUGGESTION} board="customers-suggestion" before={{state: 'customers-after-audience', until: s.arrive}} opened="suggestion-open" selected="suggestion-selected"
    after="customers-after-audience" cue={{focus: s.focus, open: s.open, read: s.read, options: s.options, select: s.select, button: s.button, confirm: s.confirm, end: s.end}}
    finish={NEW_STRATEGY_CAM} arrival={arrival} then={then}/>;
};
