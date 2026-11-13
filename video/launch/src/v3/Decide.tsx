import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Board, C, Cam, camMix, card, ease, L, mix, OVERVIEW, Page, Piece, ramp, Rect, Shot} from './kit';
import T from './timeline.json';

/**
 * Opening a decision card and confirming it, from captured states: the card grows into the dialog,
 * the camera reads the question and context, then the options, and the choice is selected and confirmed.
 */
export type DecideCue = {focus: number; open: number; read: number; options: number; select: number; button: number; confirm: number; end: number};
export const DecisionFlow: React.FC<{f: number; id: string; board: string; opened: string; selected: string; after: string; cue: DecideCue; start?: Cam; finish?: Cam;
  before?: {state: string; until: number}; arrival?: React.ReactNode; then?: React.ReactNode}> =
  ({f, id, board, opened, selected, after, cue, start = OVERVIEW, finish = OVERVIEW, before, arrival, then}) => {
  const from: Rect = card(board, id), modal = L().states[opened].modal!;
  const focusCam: Cam = {cx: from.x + from.w / 2 + 160, cy: from.y + from.h / 2 + 60, zoom: 1.3};
  const modalCam: Cam = {cx: modal.x + modal.w / 2, cy: modal.y + modal.h / 2, zoom: 1.12};
  const readCam: Cam = {cx: modal.x + 250, cy: modal.y + 175, zoom: 1.72};
  const optionsCam: Cam = {cx: modal.x + modal.w - 240, cy: modal.y + 175, zoom: 1.72};
  const buttonCam: Cam = {cx: modal.x + modal.w - 300, cy: modal.y + modal.h - 200, zoom: 1.32};
  const steps: [number, Cam][] = [[cue.focus, focusCam], [cue.open, modalCam], [cue.read, readCam], [cue.options, optionsCam], [cue.button, buttonCam], [cue.confirm + 10, finish]];
  let cam = start;
  for (const [at, next] of steps) cam = camMix(cam, next, ramp(f, at, 30, ease));
  const grow = ramp(f, cue.open, 22, ease);
  const opening = f >= cue.open && f < cue.open + 24;
  // The capture of the open dialog takes over once the surface has reached it.
  const shown = ramp(f, cue.open + 22, 2) * (1 - ramp(f, cue.confirm, 12));
  const choose = ramp(f, cue.select, 5);
  const surface = {x: mix(from.x, modal.x, grow), y: mix(from.y, modal.y, grow), w: mix(from.w, modal.w, grow), h: mix(from.h, modal.h, grow)};
  const done = f >= cue.confirm;
  // While open, the app hides the source card; the dialog grows from its place over the 20% ink scrim.
  const hidden = f >= cue.open && !done ? <div style={{position: 'absolute', left: from.x, top: from.y, width: from.w, height: from.h, background: L().laneSurface}}/> : null;
  return <AbsoluteFill style={{background: C.canvas, overflow: 'hidden'}}>
    <Board state={done ? after : before && f < before.until ? before.state : board} cam={cam} f={f} rings={1 - .8 * Math.max(grow, shown)}>{done ? then : <>{arrival}{hidden}</>}</Board>
    {opening && <AbsoluteFill style={{background: 'rgba(32,33,36,.2)', opacity: grow}}/>}
    <Page cam={cam} style={{opacity: shown}}><Shot name={opened}/></Page>
    <Page cam={cam} style={{opacity: shown * choose}}><Shot name={selected}/></Page>
    {opening && <Page cam={cam}>
      <div style={{position: 'absolute', left: surface.x, top: surface.y, width: surface.w, height: surface.h, overflow: 'hidden', borderRadius: mix(12, 16, grow), background: C.canvas,
        boxShadow: `0 ${24 * grow}px ${70 * grow}px rgba(32,33,36,.18), 0 0 0 1px ${C.border}`}}>
        <div style={{position: 'absolute', left: 0, top: 0, width: modal.w, height: modal.h, transformOrigin: '0 0', transform: `scale(${surface.w / modal.w})`, opacity: ramp(f, cue.open + 4, 12)}}>
          <Piece state={opened} kind="modal" r={modal} radius={16} style={{left: 0, top: 0}}/>
        </div>
      </div>
    </Page>}
  </AbsoluteFill>;
};

// From src/v3/timeline.json: open 8.5 s, choose 12 s, confirm 13 s.
export const DECIDE = {...T.decide, end: T.scenes.decide.duration};
export const Decide: React.FC<{f: number}> = ({f}) =>
  <DecisionFlow f={f} id="audience" board="customers-board" opened="audience-open" selected="audience-selected" after="customers-after-audience" cue={DECIDE}/>;
