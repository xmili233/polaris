import React from 'react';
import {AbsoluteFill, Sequence, useCurrentFrame} from 'remotion';
import {COPY} from './copy';
import {Decide} from './Decide';
import {End, Focus} from './Finale';
import {Goals} from './Goals';
import {Caption, Locale, setLocale} from './kit';
import T from './timeline.json';
import {Strategy} from './Strategy';
import {Work} from './Work';

// Scene starts and caption times come from src/v3/timeline.json, shared with scripts/make-launch-v3-audio.py.
const scene = (name: keyof typeof T.scenes) => ({from: T.scenes[name].from, durationInFrames: T.scenes[name].duration});
export const SCENES = {work: scene('work'), decide: scene('decide'), goals: scene('goals'), strategy: scene('strategy'), focus: scene('focus'), end: scene('end')};
export const LAUNCH_FRAMES = T.frames;
const CAPTION_TIMES = T.captions;

const Local: React.FC<{scene: React.FC<{f: number}>}> = ({scene: Scene}) => <Scene f={useCurrentFrame()}/>;
const WorkScene: React.FC = () => <Work/>;

export const Launch: React.FC<{locale?: Locale}> = ({locale = 'en'}) => {
  setLocale(locale);
  const f = useCurrentFrame();
  return <AbsoluteFill style={{background: '#ffffff'}}>
    <Sequence {...SCENES.work}><WorkScene/></Sequence>
    <Sequence {...SCENES.decide}><Local scene={Decide}/></Sequence>
    <Sequence {...SCENES.goals}><Local scene={Goals}/></Sequence>
    <Sequence {...SCENES.strategy}><Local scene={Strategy}/></Sequence>
    <Sequence {...SCENES.focus}><Local scene={Focus}/></Sequence>
    <Sequence {...SCENES.end}><Local scene={End}/></Sequence>
    {COPY[locale].captions.map((text, i) => <Caption key={i} text={text} f={f} from={CAPTION_TIMES[i][0]} to={CAPTION_TIMES[i][1]}/>)}
  </AbsoluteFill>;
};
