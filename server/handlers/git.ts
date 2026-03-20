/**
 * Git operation handlers: graph, status, diff, stage, commit, push, checkout, branch.
 */

import { WsHandler, WsContext, Session, getSession } from './types';
import * as gitService from '../services/git-service';

/** Send refreshed git status to client */
export async function sendGitStatus(ctx: WsContext, id: string, session: Session): Promise<void> {
  const [files, branch, root] = await Promise.all([
    gitService.getGitStatusAsync(session.cwd),
    gitService.getCurrentBranchAsync(session.cwd),
    gitService.getGitRootAsync(session.cwd),
  ]);
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
      let detail: ReturnType<typeof gitService.getCommitDetail> | undefined;
      try { detail = gitService.getCommitDetail(session.cwd, hash); } catch {}
      ctx.wsSend(
        ctx.ws,
        JSON.stringify({ type: 'git_file_list_data', sessionId: id, hash, files, detail })
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

  async git_branch(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const branch = await gitService.getCurrentBranchAsync(session.cwd);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_branch_data', sessionId: id, branch }));
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

  async git_status(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    try {
      const isRepo = await gitService.isGitRepoAsync(session.cwd);
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
      const [files, branch, root, upstream, worktrees] = await Promise.all([
        gitService.getGitStatusAsync(session.cwd),
        gitService.getCurrentBranchAsync(session.cwd),
        gitService.getGitRootAsync(session.cwd),
        gitService.getUpstreamStatusAsync(session.cwd),
        gitService.getWorktreeListAsync(session.cwd),
      ]);
      const normalizedCwd = session.cwd.replace(/\/+$/, '');
      const mainWt = worktrees.find((w) => w.isMain);
      const isInWorktree = mainWt ? normalizedCwd !== mainWt.path.replace(/\/+$/, '') : false;
      let mainBranchFileCount: number | undefined;
      if (isInWorktree && mainWt) {
        const mainFiles = await gitService.getGitStatusAsync(mainWt.path);
        mainBranchFileCount = mainFiles.length;
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

  async git_stage(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const all = (parsed.all as boolean) || false;
    const ok = all
      ? gitService.gitStageAll(session.cwd)
      : gitService.gitStageFile(session.cwd, filePath);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_stage_ack', sessionId: id, ok }));
    if (ok) await sendGitStatus(ctx, id, session);
  },

  async git_unstage(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const all = (parsed.all as boolean) || false;
    const ok = all
      ? gitService.gitUnstageAll(session.cwd)
      : gitService.gitUnstageFile(session.cwd, filePath);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_unstage_ack', sessionId: id, ok }));
    if (ok) await sendGitStatus(ctx, id, session);
  },

  async git_commit(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const message = parsed.message as string;
    const result = gitService.gitCommit(session.cwd, message);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_commit_ack', sessionId: id, ...result }));
    if (result.ok) {
      await sendGitStatus(ctx, id, session);
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

  async git_discard(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const filePath = parsed.filePath as string;
    const ok = gitService.gitDiscard(session.cwd, filePath);
    if (ok) await sendGitStatus(ctx, id, session);
  },

  git_push(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const result = gitService.gitPush(session.cwd);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_push_ack', sessionId: id, ...result }));
  },

  // PTY-based commit operations (hash validated, run in terminal)
  git_pty_op(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const op = parsed.op as string;
    const hash = parsed.hash as string;

    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_pty_op_ack', sessionId: id, error: 'Invalid hash' }));
      return;
    }

    const ALLOWED_OPS: Record<string, (h: string, extra?: string) => string> = {
      cherry_pick:       (h) => `git cherry-pick ${h}`,
      revert:            (h) => `git revert --no-edit ${h}`,
      reset_soft:        (h) => `git reset --soft ${h}`,
      reset_mixed:       (h) => `git reset ${h}`,
      reset_hard:        (h) => `git reset --hard ${h}`,
      merge:             (h) => `git merge ${h}`,
      rebase:            (h) => `git rebase ${h}`,
      checkout_detached: (h) => `git checkout ${h}`,
    };

    const builder = ALLOWED_OPS[op];
    if (!builder) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_pty_op_ack', sessionId: id, error: 'Unknown op' }));
      return;
    }

    const cmd = builder(hash);
    session.pty.write(cmd + '\r');
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_pty_op_ack', sessionId: id, op, hash }));
  },

  git_tag_create(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const hash = parsed.hash as string;
    const name = parsed.name as string;
    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_tag_create_ack', sessionId: id, error: 'Invalid hash' }));
      return;
    }
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(name)) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_tag_create_ack', sessionId: id, error: 'Invalid tag name' }));
      return;
    }
    session.pty.write(`git tag ${name} ${hash}\r`);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_tag_create_ack', sessionId: id, name, hash }));
  },

  git_branch_create(ctx, parsed) {
    const r = getSession(ctx, parsed);
    if (!r) return;
    const { id, session } = r;
    const hash = parsed.hash as string;
    const name = parsed.name as string;
    if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_branch_create_ack', sessionId: id, error: 'Invalid hash' }));
      return;
    }
    if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9/_.\\-]*$/.test(name)) {
      ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_branch_create_ack', sessionId: id, error: 'Invalid branch name' }));
      return;
    }
    session.pty.write(`git checkout -b ${name} ${hash}\r`);
    ctx.wsSend(ctx.ws, JSON.stringify({ type: 'git_branch_create_ack', sessionId: id, name, hash }));
  },
};

export default handlers;
