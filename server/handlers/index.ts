/**
 * WebSocket control message dispatch.
 *
 * Aggregates domain-specific handlers and provides the dispatch entry point.
 */

import { WsHandler, WsContext } from './types';
import sessionHandlers from './session';
import gitHandlers from './git';
import gitWorktreeHandlers from './git-worktree';
import fileHandlers from './file';
import claudeHandlers from './claude';

// Re-export types for consumers
export type { WsContext, Session, WsHandler } from './types';

// ─── Merged handler registry ────────────────────────────────────

const handlers: Record<string, WsHandler> = {
  ...sessionHandlers,
  ...gitHandlers,
  ...gitWorktreeHandlers,
  ...fileHandlers,
  ...claudeHandlers,
};

// ─── Public API ─────────────────────────────────────────────────

/** Dispatch a parsed WS message to the appropriate handler */
export function dispatch(ctx: WsContext, parsed: Record<string, unknown>): void {
  const type = parsed.type as string;
  const handler = handlers[type];
  if (handler) {
    handler(ctx, parsed);
  }
}

/** Whether a message type should be logged (skip noisy high-frequency types) */
export function shouldLogMessage(type: string): boolean {
  return type !== 'input' && type !== 'resize' && type !== 'ping';
}
