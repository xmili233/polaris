import { ArrowUp, ChartNoAxesCombined, Check, GraduationCap, Heart, Library, Plus, Settings, X } from 'lucide-react';
import catalog from '../../../desktop/src/agent-avatars.json';

// Product views on the website. They mirror the desktop board, dialog and chat in its dark appearance using the
// shared desktop tokens; sizes are the desktop pixel tokens expressed in em so each view scales as a whole.

export type Card = { title: string; body: string; ago: string };
export type Lane = { title: string; body: string; cards: Card[] };
export type Goal = { title: string; milestone: string; constraints: string[]; lanes: Lane[] };
export type Option = { label: string; detail: string; recommended?: boolean };

type Avatar = { color: string; definition: { id: string; body: { path: string }; eyes: { x: number; y: number; spacing: number; scale: number } } };
const avatars = catalog as Avatar[];
const avatar = (id: string) => avatars.find(entry => entry.definition.id === id)!;
const railAvatars = ['polaris-leaf', 'polaris-pudding', 'polaris-peak', 'polaris-squircle', 'polaris-cat'];

export function Face({ id, running = false }: { id: string; running?: boolean }) {
  const { color, definition } = avatar(id), { x, y, spacing, scale } = definition.eyes;
  // Ink bodies turn light in the dark appearance, so their eyes turn dark (as in AgentAvatar).
  const eyes = color === '--ink' ? 'var(--work-avatar-ink-eyes)' : 'var(--work-avatar-eyes)';
  const eye = (cx: number) => <rect x={cx - 2.75 * scale} y={y - 5.5 * scale} width={5.5 * scale} height={11 * scale} rx={2.75 * scale} fill={eyes} />;
  return <span className="pm-face" data-running={running || undefined}>
    <svg viewBox="0 0 100 100"><path d={definition.body.path} fill={`var(${color})`} />{eye(x - spacing / 2)}{eye(x + spacing / 2)}</svg>
  </span>;
}

function AgentRail({ running }: { running: number[] }) {
  return <div className="pm-agents">
    <span className="pm-agent-main"><Face id="polaris-pebble" /></span>
    <span className="pm-agent-divider" />
    {railAvatars.map((id, index) => <Face key={id} id={id} running={running.includes(index)} />)}
  </div>;
}

const goalIcons = [ChartNoAxesCombined, GraduationCap, Heart];

export function Board({ goal, selected, badges, labels, running = [0, 2] }: {
  goal: Goal; selected: number; badges: number[]; labels: { constraints: string }; running?: number[];
}) {
  return <div className="pm pm-board">
    <nav className="pm-goals">
      {goalIcons.map((Icon, index) => <span key={index} className="pm-goal" data-selected={index === selected || undefined}>
        <Icon strokeWidth={1.75} /><b className="pm-badge">{badges[index]}</b>
      </span>)}
      <span className="pm-goals-end"><Library strokeWidth={1.75} /><Settings strokeWidth={1.75} /></span>
    </nav>
    <section className="pm-main">
      <h4 className="pm-goal-title">{goal.title}</h4>
      <p className="pm-milestone">{goal.milestone}</p>
      <p className="pm-constraints"><span>{labels.constraints}</span>{goal.constraints.map(text => <span key={text} className="pm-chip">{text}</span>)}</p>
      <div className="pm-lanes">{goal.lanes.map(lane => <LaneView key={lane.title} lane={lane} />)}</div>
    </section>
    <AgentRail running={running} />
  </div>;
}

export function LaneView({ lane, preparing, className }: { lane: Lane; preparing?: string; className?: string }) {
  return <div className={className ? `pm-lane ${className}` : 'pm-lane'}>
    <p className="pm-lane-title">{lane.title}<span>{lane.cards.length}</span></p>
    <p className="pm-lane-body">{lane.body}</p>
    {preparing && <p className="pm-preparing"><span className="pm-arc" />{preparing}</p>}
    {lane.cards.map(card => <div key={card.title} className="pm-card">
      <p className="pm-card-title">{card.title}</p>
      <p className="pm-card-body">{card.body}</p>
      <p className="pm-meta">{card.ago}</p>
    </div>)}
  </div>;
}

export function DecisionDialog({ strategy, title, ago, children, options, labels }: {
  strategy: string; title: string; ago: string; children: React.ReactNode; options: Option[];
  labels: { recommended: string; or: string; custom: string; help: string; decide: string };
}) {
  return <div className="pm pm-dialog">
    <section className="pm-dialog-question">
      <p className="pm-dialog-strategy">{strategy}</p>
      <h4 className="pm-dialog-title">{title}</h4>
      <p className="pm-meta">{ago}</p>
      <div className="pm-dialog-body">{children}</div>
    </section>
    <section className="pm-dialog-answer">
      <X className="pm-close" strokeWidth={1.75} />
      {options.map((option, index) => <div key={option.label} className="pm-option" data-selected={index === 0 || undefined}>
        <span className="pm-option-number">{index + 1}</span>
        <span className="pm-option-text">
          <span className="pm-option-title">{option.label}{option.recommended && <em>{labels.recommended}</em>}</span>
          <span className="pm-option-detail">{option.detail}</span>
        </span>
        {index === 0 && <Check className="pm-check" strokeWidth={2.25} />}
      </div>)}
      <p className="pm-or"><span>{labels.or}</span></p>
      <p className="pm-custom">{labels.custom}</p>
      <p className="pm-help">{labels.help}</p>
      <p className="pm-decide">{labels.decide}<kbd>⌘↩</kbd></p>
    </section>
  </div>;
}

export function Chat({ user, intro, strategies, next, placeholder }: {
  user: string; intro: string; strategies: { title: string; body: string }[]; next: string; placeholder: string;
}) {
  return <div className="pm pm-chat">
    <div className="pm-thread">
      <p className="pm-bubble">{user}</p>
      <div className="pm-reply">
        <p>{intro}</p>
        <ol>{strategies.map(item => <li key={item.title}><strong>{item.title}</strong><span>{item.body}</span></li>)}</ol>
        <p>{next}</p>
      </div>
    </div>
    <div className="pm-composer">
      <p>{placeholder}</p>
      <div><Plus strokeWidth={1.75} /><span className="pm-send"><ArrowUp strokeWidth={2.25} /></span></div>
    </div>
  </div>;
}
