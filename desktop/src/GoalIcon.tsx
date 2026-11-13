import { Target, ChartNoAxesCombined, Users, Store, Megaphone, Globe, BriefcaseBusiness,
  Code, Hammer, Lightbulb, Rocket, FlaskConical, BookOpen, GraduationCap,
  Wallet, Heart, Armchair, Send, MessagesSquare, CircleCheck, type LucideIcon } from 'lucide-react';
import type { GoalIconName } from '../service/goal-icons';

const icons = { Target, ChartNoAxesCombined, Users, Store, Megaphone, Globe, BriefcaseBusiness,
  Code, Hammer, Lightbulb, Rocket, FlaskConical, BookOpen, GraduationCap,
  Wallet, Heart, Armchair, Send, MessagesSquare, CircleCheck } satisfies Record<GoalIconName, LucideIcon>;

export function GoalIcon({ name }: { name: string }) {
  const resolved = Object.hasOwn(icons, name) ? name : 'Target';
  const Icon = icons[resolved as keyof typeof icons] ?? icons.Target;
  return <Icon className="goal-symbol" data-icon={resolved} size="1em" aria-hidden="true" focusable="false" />;
}
