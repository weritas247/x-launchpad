/**
 * Git worktree handlers: list, add, remove, switch.
 */

import * as fs from 'fs';
import { WebSocket } from 'ws';
import { WsHandler, getSession } from './types';
import * as gitService from '../services/git-service';

const handlers: Record<string, WsHandler> = {
  git_worktree_list(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    try {
      const worktrees = gitService.getWorktreeList(session.cwd);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_worktree_list_data',
          sessionId: id,
          worktrees,
          currentPath: session.cwd,
        })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_worktree_list_data',
          sessionId: id,
          worktrees: [],
          error: String(e),
        })
      );
    }
  },

  git_worktree_add(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const wtPath = parsed.path as string;
    const branch = parsed.branch as string | undefined;
    const createBranch = parsed.createBranch as boolean | undefined;
    const gitRoot = gitService.getGitRoot(session.cwd);
    const addCwd = gitRoot || session.cwd;
    const wtResult = gitService.addWorktree(addCwd, wtPath, branch, createBranch);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'git_worktree_add_ack',
        sessionId: id,
        ...wtResult,
      })
    );
    if (wtResult.ok) {
      const worktrees = gitService.getWorktreeList(session.cwd);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_worktree_list_data',
          sessionId: id,
          worktrees,
          currentPath: session.cwd,
        })
      );
    }
  },

  git_worktree_remove(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const wtPath = parsed.path as string;
    const force = (parsed.force as boolean) || false;
    const wtResult = gitService.removeWorktree(session.cwd, wtPath, force);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'git_worktree_remove_ack',
        sessionId: id,
        path: wtPath,
        ...wtResult,
      })
    );
    if (wtResult.ok) {
      const worktrees = gitService.getWorktreeList(session.cwd);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_worktree_list_data',
          sessionId: id,
          worktrees,
          currentPath: session.cwd,
        })
      );
    }
  },

  git_worktree_switch(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const wtPath = parsed.path as string;
    if (!fs.existsSync(wtPath)) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_worktree_switch_ack',
          sessionId: id,
          ok: false,
          error: 'Path does not exist',
        })
      );
      return;
    }
    session.cwd = wtPath;
    if (session.pty) {
      const escaped = wtPath.replace(/'/g, "'\\''");
      session.pty.write(`cd '${escaped}'\r`);
    }
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'git_worktree_switch_ack',
        sessionId: id,
        ok: true,
        path: wtPath,
      })
    );
    const infoMsg = JSON.stringify({
      type: 'session_info',
      sessionId: id,
      cwd: wtPath,
      ai: session.ai,
    });
    ctx.wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) c.send(infoMsg);
    });
    try {
      const isRepo = gitService.isGitRepo(session.cwd);
      if (isRepo) {
        const files = gitService.getGitStatus(session.cwd);
        const branch = gitService.getCurrentBranch(session.cwd);
        const root = gitService.getGitRoot(session.cwd);
        const upstream = gitService.getUpstreamStatus(session.cwd);
        ctx.wsSend(
          ctx.ws,
          JSON.stringify({
            type: 'git_status_data',
            sessionId: id,
            files,
            branch,
            root,
            isRepo: true,
            upstream,
          })
        );
      }
    } catch {}
    const worktrees = gitService.getWorktreeList(session.cwd);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'git_worktree_list_data',
        sessionId: id,
        worktrees,
        currentPath: session.cwd,
      })
    );
  },
};

export default handlers;
