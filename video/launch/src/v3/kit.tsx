import React from 'react';
import {Easing, Img, interpolate, staticFile} from 'remotion';
import en from '../../public/v3/en/layout.json';
import zh from '../../public/v3/zh-Hans/layout.json';

// Values mirror desktop/src/theme.css; the film enlarges only its own captions.
export const C = {canvas: '#ffffff', ink: '#202124', secondary: '#6a6f78', surface: '#f6f7f9', border: '#e4e6eb', accent: '#0866ff'};
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"SF Mono", Menlo, Monaco, monospace';
export const FPS = 30;

export type Rect = {id: string; x: number; y: number; w: number; h: number};
export type Agent = Rect & {running: boolean};
type State = {cards: Rect[]; lanes: Rect[]; goals: Rect[]; header: Rect | null; modal: Rect | null; options: Rect[]; rail: Rect | null; agents: Agent[]};
type Layout = {window: {width: number; height: number}; scale: number; laneSurface: string; states: Record<string, State>};
export type Locale = 'en' | 'zh-Hans';
const LAYOUTS: Record<Locale, Layout> = {en: en as unknown as Layout, 'zh-Hans': zh as unknown as Layout};
// Each render shows one language; the composition root selects it before its scenes render.
let current: Locale = 'en';
export const setLocale = (value: Locale) => { current = value; };
export const locale = () => current;
/** Captured geometry for the current language. */
export const L = () => LAYOUTS[current];
export const PAGE = LAYOUTS.en.window;
/** Film pixels per captured CSS pixel when the window fills the 1920×1080 frame. */
export const S = 1920 / PAGE.width;

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
export const ease = Easing.bezier(.55, 0, .18, 1);
export const out = Easing.bezier(.16, 1, .3, 1);
export const ramp = (f: number, start: number, duration: number, curve: (t: number) => number = out) =>
  interpolate(f, [start, start + duration], [0, 1], {...clamp, easing: curve});
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const card = (state: string, id: string) => {
  const found = L().states[state].cards.find(item => item.id === id);
  if (!found) throw new Error(`Card ${id} is missing from ${state}.`);
  return found;
};
export const lane = (state: string, title: string) => {
  const found = L().states[state].lanes.find(item => item.id === title);
  if (!found) throw new Error(`Lane ${title} is missing from ${state}.`);
  return found;
};

export type Cam = {cx: number; cy: number; zoom: number};
export const OVERVIEW: Cam = {cx: PAGE.width / 2, cy: PAGE.height / 2, zoom: 1};
export const camMix = (a: Cam, b: Cam, p: number): Cam => ({cx: mix(a.cx, b.cx, p), cy: mix(a.cy, b.cy, p), zoom: mix(a.zoom, b.zoom, p)});
export const toScreen = (cam: Cam, x: number, y: number) => ({x: 960 + (x - cam.cx) * S * cam.zoom, y: 540 + (y - cam.cy) * S * cam.zoom});

/** Positions children in captured CSS pixels and frames them with a 2D camera. */
export const Page: React.FC<{cam: Cam; children?: React.ReactNode; style?: React.CSSProperties}> = ({cam, children, style}) =>
  <div style={{position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, transformOrigin: '0 0',
    transform: `translate(960px,540px) scale(${S * cam.zoom}) translate(${-cam.cx}px,${-cam.cy}px)`, ...style}}>{children}</div>;

export const Shot: React.FC<{name: string; style?: React.CSSProperties}> = ({name, style}) =>
  <Img src={staticFile(`v3/${current}/${name}.png`)} style={{position: 'absolute', left: 0, top: 0, width: PAGE.width, height: PAGE.height, maxWidth: 'none', ...style}}/>;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export type PieceKind = 'card' | 'lane' | 'rail' | 'modal' | 'agent';
/** A piece cropped by scripts/prepare-launch.py, placed at its page position. clip keeps only its top part. */
export const Piece: React.FC<{state: string; kind: PieceKind; r: Rect; clip?: number; radius?: number; style?: React.CSSProperties}> = ({state, kind, r, clip, radius = 12, style}) => {
  const file = kind === 'rail' || kind === 'modal' ? kind : `${kind}-${slug(r.id)}`;
  // Crops are rounded outward to whole capture pixels; offset by the same fraction.
  const scale = L().scale, dx = r.x - Math.floor(r.x * scale) / scale, dy = r.y - Math.floor(r.y * scale) / scale;
  const w = Math.ceil((r.x + r.w) * scale) / scale - Math.floor(r.x * scale) / scale, h = Math.ceil((r.y + r.h) * scale) / scale - Math.floor(r.y * scale) / scale;
  return <div style={{position: 'absolute', left: r.x, top: r.y, width: r.w, height: clip ?? r.h, overflow: 'hidden', borderRadius: radius, ...style}}>
    <Img src={staticFile(`v3/${current}/pieces/${state}/${file}.png`)} style={{position: 'absolute', left: -dx, top: -dy, width: w, height: h, maxWidth: 'none'}}/>
  </div>;
};

/** Covers the card area of a lane with its own surface color. */
export const LaneCover: React.FC<{r: Rect; top: number; opacity?: number}> = ({r, top, opacity = 1}) =>
  <div style={{position: 'absolute', left: r.x + 4, top, width: r.w - 8, height: r.y + r.h - top - 6, background: L().laneSurface, opacity}}/>;

export const Caption: React.FC<{text: string; f: number; from: number; to: number}> = ({text, f, from, to}) => {
  const p = Math.min(ramp(f, from, 12), 1 - ramp(f, to - 10, 10, ease));
  if (p <= 0) return null;
  return <div style={{position: 'absolute', left: 0, right: 0, bottom: 56, textAlign: 'center', fontFamily: FONT, opacity: p, transform: `translateY(${(1 - p) * 10}px)`, zIndex: 50}}>
    <span style={{display: 'inline-block', padding: '12px 30px 15px', background: 'rgba(255,255,255,.96)', borderRadius: 20, boxShadow: '0 10px 40px rgba(32,33,36,.10)',
      fontSize: 60, fontWeight: 600, lineHeight: 1.12, letterSpacing: current === 'zh-Hans' ? '0px' : '-2px', color: C.ink}}>{text}</span>
  </div>;
};

export const agent = (state: string, session: string) => {
  const found = L().states[state].agents.find(item => item.id === session);
  if (!found) throw new Error(`Agent ${session} is missing from ${state}.`);
  return found;
};

/** The Agent rail's running ring (desktop/src/styles.css .work-ring), redrawn so it can turn. */
export const Rings: React.FC<{state: string; f: number; opacity?: number; only?: string[]; fade?: Record<string, number>}> = ({state, f, opacity = 1, only, fade = {}}) => <>
  {L().states[state].agents.filter(item => item.running && (!only || only.includes(item.id))).map((item, i) => {
    const o = opacity * (fade[item.id] ?? 1);
    if (o <= 0) return null;
    return <svg key={item.id} viewBox="0 0 44 44" style={{position: 'absolute', left: item.x - 2, top: item.y - 2, width: item.w + 4, height: item.h + 4, opacity: o, overflow: 'visible',
      transform: `rotate(${(f / (1.1 * FPS)) * 360 + i * 97}deg)`}}>
      <circle cx="22" cy="22" r="21" fill="none" stroke={C.accent} strokeWidth={1.75} strokeDasharray="36 96" strokeLinecap="round"/>
    </svg>;
  })}
</>;

/** A captured state framed by the camera, with its running Agents turning. */
export const Board: React.FC<{state: string; cam: Cam; f: number; opacity?: number; rings?: number; children?: React.ReactNode}> = ({state, cam, f, opacity = 1, rings = 1, children}) =>
  <Page cam={cam} style={{opacity}}><Shot name={state}/><Rings state={state} f={f} opacity={rings}/>{children}</Page>;
