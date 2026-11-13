import React, {useLayoutEffect, useRef, useState} from 'react';
import {AbsoluteFill, continueRender, delayRender, Img, staticFile, useCurrentFrame} from 'remotion';
import {Block, COPY, Who} from './copy';
import T from './timeline.json';
import {agent, C, card, ease, FONT, LaneCover, L, locale, mix, MONO, OVERVIEW, Page, Piece, ramp, Rings, S, Shot, toScreen} from './kit';

// Work logs from three background Agents (src/v3/copy.ts); questions become the cards with the same ids.
const ORDER = ['audience', 'invitation', 'problem', 'promise', 'access', 'angle', 'demo', 'teaser', 'feedback', 'onboarding', 'intent', 'followup'];
const W = 820; // log column width in film pixels
const session = (who: Who) => `launch-session-${who}`;

function parts(text: string) {
  return text.split(/(\{\{[^}]+\}\})/).filter(Boolean).map(part => {
    const match = /^\{\{([^|]+)\|(.+)\}\}$/.exec(part);
    return match ? {id: match[1], text: match[2]} : {text: part};
  });
}

const Entry: React.FC<{block: Block; lit: (id: string) => number; textOpacity: number; markOpacity: number}> = ({block, lit, textOpacity, markOpacity}) =>
  <div style={{width: W, paddingBottom: 38, fontFamily: FONT, color: C.ink}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, opacity: textOpacity}}>
      <Img src={staticFile(`v3/${locale()}/pieces/customers-board/agent-${session(block.who)}.png`)} style={{width: 34, height: 34}}/>
      <span style={{fontSize: 20, fontWeight: 600}}>{COPY[locale()].strategies[block.who]}</span>
    </div>
    {block.tool && <div style={{marginBottom: 10, fontFamily: MONO, fontSize: 16, color: C.secondary, opacity: textOpacity}}>{block.tool}</div>}
    <p style={{margin: 0, fontSize: 25, lineHeight: 1.62}}>{parts(block.text).map((part, i) => {
      if (!('id' in part)) return <span key={i} style={{opacity: textOpacity}}>{part.text}</span>;
      const p = lit(part.id!);
      return <mark key={i} data-q={part.id} style={{color: p > .5 ? C.accent : C.ink, background: `rgba(8,102,255,${.13 * p})`, borderRadius: 6, padding: '1px 3px', margin: '0 -3px',
        boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', opacity: Math.max(textOpacity, p) * markOpacity}}>{part.text}</mark>;
    })}</p>
  </div>;

type Box = {x: number; y: number; w: number; h: number};
type Camera = {cy: number; zoom: number; tilt: number; roll: number; oy: number};
const PERSPECTIVE = 1500;
const transform = (c: Camera) => `translate(960px,${c.oy}px) perspective(${PERSPECTIVE}px) rotateX(${c.tilt}deg) rotateZ(${c.roll}deg) scale(${c.zoom}) translate(${-W / 2}px,${-c.cy}px)`;
// Mirrors transform() for a point in log coordinates.
function project(c: Camera, x: number, y: number) {
  const x1 = (x - W / 2) * c.zoom, y1 = (y - c.cy) * c.zoom;
  const r = c.roll * Math.PI / 180, t = c.tilt * Math.PI / 180;
  const x2 = x1 * Math.cos(r) - y1 * Math.sin(r), y2 = x1 * Math.sin(r) + y1 * Math.cos(r);
  const y3 = y2 * Math.cos(t), z3 = y2 * Math.sin(t), w = 1 - z3 / PERSPECTIVE;
  return {x: 960 + x2 / w, y: c.oy + y3 / w};
}

// Reading, accelerating scroll, pull-back, lift, the logs returning to their Agents, questions landing as cards.
// From src/v3/timeline.json: the questions lift on the beat at 5 s and the cards land on sixteenths from the drop at 6 s.
export const WORK = {...T.work, end: T.scenes.work.duration};
const REST: Omit<Camera, 'cy'> = {zoom: .66, tilt: 50, roll: -14, oy: 500};

export const Work: React.FC = () => {
  const f = useCurrentFrame();
  const {blocks: BLOCKS, strategies: NAME} = COPY[locale()];
  const QUESTIONS = Object.fromEntries(BLOCKS.flatMap(block => [...block.text.matchAll(/\{\{([^|]+)\|([^}]+)\}\}/g)].map(m => [m[1], m[2]])));
  const doc = useRef<HTMLDivElement>(null);
  const [handle] = useState(() => delayRender('Measure the work log'));
  const [measured, setMeasured] = useState<{height: number; blocks: Box[]; marks: Record<string, Box>}>();
  useLayoutEffect(() => {
    const node = doc.current!; const base = node.getBoundingClientRect(), k = base.width / W;
    const box = (r: DOMRect): Box => ({x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k});
    const marks: Record<string, Box> = {};
    node.querySelectorAll<HTMLElement>('mark[data-q]').forEach(mark => { marks[mark.dataset.q!] = box(mark.getClientRects()[0] ?? mark.getBoundingClientRect()); });
    setMeasured({height: base.height / k, blocks: Array.from(node.children).map(child => box(child.getBoundingClientRect())), marks});
    continueRender(handle);
  }, [handle]);

  const height = measured?.height ?? 3000;
  const first = measured?.marks.audience.y ?? 600;
  // Reads at a steady pace so the first questions light one by one, then accelerates smoothly through the rest.
  const steady = 4.2, at = Math.min(f, WORK.scrollEnd), late = Math.max(0, at - WORK.read);
  const accel = (height * .72 - (first - 220 + steady * WORK.scrollEnd)) / (WORK.scrollEnd - WORK.read) ** 2;
  const scroll = first - 220 + steady * at + accel * late * late;
  const pull = ramp(f, WORK.pullStart, WORK.pullEnd - WORK.pullStart, ease);
  const rest: Camera = {...REST, cy: height * .5};
  const cam: Camera = f >= WORK.pullEnd ? rest : {cy: mix(scroll, rest.cy, pull), zoom: mix(1, REST.zoom, pull), tilt: mix(0, REST.tilt, pull), roll: mix(0, REST.roll, pull), oy: mix(540, REST.oy, pull)};
  // A question lights up as the reading line passes it; any left light up before the pull-back ends.
  const lit = (id: string) => {
    const y = measured?.marks[id]?.y ?? 0;
    return Math.max(Math.min(1, Math.max(0, (scroll + 140 - y) / 60)), ramp(f, WORK.pullEnd - 40 + ORDER.indexOf(id) * 2, 10));
  };
  const lift = ramp(f, WORK.lift, 14);
  const textOpacity = 1 - .45 * ramp(f, WORK.lift, 10);
  const markOpacity = 1 - ramp(f, WORK.lift, 6);
  const boardIn = ramp(f, WORK.collapse + 2, 28, ease);
  const cardTop = (title: string) => Math.min(...ORDER.filter(id => NAME[BLOCKS.find(b => b.text.includes(`{{${id}|`))!.who] === title).map(id => card('customers-board', id).y)) - 3;

  return <AbsoluteFill style={{background: C.canvas, overflow: 'hidden'}}>
    <Page cam={OVERVIEW} style={{opacity: boardIn}}>
      <Shot name="customers-board"/>
      {L().states['customers-board'].lanes.map(r => <LaneCover key={r.id} r={r} top={cardTop(r.id)}/>)}
      <Rings state="customers-board" f={f}/>
      {/* Each Agent takes its log back in. */}
      {(['conversations', 'public', 'offer'] as Who[]).map(who => {
        const last = Math.max(...BLOCKS.map((b, i) => b.who === who ? i : -1));
        const arrive = WORK.collapse + last * WORK.collapseGap + WORK.collapseFor;
        const bump = Math.sin(Math.PI * ramp(f, arrive - 4, 12, t => t));
        if (bump <= 0) return null;
        const r = agent('customers-board', session(who));
        return <Piece key={who} state="customers-board" kind="agent" r={{...r, id: session(who)}} radius={r.w} style={{transform: `scale(${1 + .18 * bump})`}}/>;
      })}
    </Page>
    <div aria-hidden style={{position: 'absolute', left: 0, top: 0, visibility: 'hidden'}}>
      <div ref={doc} style={{width: W}}>{BLOCKS.map((block, i) => <Entry key={i} block={block} lit={() => 0} textOpacity={1} markOpacity={1}/>)}</div>
    </div>
    {measured && BLOCKS.map((block, i) => {
      const b = measured.blocks[i];
      const start = WORK.collapse + i * WORK.collapseGap, p = ramp(f, start, WORK.collapseFor, t => t * t * t);
      if (p >= 1) return null;
      const from = project(rest, W / 2, b.y + b.h / 2);
      const avatar = agent('customers-board', session(block.who)), target = toScreen(OVERVIEW, avatar.x + avatar.w / 2, avatar.y + avatar.h / 2);
      return <div key={i} style={{position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transformOrigin: `${from.x}px ${from.y}px`,
        transform: `translate(${(target.x - from.x) * p}px,${(target.y - from.y) * p}px) scale(${mix(1, .03, p)})`, opacity: 1 - p * p}}>
        <div style={{position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: transform(cam)}}>
          <div style={{position: 'absolute', left: 0, top: b.y}}><Entry block={block} lit={lit} textOpacity={textOpacity} markOpacity={markOpacity}/></div>
        </div>
      </div>;
    })}
    {measured && f >= WORK.lift && <>
      {/* All forming cards share one page layer; only the flying question text is drawn per item. */}
      <Page cam={OVERVIEW} style={{zIndex: 10}}>
        {ORDER.map((id, index) => {
          const r = card('customers-board', id), start = WORK.flyStart + index * WORK.flyGap;
          const form = ramp(f, start + WORK.fly * .55, WORK.fly * .45), settled = ramp(f, start + WORK.fly, 8);
          if (form <= 0) return null;
          return <Piece key={id} state="customers-board" kind="card" r={r} style={{opacity: form, transform: `scale(${mix(.94, 1, form)})`,
            boxShadow: `0 0 0 1px rgba(8,102,255,${1 - ramp(f, start + WORK.fly + 6, 18)}), 0 ${14 * (1 - settled)}px ${30 * (1 - settled)}px rgba(32,33,36,.12)`}}/>;
        })}
      </Page>
      {ORDER.map((id, index) => {
        // The question text leaves the log and lands on the card title; the card forms around it.
        const source = measured.marks[id]; const r = card('customers-board', id);
        const from = project(rest, source.x, source.y + source.h / 2), along = project(rest, source.x + 100, source.y + source.h / 2);
        const angle = Math.atan2(along.y - from.y, along.x - from.x) * 180 / Math.PI, startSize = 25 * Math.hypot(along.x - from.x, along.y - from.y) / 100;
        const to = toScreen(OVERVIEW, r.x + 15, r.y + 15 + 14 * 1.4 / 2);
        const start = WORK.flyStart + index * WORK.flyGap, t = ramp(f, start, WORK.fly, ease);
        // Text keeps one rasterized size and scales by transform; changing font sizes every frame exhausts the renderer.
        const size = mix(startSize, 14 * S, t) / (14 * S);
        const x = mix(from.x, to.x, t), y = mix(from.y, to.y, t) + Math.sin(Math.PI * t) * -70;
        const form = ramp(f, start + WORK.fly * .55, WORK.fly * .45), settled = ramp(f, start + WORK.fly, 8);
        if (settled >= 1) return null;
        const raised = f < start ? lift : 1, glow = raised * (1 - form);
        return <div key={id} style={{position: 'absolute', left: x, top: y, zIndex: 40 + index, transformOrigin: '0 50%', whiteSpace: 'nowrap', fontFamily: FONT,
          transform: `translate(-.25em,-50%) rotate(${angle * (1 - t)}deg) scale(${size * (1 + .06 * raised * (1 - t))})`, willChange: 'transform', fontSize: 14 * S, lineHeight: 1.4, fontWeight: 500,
          padding: '0 .25em', borderRadius: '.3em', color: C.accent, background: `rgba(8,102,255,${.13 * (1 - form)})`, opacity: ramp(f, WORK.lift, 6) * (1 - settled),
          boxShadow: glow > 0 ? `0 ${10 * glow}px ${24 * glow}px rgba(8,102,255,${.18 * glow})` : undefined}}>{QUESTIONS[id]}</div>;
      })}
    </>}
  </AbsoluteFill>;
};
