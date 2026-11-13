import {Film,Opening,Goal,Parallel,DecisionScene,Board,Ending,Caption} from './Film';
import {CAPTIONS,FPS,MUSIC,NARRATION,SHOTS,TOTAL} from './timeline';
export const WORKBENCH = {
 name:'Polaris launch v2 · Aoede',fps:FPS,width:1920,height:1080,total:TOTAL,background:'#ffffff',revision:'1.3',
 shots:[
  {id:'opening',label:'Opening',...SHOTS.opening,component:Opening,props:{line1:'Your agents do the legwork.',line2:'You make the calls.'},schema:[{type:'text',key:'line1',label:'First line'},{type:'text',key:'line2',label:'Second line'}]},
  {id:'goal',label:'One goal',...SHOTS.goal,component:Goal},
  {id:'parallel',label:'Parallel strategies',...SHOTS.parallel,component:Parallel},
  {id:'first',label:'First decision',...SHOTS.first,component:DecisionScene,props:{kind:'first'}},
  {id:'between',label:'Return to the board',...SHOTS.between,component:Board,props:{src:'after-first'}},
  {id:'second',label:'Second decision',...SHOTS.second,component:DecisionScene,props:{kind:'second'}},
  {id:'progress',label:'Keep moving',...SHOTS.progress,component:Board,props:{src:'after-second'}},
  {id:'ending',label:'End card',...SHOTS.ending,component:Ending,props:{cta:'Follow for the launch.'},schema:[{type:'text',key:'cta',label:'Call to action'}]},
 ],
 captions:CAPTIONS.map((c,i)=>({id:`caption-${i}`,label:c.text,from:c.from,duration:c.duration,component:Caption,props:{text:c.text,duration:c.duration},durationProp:'duration',schema:[{type:'text',key:'text',label:'Caption'}]})),
 sfx:[NARRATION],bgm:[MUSIC],transitions:[],overlays:[],order:['captions'],original:Film,
};
