// client/js/core/command-registry.ts

export interface Command {
  id: string;
  label: string;
  category: string;
  icon?: string;
  execute: () => void | Promise<void>;
  when?: () => boolean;
}

const registry = new Map<string, Command>();

const RECENT_KEY = 'x-launchpad-recent-commands';
const MAX_RECENT = 10;

export function registerCommand(cmd: Command): void {
  registry.set(cmd.id, cmd);
}

export function getCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.when || c.when());
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function executeCommand(id: string): void {
  const cmd = registry.get(id);
  if (cmd && (!cmd.when || cmd.when())) {
    cmd.execute();
    addRecentCommand(id);
  }
}

export function getRecentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addRecentCommand(id: string): void {
  const recent = getRecentCommands().filter((r) => r !== id);
  recent.unshift(id);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}
