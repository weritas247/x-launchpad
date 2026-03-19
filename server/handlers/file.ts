/**
 * File operation handlers: read, save, create, rename, delete, duplicate, reveal, search, replace.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { WsHandler, getSession } from './types';
import * as gitService from '../services/git-service';

const handlers: Record<string, WsHandler> = {
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
    const resolvedCwd = path.resolve(session.cwd);
    const resolved = path.resolve(resolvedCwd, filePath);
    if (!resolved.startsWith(resolvedCwd + path.sep) && resolved !== resolvedCwd) {
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
};

export default handlers;
