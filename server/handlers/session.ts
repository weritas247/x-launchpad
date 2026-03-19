/**
 * Session lifecycle handlers: create, close, rename, attach, subscribe, duplicate.
 * Also: ping, input, send_when_ready, resize.
 */

import { WebSocket } from 'ws';
import { WsHandler, WsContext, getSession } from './types';
import { runCmdWhenReady, sendWhenAiReady } from '../pty-utils';
import { tmuxKillSession } from '../tmux';
import { env } from '../env';

const handlers: Record<string, WsHandler> = {
  ping(ctx, parsed) {
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'pong', t: parsed.t }));
  },

  session_create(ctx, parsed) {
    const id = `session-${Date.now()}`;
    const nameFormat = ctx.currentSettings.shell.sessionNameFormat || 'shell-{n}';
    const name =
      (parsed.name as string) || nameFormat.replace('{n}', String(ctx.sessions.size + 1));
    const planId = parsed.planId as string | undefined;
    const extraEnv = planId ? { X_LAUNCHPAD_PLAN_ID: planId } : undefined;
    const sess = ctx.createSession(id, name, parsed.cwd as string | undefined, undefined, extraEnv);
    ctx.wsSession.set(ctx.ws, id);
    if (parsed.cmd) {
      sess.cmd = parsed.cmd as string;
      runCmdWhenReady(sess, sess.cmd);
    }
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'session_created', sessionId: id, name }));
    ctx.broadcastSessionList();
  },

  session_subscribe(ctx, parsed) {
    const ids = parsed.sessionIds as string[];
    if (Array.isArray(ids)) {
      ctx.wsSubscriptions.set(ctx.ws, new Set(ids.filter((id) => ctx.sessions.has(id))));
    }
  },

  session_duplicate(ctx, parsed) {
    const sourceId = parsed.sourceSessionId as string;
    const source = ctx.sessions.get(sourceId);
    const id = `session-${Date.now()}`;
    const name = (parsed.name as string) || 'Shell';
    const cwd = source?.cwd || ctx.currentSettings.shell.startDirectory || env.HOME;
    ctx.createSession(id, name, cwd);
    ctx.wsSession.set(ctx.ws, id);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'session_created', sessionId: id, name }));
    ctx.broadcastSessionList();
  },

  session_attach(ctx, parsed) {
    const id = parsed.sessionId as string;
    if (!ctx.sessions.has(id)) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'error', message: `Session ${id} not found` }));
      return;
    }
    ctx.wsSession.set(ctx.ws, id);
    ctx.wsSubscriptions.get(ctx.ws)?.delete(id);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'session_attached', sessionId: id }));
    const sess = ctx.sessions.get(id)!;
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'session_info',
        sessionId: id,
        cwd: sess.cwd,
        ai: sess.ai,
      })
    );
  },

  session_rename(ctx, parsed) {
    const id = parsed.sessionId as string;
    const session = ctx.sessions.get(id);
    if (session) {
      session.name = (parsed.name as string) || session.name;
      ctx.broadcastSessionList();
    }
  },

  session_close(ctx, parsed) {
    const id = parsed.sessionId as string;
    const session = ctx.sessions.get(id);
    if (session) {
      if (session.cwdTimer) clearInterval(session.cwdTimer);
      session.pty.kill();
      if (session.tmuxName) tmuxKillSession(session.tmuxName);
      const dataClients = ctx.dataWsMap.get(id);
      if (dataClients) {
        dataClients.forEach((dws) => dws.close(1000, 'Session closed'));
        ctx.dataWsMap.delete(id);
      }
      ctx.sessions.delete(id);
      ctx.broadcastSessionList();
    }
  },

  input(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (r) r.session.pty.write(parsed.data as string);
  },

  send_when_ready(ctx, parsed) {
    const id = parsed.sessionId as string;
    const text = parsed.data as string;
    if (!id || !text) return;
    const session = ctx.sessions.get(id);
    if (!session) return;
    sendWhenAiReady(session, text, ctx.ws, ctx.wsSend);
  },

  resize(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { session } = r;
    session.pty.resize(parsed.cols as number, parsed.rows as number);
    if (session.pendingCmd && !session.resized) {
      session.resized = true;
      const cmd = session.pendingCmd;
      session.pendingCmd = undefined;
      console.log(
        `[session] Running '${cmd}' in '${session.name}' after resize to ${parsed.cols}x${parsed.rows}`
      );
      runCmdWhenReady(session, cmd);
    }
  },
};

export default handlers;
