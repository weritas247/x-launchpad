/**
 * Shared types and helpers for WebSocket handlers.
 */

import { WebSocket, WebSocketServer } from 'ws';
import { AppSettings } from '../config';

// ─── Types ──────────────────────────────────────────────────────

/** Shared server state passed to every handler */
export interface WsContext {
  ws: WebSocket;
  wss: WebSocketServer;
  sessions: Map<string, Session>;
  wsSession: Map<WebSocket, string>;
  wsSubscriptions: Map<WebSocket, Set<string>>;
  dataWsMap: Map<string, Set<WebSocket>>;
  currentSettings: AppSettings;
  createSession: (
    id: string,
    name: string,
    restoreCwd?: string,
    restoreCmd?: string,
    extraEnv?: Record<string, string>
  ) => Session;
  broadcastSessionList: (exclude?: WebSocket) => void;
  wsSend: (ws: WebSocket, data: string) => void;
}

export interface Session {
  id: string;
  name: string;
  pty: {
    write: (data: string) => void;
    kill: () => void;
    resize: (cols: number, rows: number) => void;
    onData: (cb: (data: string) => void) => { dispose: () => void };
    pid: number;
  };
  createdAt: number;
  cwd: string;
  ai: string | null;
  aiPid: number | null;
  cmd?: string;
  cwdTimer?: ReturnType<typeof setInterval>;
  pendingCmd?: string;
  resized?: boolean;
  scrollback: string;
  tmuxName?: string;
}

export type WsHandler = (ctx: WsContext, parsed: Record<string, unknown>) => void | Promise<void>;

// ─── Helpers ────────────────────────────────────────────────────

/** Resolve session ID from message or current attachment */
export function resolveSessionId(ctx: WsContext, parsed: Record<string, unknown>): string | undefined {
  return (parsed.sessionId as string) || ctx.wsSession.get(ctx.ws);
}

/** Get session by ID, returning undefined if not found */
export function getSession(
  ctx: WsContext,
  parsed: Record<string, unknown>
): { id: string; session: Session } | undefined {
  const id = resolveSessionId(ctx, parsed);
  if (!id) return undefined;
  const session = ctx.sessions.get(id);
  if (!session) return undefined;
  return { id, session };
}
