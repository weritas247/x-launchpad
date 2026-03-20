/**
 * Git operation handlers: graph, status, diff, stage, commit, push, checkout, branch.
 */

import { WsHandler, WsContext, Session, getSession } from './types';
import * as gitService from '../services/git-service';

/** Send refreshed git status to client */
export function sendGitStatus(ctx: WsContext, id: string, session: Session): void {
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

const handlers: Record<string, WsHandler> = {
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
    const result = gitService.gitPull(session.cwd);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_pull_ack', sessionId: id, ...result }));
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
};

export default handlers;
