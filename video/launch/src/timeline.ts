export const FPS = 30;
export const TOTAL = 1350;
export const SHOTS = {
  opening: {from: 0, duration: 90},
  goal: {from: 90, duration: 90},
  parallel: {from: 180, duration: 300},
  first: {from: 480, duration: 390},
  between: {from: 870, duration: 60},
  second: {from: 930, duration: 240},
  progress: {from: 1170, duration: 60},
  ending: {from: 1230, duration: 120},
};
export const EVENTS = {
  firstSelect: SHOTS.first.from + 285,
  firstConfirm: SHOTS.first.from + 360,
  secondSelect: SHOTS.second.from + 150,
  secondConfirm: SHOTS.second.from + 225,
};
export const CAPTIONS = [
  {from: SHOTS.goal.from + 10, duration: 70, text: 'One goal.'},
  {from: SHOTS.parallel.from + 16, duration: 120, text: 'Multiple strategies. Moving in parallel.'},
  {from: SHOTS.parallel.from + 142, duration: 148, text: 'Your decisions, all in one place.'},
  {from: SHOTS.first.from + 20, duration: 150, text: 'The context. The options. Your call.'},
  {from: SHOTS.first.from + 214, duration: 102, text: 'Compare the options.'},
  {from: SHOTS.first.from + 319, duration: 71, text: 'Make the call.'},
  {from: SHOTS.between.from, duration: 58, text: 'Then move to the next one.'},
  {from: SHOTS.second.from + 12, duration: 220, text: 'Keep your strategies moving.'},
  {from: SHOTS.progress.from + 3, duration: 54, text: 'A few decisions. More progress.'},
];
export const NARRATION = {from:0, duration:TOTAL, src:'audio/narration.wav', volume:1};
export const MUSIC = {from:0, duration:TOTAL, src:'audio/score.wav', volume:1};
