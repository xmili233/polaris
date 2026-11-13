export const goalIconNames = [
  'Target', 'ChartNoAxesCombined', 'Users', 'Store', 'Megaphone', 'Globe', 'BriefcaseBusiness',
  'Code', 'Hammer', 'Lightbulb', 'Rocket', 'FlaskConical', 'BookOpen', 'GraduationCap',
  'Wallet', 'Heart', 'Armchair', 'Send', 'MessagesSquare', 'CircleCheck',
] as const;
export type GoalIconName = typeof goalIconNames[number];

export function findGoalIcon(name: string) {
  return goalIconNames.find(icon => icon === name || icon.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase() === name);
}

// Read compatibility for values already stored by older Polaris versions, not a catalog of new icons.
const legacy: Record<string, GoalIconName> = {
  '🪑': 'Armchair', 'chart.line.uptrend.xyaxis': 'ChartNoAxesCombined', paperplane: 'Send',
  'bubble.left.and.bubble.right': 'MessagesSquare', 'checkmark.circle': 'CircleCheck',
};
export function existingGoalIcon(name: string) {
  return findGoalIcon(name) ?? (Object.hasOwn(legacy, name) ? legacy[name] : 'Target');
}
