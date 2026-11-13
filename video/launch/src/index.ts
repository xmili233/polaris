import React from 'react';
import {Composition,registerRoot} from 'remotion';
import {Film} from './Film';
import {FPS,TOTAL} from './timeline';
import {Launch,LAUNCH_FRAMES} from './v3/Launch';
const size={fps:FPS,width:1920,height:1080};
registerRoot(()=>React.createElement(React.Fragment,null,
  React.createElement(Composition,{id:'ResolveLaunch',component:Film,durationInFrames:TOTAL,...size,defaultProps:{bgm:true}}),
  React.createElement(Composition,{id:'PolarisLaunch',component:Launch,durationInFrames:LAUNCH_FRAMES,...size,defaultProps:{locale:'en' as const}}),
  React.createElement(Composition,{id:'PolarisLaunchZh',component:Launch,durationInFrames:LAUNCH_FRAMES,...size,defaultProps:{locale:'zh-Hans' as const}}),
));
