import React from 'react';
import {AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame} from 'remotion';
import {PageCam, type CamKey} from './lib/PageCam';
import data from './layout.json';
import {CAPTIONS, EVENTS, FPS, MUSIC, NARRATION, SHOTS, TOTAL} from './timeline';

const C = {ink:'#202124', accent:'#0866ff', surface:'#f6f7f9', secondary:'#6a6f78', white:'#ffffff'};
const FONT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const clamp = {extrapolateLeft:'clamp', extrapolateRight:'clamp'} as const;
const ease = Easing.bezier(.55,0,.18,1);
const ramp = (f:number,s:number,d:number,curve=(t:number)=>1-Math.pow(1-t,5)) => interpolate(f,[s,s+d],[0,1],{...clamp,easing:curve});
const mix = (a:number,b:number,p:number) => a+(b-a)*p;
const SCALE = 1920/1320;
const PAGE_H = 820*SCALE;
const OVERVIEW = {cx:812,cy:566,zoom:.88};
const MODAL = {x:220*SCALE,y:120*SCALE,w:880*SCALE,h:580*SCALE};
type Box = {x:number;y:number;w:number;h:number};
const boxes = data as Record<string,Box>;
const ids = ['audience','angle','promise','problem','demo','access','invitation','teaser','onboarding','feedback','followup','intent'];

// The three reveal channels and timing come from video-shotcraft/blur-slide.
export const WordLine:React.FC<{text:string;start?:number;color?:string;size?:number;gap?:number}> = ({text,start=0,color=C.ink,size=96,gap=3}) => {
  const f=useCurrentFrame();
  return <div style={{display:'flex',gap:'.25em',fontSize:size,fontWeight:500,letterSpacing:'-.045em',lineHeight:1.12,color,whiteSpace:'nowrap'}}>
    {text.split(' ').map((word,i)=>{const p=ramp(f,start+i*gap,22);return <span key={i} style={{display:'inline-block',opacity:p,transform:`translateY(${(1-p)*size*.38}px)`,filter:p>.999?undefined:`blur(${(1-p)*10}px)`}}>{word}</span>;})}
  </div>;
};

export const Opening:React.FC<{line1?:string;line2?:string}> = ({line1='Your agents do the legwork.',line2='You make the calls.'}) => {
  const f=useCurrentFrame();
  return <AbsoluteFill style={{background:C.white,color:'#000000',fontFamily:FONT,opacity:1-ramp(f,84,6)}}>
    <div style={{position:'absolute',left:140,top:95,display:'flex',alignItems:'center',gap:19,fontSize:38,fontWeight:600,letterSpacing:'-1.5px'}}><Img src={staticFile('icon.png')} style={{width:58,height:58,borderRadius:13}}/>Polaris</div>
    <div style={{position:'absolute',left:140,top:360}}><WordLine text={line1} start={7} size={100}/><div style={{height:24}}/><WordLine text={line2} start={20} color={C.accent} size={100}/></div>
  </AbsoluteFill>;
};

export const Ending:React.FC<{cta?:string}> = ({cta='Follow for the launch.'}) => {
  const f=useCurrentFrame(); const p=spring({fps:FPS,frame:f,config:{damping:24,stiffness:110}});
  return <AbsoluteFill style={{background:C.white,color:'#000000',fontFamily:FONT,justifyContent:'center',alignItems:'center'}}>
    <div style={{display:'flex',alignItems:'center',gap:38,opacity:p,transform:`translateY(${(1-p)*24}px) scale(${mix(.96,1,p)})`}}><Img src={staticFile('icon.png')} style={{width:160,height:160,borderRadius:34}}/><span style={{fontSize:132,fontWeight:500,letterSpacing:'-7px'}}>Polaris</span></div>
    <div style={{position:'absolute',top:665,fontSize:56,letterSpacing:'-1.6px',color:C.secondary,opacity:ramp(f,21,22)}}>{cta}</div>
  </AbsoluteFill>;
};

function Cursor({x,y,click=0,opacity=1}:{x:number;y:number;click?:number;opacity?:number}) {
 return <div style={{position:'absolute',left:x,top:y,zIndex:20,opacity,pointerEvents:'none'}}>
  {click>0&&click<1?<div style={{position:'absolute',left:-30,top:-30,width:60,height:60,borderRadius:60,border:`2px solid rgba(8,102,255,${1-click})`,transform:`scale(${.4+click})`}}/>:null}
  <svg viewBox="0 0 24 24" width={38} height={38} style={{overflow:'visible',filter:'drop-shadow(0 3px 3px #20212444)',transform:`scale(${click>0&&click<.25?.84:1})`,transformOrigin:'4px 3px'}}><path d="M4.5 2.5 L4.5 19.2 L8.9 15 L11.9 21.6 L14.9 20.3 L11.9 13.8 L18.2 13.4 Z" fill="#202124" stroke="white" strokeWidth={1.6} strokeLinejoin="round"/></svg>
 </div>;
}

export const Goal:React.FC = () => {
 const f=useCurrentFrame();
 const keys:CamKey[]=[{frame:0,cx:730,cy:170,zoom:1.6},{frame:34,cx:730,cy:170,zoom:1.6},{frame:89,...OVERVIEW}];
 return <PageCam src="capture/shell.png" pageH={PAGE_H} keys={keys} frame={f}/>;
};

// The row-embed recipe is adapted to three interleaved columns, preserving the
// 12-frame accelerating descent, 16-degree tilt, four-frame landing settle.
export const Parallel:React.FC = () => {
 const f=useCurrentFrame();
 const camera:CamKey[]=[{frame:0,...OVERVIEW},{frame:164,...OVERVIEW},{frame:199,cx:820,cy:350,zoom:1.4},{frame:255,cx:820,cy:350,zoom:1.4},{frame:299,...OVERVIEW}];
 return <PageCam src="capture/shell.png" pageH={PAGE_H} keys={camera} frame={f}>
  {[0,1,2].map(i=>{const p=spring({fps:FPS,frame:f-9-i*3,config:{damping:23,stiffness:160}});return <Img key={i} src={staticFile(`capture/lane-${i}.png`)} style={{position:'absolute',left:(104+i*312)*SCALE,top:96*SCALE,width:296*SCALE,height:700*SCALE,opacity:Math.min(1,p),transform:`translateY(${(1-p)*28}px)`,borderRadius:16*SCALE}}/>;})}
  {ids.map((id,i)=>{
   const r=boxes[id];const cue=43+i*8-Math.floor(i*i/40); const land=cue+12;const p=ramp(f,cue,12,Easing.bezier(.5,0,.8,.75));
   const air=1-p;const settle=f<land?1.06-.065*p:mix(.995,1,ramp(f,land,4,Easing.out(Easing.quad)));
   if(f<cue)return null;
   return <Img key={id} src={staticFile(`capture/card-${id}.png`)} style={{position:'absolute',left:r.x*SCALE,top:r.y*SCALE,width:r.w*SCALE,height:r.h*SCALE,opacity:ramp(f,cue,3),transform:`perspective(900px) translateY(${-120*air}px) rotateX(${16*air}deg) scale(${settle})`,filter:air>.001?`drop-shadow(0 ${air*18}px ${air*22}px #20212422)`:undefined,borderRadius:12*SCALE}}/>;
  })}
 </PageCam>;
};

function camValues(f:number,kind:'first'|'second') {
 const start=SHOTS[kind].from;const duration=SHOTS[kind].duration;
 const confirm=kind==='first'?EVENTS.firstConfirm:EVENTS.secondConfirm;
 const p=ramp(f,start,24,ease);const q=ramp(f,confirm+4,start+duration-confirm-4,ease);
 const read={cx:750,cy:440,zoom:2.05};
 const options={cx:1360,cy:420,zoom:2.1};
 const button={cx:1370,cy:880,zoom:1.35};
 const optionAt=start+(kind==='first'?180:72);
 const o=ramp(f,optionAt,30,ease);const b=ramp(f,confirm-60,28,ease);
 const axis=(key:'cx'|'cy'|'zoom')=>mix(mix(mix(mix(OVERVIEW[key],read[key],p),options[key],o),button[key],b),OVERVIEW[key],q);
 return {cx:axis('cx'),cy:axis('cy'),zoom:axis('zoom')};
}

export const DecisionScene:React.FC<{kind?:'first'|'second'}> = ({kind='first'}) => {
 const local=useCurrentFrame();const f=local+SHOTS[kind].from;
 const confirm=kind==='first'?EVENTS.firstConfirm:EVENTS.secondConfirm;
 const select=kind==='first'?EVENTS.firstSelect:EVENTS.secondSelect;
 const name=kind==='first'?'audience':'angle';const r=boxes[name];
 const open=ramp(local,2,23,ease)*(1-ramp(f,confirm+3,7));
 const selection=ramp(f,select+2,7);const after=f>=confirm+7;
 const base=kind==='first'?(after?'after-first':'board'):(after?'after-second':'after-first');
 const cam=camValues(f,kind);
 const x=mix(r.x*SCALE,MODAL.x,ramp(local,2,23,ease));
 const y=mix(r.y*SCALE,MODAL.y,ramp(local,2,23,ease));
 const w=mix(r.w*SCALE,MODAL.w,ramp(local,2,23,ease));
 const h=mix(r.h*SCALE,MODAL.h,ramp(local,2,23,ease));
 const content=ramp(local,12,13)*(1-ramp(f,confirm+2,3));
 const ox=925*SCALE,oy=kind==='first'?196*SCALE:202*SCALE;
 const bx=934*SCALE,by=668*SCALE;
 const from={x:(r.x+r.w*.7)*SCALE,y:(r.y+r.h*.45)*SCALE};
 let cur=from;
 const toOption=ramp(f,select-40,24,ease);
 cur={x:mix(cur.x,ox,toOption),y:mix(cur.y,oy,toOption)};
 const toButton=ramp(f,confirm-27,24,ease);
 cur={x:mix(cur.x,bx,toButton),y:mix(cur.y,by,toButton)};
 const screen={x:960+(cur.x-cam.cx)*cam.zoom,y:540+(cur.y-cam.cy)*cam.zoom};
 const clickFrame=f>=confirm?f-confirm:f>=select?f-select:local;
 const click=clickFrame>=0&&clickFrame<18?clickFrame/18:0;
 return <>
  <PageCam src={`capture/${base}.png`} pageH={PAGE_H} keys={[{frame:0,...cam},{frame:1,...cam}]} frame={0}>
   <div style={{position:'absolute',inset:0,background:C.ink,opacity:open*.2}}/>
   <div style={{position:'absolute',left:x,top:y,width:w,height:h,overflow:'hidden',background:C.white,borderRadius:mix(12,16,content)*SCALE,opacity:open,boxShadow:'0 25px 70px #20212424'}}>
    <Img src={staticFile(`capture/${kind}-modal.png`)} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:content}}/>
    <Img src={staticFile(`capture/${kind}-modal-selected.png`)} style={{position:'absolute',inset:0,width:'100%',height:'100%',opacity:content*selection}}/>
   </div>
  </PageCam>
  <Cursor {...screen} click={click} opacity={ramp(local,0,8)*(1-ramp(f,confirm+3,14))}/>
 </>;
};

export const Board:React.FC<{src?:string}> = ({src='board'}) => <PageCam src={`capture/${src}.png`} pageH={PAGE_H} keys={[{frame:0,...OVERVIEW},{frame:1,...OVERVIEW}]} frame={0}/>;

export const Caption:React.FC<{text?:string;duration?:number}> = ({text='Your decisions, all in one place.',duration=120}) => {
 const f=useCurrentFrame();const p=Math.min(ramp(f,0,10),1-ramp(f,duration-9,9));
 return <div style={{position:'absolute',bottom:18,left:0,right:0,textAlign:'center',fontFamily:FONT,opacity:p,transform:`translateY(${(1-p)*9}px)`,zIndex:30}}><span style={{display:'inline-block',padding:'10px 30px 13px',background:'rgba(255,255,255,.97)',borderRadius:18,fontSize:77,fontWeight:500,lineHeight:1.12,letterSpacing:'-2.8px',color:C.ink}}>{text}</span></div>;
};

export const Film:React.FC<{bgm?:boolean}> = ({bgm=true}) => {
 return <AbsoluteFill style={{background:C.white}}>
  <Sequence {...SHOTS.opening}><Opening/></Sequence>
  <Sequence {...SHOTS.goal}><Goal/></Sequence>
  <Sequence {...SHOTS.parallel}><Parallel/></Sequence>
  <Sequence {...SHOTS.first}><DecisionScene kind="first"/></Sequence>
  <Sequence {...SHOTS.between}><Board src="after-first"/></Sequence>
  <Sequence {...SHOTS.second}><DecisionScene kind="second"/></Sequence>
  <Sequence {...SHOTS.progress}><Board src="after-second"/></Sequence>
  <Sequence {...SHOTS.ending}><Ending/></Sequence>
  {CAPTIONS.map(c=><Sequence key={c.from} from={c.from} durationInFrames={c.duration}><Caption text={c.text} duration={c.duration}/></Sequence>)}
  {bgm?<Audio src={staticFile(MUSIC.src)} volume={MUSIC.volume}/>:null}
  <Audio src={staticFile(NARRATION.src)} volume={NARRATION.volume}/>
 </AbsoluteFill>;
};
