/**
 * WebSocket control message dispatch map.
 *
 * Replaces the monolithic if-else chain with a typed handler registry.
 * Each handler receives a context object with shared server state.
 */

import { WebSocket, WebSocketServer } from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import * as gitService from './git-service';
import { getClaudeUsage, getClaudePrompts } from './claude-service';
import { runCmdWhenReady, sendWhenAiReady } from './pty-utils';
import { tmuxKillSession } from './tmux';
import { AppSettings } from './config';
import { env } from './env';

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

type WsHandler = (ctx: WsContext, parsed: Record<string, unknown>) => void | Promise<void>;

// ─── Helpers ────────────────────────────────────────────────────

/** Resolve session ID from message or current attachment */
function resolveSessionId(ctx: WsContext, parsed: Record<string, unknown>): string | undefined {
  return (parsed.sessionId as string) || ctx.wsSession.get(ctx.ws);
}

/** Get session by ID, returning undefined if not found */
function getSession(
  ctx: WsContext,
  parsed: Record<string, unknown>
): { id: string; session: Session } | undefined {
  const id = resolveSessionId(ctx, parsed);
  if (!id) return undefined;
  const session = ctx.sessions.get(id);
  if (!session) return undefined;
  return { id, session };
}

/** Send refreshed git status to client */
function sendGitStatus(ctx: WsContext, id: string, session: Session): void {
  const files = gitService.getGitStatus(session.cwd);
  const branch = gitService.getCurrentBranch(session.cwd);
  const root = gitService.getGitRoot(session.cwd);
  ctx.wsSend(
    ctx.ws,
    JSON.stringify({
      type: 'git_status_data',
      sessionId: id,
      files,
      branch,
      root,
      isRepo: true,
    })
  );
}

// ─── Handler registry ───────────────────────────────────────────

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
    const extraEnv = planId ? { SUPER_TERMINAL_PLAN_ID: planId } : undefined;
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

  git_graph(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const skip = typeof parsed.skip === 'number' ? parsed.skip : 0;
    try {
      const { commits, hasMore } = gitService.getGitLog(session.cwd, 50, skip);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_graph_data',
          sessionId: id,
          commits,
          hasMore,
          skip,
        })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_graph_data',
          sessionId: id,
          commits: [],
          hasMore: false,
          skip,
          error: String(e),
        })
      );
    }
  },

  git_graph_search(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const query = typeof parsed.query === 'string' ? parsed.query : '';
    try {
      const commits = gitService.searchGitLog(session.cwd, query);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_graph_search_data',
          sessionId: id,
          commits,
          query,
        })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_graph_search_data',
          sessionId: id,
          commits: [],
          query,
          error: String(e),
        })
      );
    }
  },

  git_file_list(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const hash = parsed.hash as string;
    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_file_list_data',
          hash,
          files: [],
          error: 'Invalid hash',
        })
      );
      return;
    }
    try {
      const files = gitService.getFileList(session.cwd, hash);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({ type: 'git_file_list_data', sessionId: id, hash, files })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_file_list_data',
          sessionId: id,
          hash,
          files: [],
          error: String(e),
        })
      );
    }
  },

  git_branch(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    try {
      const branch = gitService.getCurrentBranch(session.cwd);
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_branch_data', sessionId: id, branch }));
    } catch {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_branch_data', sessionId: id, branch: null }));
    }
  },

  git_branch_list(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    try {
      const branches = gitService.getBranchList(session.cwd);
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_branch_list_data',
          sessionId: id,
          branches,
        })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_branch_list_data',
          sessionId: id,
          branches: [],
          error: String(e),
        })
      );
    }
  },

  git_remote_url(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const url = gitService.getRemoteUrl(session.cwd);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_remote_url_data', sessionId: id, url }));
  },

  git_checkout(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const branch = parsed.branch as string;
    if (!branch || !/^[a-zA-Z0-9][a-zA-Z0-9/_.\\-]*$/.test(branch)) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_checkout_ack',
          sessionId: id,
          error: 'Invalid branch name',
        })
      );
      return;
    }
    let cmd: string;
    if (branch.startsWith('origin/')) {
      const localName = branch.slice(7);
      cmd = `git checkout -b ${localName} --track ${branch}`;
    } else {
      cmd = `git checkout ${branch}`;
    }
    session.pty.write(cmd + '\r');
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_checkout_ack', sessionId: id, branch }));
  },

  git_pull(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    session.pty.write('git pull\r');
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_pull_ack', sessionId: id }));
  },

  file_tree(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const targetDir = (parsed.dir as string) || session.cwd;
    try {
      const tree = gitService.getFileTree(targetDir);
      const gitStatusMap: Record<string, string> = {};
      if (gitService.isGitRepo(targetDir)) {
        const files = gitService.getGitStatus(targetDir);
        for (const f of files) {
          gitStatusMap[f.path] = f.status;
        }
      }
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'file_tree_data',
          sessionId: id,
          dir: targetDir,
          tree,
          gitStatus: gitStatusMap,
        })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'file_tree_data',
          sessionId: id,
          dir: targetDir,
          tree: [],
          error: String(e),
        })
      );
    }
  },

  git_status(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    try {
      const isRepo = gitService.isGitRepo(session.cwd);
      if (!isRepo) {
        ctx.wsSend(
          ctx.ws,
          JSON.stringify({
            type: 'git_status_data',
            sessionId: id,
            files: [],
            isRepo: false,
          })
        );
        return;
      }
      const files = gitService.getGitStatus(session.cwd);
      const branch = gitService.getCurrentBranch(session.cwd);
      const root = gitService.getGitRoot(session.cwd);
      const upstream = gitService.getUpstreamStatus(session.cwd);
      const worktrees = gitService.getWorktreeList(session.cwd);
      const normalizedCwd = session.cwd.replace(/\/+$/, '');
      const mainWt = worktrees.find((w) => w.isMain);
      const isInWorktree = mainWt ? normalizedCwd !== mainWt.path.replace(/\/+$/, '') : false;
      let mainBranchFileCount: number | undefined;
      if (isInWorktree && mainWt) {
        try {
          const mainFiles = gitService.getGitStatus(mainWt.path);
          mainBranchFileCount = mainFiles.length;
        } catch {}
      }
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
          worktrees,
          isInWorktree,
          mainBranchFileCount,
        })
      );
    } catch (e) {
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({
          type: 'git_status_data',
          sessionId: id,
          files: [],
          error: String(e),
          isRepo: false,
        })
      );
    }
  },

  git_diff(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string | undefined;
    const staged = (parsed.staged as boolean) || false;
    const diff = gitService.getGitDiff(session.cwd, filePath, staged);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'git_diff_data',
        sessionId: id,
        filePath,
        staged,
        diff,
      })
    );
  },

  git_stage(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const all = (parsed.all as boolean) || false;
    const ok = all
      ? gitService.gitStageAll(session.cwd)
      : gitService.gitStageFile(session.cwd, filePath);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_stage_ack', sessionId: id, ok }));
    if (ok) sendGitStatus(ctx, id, session);
  },

  git_unstage(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const all = (parsed.all as boolean) || false;
    const ok = all
      ? gitService.gitUnstageAll(session.cwd)
      : gitService.gitUnstageFile(session.cwd, filePath);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_unstage_ack', sessionId: id, ok }));
    if (ok) sendGitStatus(ctx, id, session);
  },

  git_commit(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const message = parsed.message as string;
    const result = gitService.gitCommit(session.cwd, message);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_commit_ack', sessionId: id, ...result }));
    if (result.ok) {
      sendGitStatus(ctx, id, session);
      if (parsed.push) {
        const pushResult = gitService.gitPush(session.cwd);
        ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_push_ack', sessionId: id, ...pushResult }));
      }
    }
  },

  file_create(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.createFile(
      session.cwd,
      parsed.filePath as string,
      parsed.isDir as boolean
    );
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'file_op_ack',
        sessionId: id,
        op: 'create',
        ...result,
      })
    );
  },

  file_rename(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.renameFile(
      session.cwd,
      parsed.oldPath as string,
      parsed.newPath as string
    );
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'file_op_ack',
        sessionId: id,
        op: 'rename',
        ...result,
      })
    );
  },

  file_delete(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.deleteFile(session.cwd, parsed.filePath as string);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'file_op_ack',
        sessionId: id,
        op: 'delete',
        ...result,
      })
    );
  },

  file_duplicate(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.duplicateFile(session.cwd, parsed.filePath as string);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'file_op_ack',
        sessionId: id,
        op: 'duplicate',
        ...result,
      })
    );
  },

  file_reveal(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    if (!filePath) return;
    const fullPath = path.resolve(session.cwd, filePath);
    const resolvedCwd = path.resolve(session.cwd);
    if (!fullPath.startsWith(resolvedCwd + path.sep) && fullPath !== resolvedCwd) return;
    execFile('open', ['-R', fullPath], (err) => {
      if (err)
        ctx.wsSend(
          ctx.ws,
          JSON.stringify({
            type: 'file_op_ack',
            sessionId: id,
            op: 'reveal',
            ok: false,
            error: err.message,
          })
        );
    });
  },

  file_read(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const result = gitService.readFileContent(session.cwd, filePath);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'file_read_data',
        sessionId: id,
        filePath,
        ...result,
      })
    );
  },

  file_save(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const content = parsed.content as string;

    if (!filePath || typeof content !== 'string') {
      ctx.wsSend(ctx.ws, JSON.stringify({
        type: 'file_save_result',
        sessionId: id,
        filePath,
        success: false,
        error: 'Missing filePath or content',
      }));
      return;
    }

    // Path traversal protection
    const resolved = path.resolve(session.cwd, filePath);
    if (!resolved.startsWith(session.cwd + path.sep) && resolved !== session.cwd) {
      ctx.wsSend(ctx.ws, JSON.stringify({
        type: 'file_save_result',
        sessionId: id,
        filePath,
        success: false,
        error: 'Access denied: path outside project',
      }));
      return;
    }

    try {
      fs.writeFileSync(resolved, content, 'utf-8');
      ctx.wsSend(ctx.ws, JSON.stringify({
        type: 'file_save_result',
        sessionId: id,
        filePath,
        success: true,
      }));
    } catch (err: any) {
      ctx.wsSend(ctx.ws, JSON.stringify({
        type: 'file_save_result',
        sessionId: id,
        filePath,
        success: false,
        error: err.message,
      }));
    }
  },

  file_search(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const query = parsed.query as string;
    const results = gitService.searchInFiles(session.cwd, query, {
      caseSensitive: parsed.caseSensitive as boolean,
      useRegex: parsed.useRegex as boolean,
      include: parsed.include as string,
    });
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'file_search_data', sessionId: id, results }));
  },

  file_replace(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.replaceInFile(
      session.cwd,
      parsed.filePath as string,
      parsed.query as string,
      parsed.replacement as string,
      {
        caseSensitive: parsed.caseSensitive as boolean,
        useRegex: parsed.useRegex as boolean,
      }
    );
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'file_replace_ack', sessionId: id, ...result }));
  },

  file_replace_all(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.replaceInAllFiles(
      session.cwd,
      parsed.query as string,
      parsed.replacement as string,
      {
        caseSensitive: parsed.caseSensitive as boolean,
        useRegex: parsed.useRegex as boolean,
        include: parsed.include as string,
      }
    );
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'file_replace_ack', sessionId: id, ...result }));
  },

  git_generate_message(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const message = gitService.generateCommitMessage(session.cwd);
    ctx.wsSend(
      ctx.ws,
      JSON.stringify({
        type: 'git_generate_message_data',
        sessionId: id,
        message,
      })
    );
  },

  git_discard(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const ok = gitService.gitDiscard(session.cwd, filePath);
    if (ok) sendGitStatus(ctx, id, session);
  },

  git_push(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.gitPush(session.cwd);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_push_ack', sessionId: id, ...result }));
  },

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

  claude_usage(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const usage = getClaudeUsage(session.cwd);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'claude_usage_data', sessionId: id, usage }));
  },

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
