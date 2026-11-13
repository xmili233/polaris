import { Folder, Globe, Pencil, Plug, SquareTerminal, type LucideIcon } from 'lucide-react';
import type { ToolIconName } from './agent-activity';

const icons = { terminal: SquareTerminal, folder: Folder, edit: Pencil, globe: Globe, plugin: Plug } satisfies Record<ToolIconName, LucideIcon>;

export function AgentToolIcon({ name }: { name: ToolIconName }) {
  const Icon = icons[name];
  return <Icon className="agent-tool-glyph" data-icon={name} size={16} aria-hidden="true" focusable="false" />;
}
