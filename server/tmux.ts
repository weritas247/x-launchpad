/**
 * tmux integration — opt-in session management for remote/unstable networks.
 * Set ENABLE_TMUX=1 to enable.
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { env } from './env';

export const TMUX_SOCKET = path.join(os.tmpdir(), 'super-terminal-tmux');

let _tmuxAvailable = false;
const _tmuxRequested = env.ENABLE_TMUX;

if (_tmuxRequested) {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    _tmuxAvailable = true;
    console.log(`[tmux] Enabled — socket: ${TMUX_SOCKET}`);
  } catch {
    console.log('[tmux] Requested but not found — falling back to direct PTY');
  }
} else {
  console.log('[tmux] Disabled (set ENABLE_TMUX=1 to enable)');
}

export const tmuxAvailable = _tmuxAvailable;

export function tmuxExec(args: string[], timeout = 3000): string {
  return execSync(`tmux -S "${TMUX_SOCKET}" ${args.join(' ')}`, {
    encoding: 'utf-8',
    timeout,
  }).trim();
}

export function tmuxSessionExists(name: string): boolean {
  try {
    tmuxExec(['has-session', '-t', name]);
    return true;
  } catch {
    return false;
  }
}

export function tmuxCreateSession(name: string, cwd: string, shell: string): void {
  const safeCwd = fs.existsSync(cwd) ? cwd : env.HOME;
  tmuxExec(['new-session', '-d', '-s', name, '-c', safeCwd, shell]);
  // Hide all tmux chrome — our UI provides its own
  try {
    tmuxExec(['set-option', '-t', name, 'status', 'off']);
  } catch {}
  try {
    tmuxExec(['set-option', '-t', name, 'pane-border-status', 'off']);
  } catch {}
  try {
    tmuxExec(['set-option', '-t', name, 'set-titles', 'off']);
  } catch {}
  // Disable tmux prefix key to avoid capturing user shortcuts
  try {
    tmuxExec(['set-option', '-t', name, 'prefix', 'None']);
  } catch {}
  try {
    tmuxExec(['set-option', '-t', name, 'prefix2', 'None']);
  } catch {}
}

export function tmuxKillSession(name: string): void {
  try {
    tmuxExec(['kill-session', '-t', name]);
  } catch {}
}

export function tmuxGetCwd(name: string): string | null {
  try {
    return tmuxExec(['display-message', '-t', name, '-p', '#{pane_current_path}']);
  } catch {
    return null;
  }
}

export function tmuxGetPanePid(name: string): number | null {
  try {
    const pid = tmuxExec(['display-message', '-t', name, '-p', '#{pane_pid}']);
    return parseInt(pid) || null;
  } catch {
    return null;
  }
}

export function tmuxListSessions(): string[] {
  try {
    const out = tmuxExec(['list-sessions', '-F', '#{session_name}']);
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
