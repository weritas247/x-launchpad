/**
 * Claude usage and prompt handlers.
 */

import { WsHandler, getSession } from './types';
import { getClaudePrompts } from '../services/claude-service';

const handlers: Record<string, WsHandler> = {
  claude_prompts(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    console.log(`[claude_prompts] cwd=${session.cwd} aiPid=${session.aiPid}`);
    const prompts = getClaudePrompts(session.cwd, session.aiPid);
    console.log(`[claude_prompts] found ${prompts.length} prompts`);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'claude_prompts_data', sessionId: id, prompts }));
  },

};

export default handlers;
