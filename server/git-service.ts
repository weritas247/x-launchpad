import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface CommitEntry {
  hash: string;
  parents: string[];
  refs: string[];
  author: string;
  date: string;
  message: string;
  body: string;
  additions: number;
  deletions: number;
}

export interface FileEntry {
  status: string;
  path: string;
  additions: number;
  deletions: number;
}

export interface BranchEntry {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export function getGitLog(cwd: string, maxCount = 50, skip = 0): { commits: CommitEntry[]; hasMore: boolean } {
  const fetchCount = maxCount + 1;
  const raw = execFileSync('git', [
    'log', '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00%b%x01',
    `--max-count=${fetchCount}`, `--skip=${skip}`, '--topo-order', '--all',
  ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

  const allCommits = raw.split('\x01').filter(Boolean).map(record => {
    const [hash, parentStr, refStr, author, date, message, ...bodyParts] = record.trim().split('\x00');
    return {
      hash,
      parents: parentStr ? parentStr.split(' ') : [],
      refs: refStr ? refStr.split(', ').map(r => r.trim()).filter(Boolean) : [],
      author,
      date,
      message,
      body: bodyParts.join('\x00').trim(),
      additions: 0,
      deletions: 0,
    };
  });

  const hasMore = allCommits.length > maxCount;
  const commits = hasMore ? allCommits.slice(0, maxCount) : allCommits;

  // Fetch per-commit stats separately
  try {
    const statsRaw = execFileSync('git', [
      'log', '--format=%H', '--shortstat', `--max-count=${fetchCount}`, `--skip=${skip}`, '--topo-order', '--all',
    ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

    const statsMap = new Map<string, { additions: number; deletions: number }>();
    let currentHash = '';
    for (const line of statsRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^[0-9a-f]{40}$/.test(trimmed)) {
        currentHash = trimmed;
      } else if (currentHash && /file.* changed/.test(trimmed)) {
        let additions = 0, deletions = 0;
        const addMatch = trimmed.match(/(\d+) insertion/);
        const delMatch = trimmed.match(/(\d+) deletion/);
        if (addMatch) additions = parseInt(addMatch[1]);
        if (delMatch) deletions = parseInt(delMatch[1]);
        statsMap.set(currentHash, { additions, deletions });
        currentHash = '';
      }
    }

    for (const c of commits) {
      const s = statsMap.get(c.hash);
      if (s) { c.additions = s.additions; c.deletions = s.deletions; }
    }
  } catch {
    // stats are optional — if this fails, commits still have 0/0
  }

  return { commits, hasMore };
}

export function getFileList(cwd: string, hash: string): FileEntry[] {
  // Get file status (M/A/D)
  const raw = execFileSync('git', [
    'diff-tree', '--no-commit-id', '--name-status', '-r', hash,
  ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

  const files = raw.split('\n').filter(Boolean).map(line => {
    const [status, ...pathParts] = line.split('\t');
    return { status, path: pathParts.join('\t'), additions: 0, deletions: 0 };
  });

  // Get per-file line stats
  try {
    const numstat = execFileSync('git', [
      'diff-tree', '--no-commit-id', '--numstat', '-r', hash,
    ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

    const statsMap = new Map<string, { additions: number; deletions: number }>();
    for (const line of numstat.split('\n').filter(Boolean)) {
      const [add, del, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      statsMap.set(filePath, {
        additions: add === '-' ? 0 : parseInt(add) || 0,
        deletions: del === '-' ? 0 : parseInt(del) || 0,
      });
    }

    for (const f of files) {
      const s = statsMap.get(f.path);
      if (s) { f.additions = s.additions; f.deletions = s.deletions; }
    }
  } catch {}

  return files;
}

export function getCurrentBranch(cwd: string): string | null {
  let branch = execFileSync('git', ['branch', '--show-current'], {
    cwd, encoding: 'utf-8', timeout: 3000,
  }).trim();
  if (!branch) {
    branch = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim();
  }
  return branch || null;
}

export function getBranchList(cwd: string): BranchEntry[] {
  const raw = execFileSync('git', [
    'branch', '-a', '--format=%(HEAD)%(refname:short)',
  ], { cwd, encoding: 'utf-8', timeout: 3000 }).trim();

  return raw.split('\n').filter(Boolean).map(line => {
    const isCurrent = line.startsWith('*');
    const name = line.slice(1).trim();
    const isRemote = name.startsWith('origin/');
    return { name, isCurrent, isRemote };
  });
}

export function getRemoteUrl(cwd: string, remote = 'origin'): string | null {
  try {
    return execFileSync('git', ['remote', 'get-url', remote], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim() || null;
  } catch {
    return null;
  }
}

// ─── FILE TREE ───────────────────────────────────────────────────
export interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeEntry[];
}

export function getFileTree(dirPath: string, depth = 3): TreeEntry[] {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const IGNORED = new Set(['.git', 'node_modules', '.next', '.nuxt', 'dist', '__pycache__', '.cache', '.DS_Store', 'Thumbs.db']);

  function walk(dir: string, currentDepth: number): TreeEntry[] {
    if (currentDepth > depth) return [];
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return []; }

    const result: TreeEntry[] = [];
    const dirs: TreeEntry[] = [];
    const files: TreeEntry[] = [];

    for (const name of entries) {
      if (IGNORED.has(name)) continue;
      const fullPath = path.join(dir, name);
      const relativePath = path.relative(dirPath, fullPath);
      let stat;
      try { stat = fs.statSync(fullPath); } catch { continue; }

      if (stat.isDirectory()) {
        dirs.push({
          name,
          path: relativePath,
          type: 'directory',
          children: walk(fullPath, currentDepth + 1),
        });
      } else {
        files.push({ name, path: relativePath, type: 'file' });
      }
    }

    // Sort: directories first, then files, both alphabetically
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  }

  return walk(dirPath, 0);
}

// ─── GIT STATUS ──────────────────────────────────────────────────
export interface GitStatusEntry {
  status: string;   // 'M', 'A', 'D', '??', 'R', 'C', 'U', 'MM', etc.
  path: string;
  staged: boolean;
}

export function getGitStatus(cwd: string): GitStatusEntry[] {
  try {
    const raw = execFileSync('git', ['status', '--porcelain', '-u'], {
      cwd, encoding: 'utf-8', timeout: 5000,
    }).trim();
    if (!raw) return [];

    return raw.split('\n').filter(Boolean).map(line => {
      const x = line[0]; // index status
      const y = line[1]; // worktree status
      const filePath = line.slice(3);

      // Determine display status and staged flag
      if (x === '?' && y === '?') {
        return { status: 'U', path: filePath, staged: false }; // Untracked
      }
      if (x !== ' ' && x !== '?') {
        return { status: x, path: filePath, staged: true }; // Staged change
      }
      return { status: y, path: filePath, staged: false }; // Unstaged change
    });
  } catch {
    return [];
  }
}

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd, encoding: 'utf-8', timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

export function getGitDiff(cwd: string, filePath?: string, staged = false): string {
  try {
    const args = ['diff'];
    if (staged) args.push('--cached');
    args.push('--no-color');
    if (filePath) args.push('--', filePath);
    const diff = execFileSync('git', args, {
      cwd, encoding: 'utf-8', timeout: 5000,
    });
    // For untracked files, git diff returns empty — read file directly
    if (!diff && filePath) {
      const content = readFileSync(join(cwd, filePath), 'utf-8');
      const lines = content.split('\n');
      const header = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
      return header + lines.map(l => '+' + l).join('\n');
    }
    return diff;
  } catch {
    return '';
  }
}

export function gitStageFile(cwd: string, filePath: string): boolean {
  try {
    execFileSync('git', ['add', '--', filePath], { cwd, encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function gitUnstageFile(cwd: string, filePath: string): boolean {
  try {
    execFileSync('git', ['reset', 'HEAD', '--', filePath], { cwd, encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function gitStageAll(cwd: string): boolean {
  try {
    execFileSync('git', ['add', '-A'], { cwd, encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function gitUnstageAll(cwd: string): boolean {
  try {
    execFileSync('git', ['reset', 'HEAD'], { cwd, encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function gitDiscard(cwd: string, filePath: string): boolean {
  try {
    execFileSync('git', ['checkout', '--', filePath], { cwd, encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function generateCommitMessage(cwd: string): string {
  try {
    // Get staged diff, fallback to unstaged diff
    let diff = '';
    try {
      diff = execFileSync('git', ['diff', '--cached', '--stat'], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    } catch { /* ignore */ }
    if (!diff) {
      try {
        diff = execFileSync('git', ['diff', '--stat'], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
      } catch { /* ignore */ }
    }
    if (!diff) return 'update files';

    // Parse stat output to generate descriptive message
    const lines = diff.split('\n').filter(l => l.includes('|'));
    const files = lines.map(l => l.trim().split(/\s+\|/)[0].trim());

    if (files.length === 0) return 'update files';
    if (files.length === 1) {
      const name = files[0].split('/').pop() || files[0];
      return `update ${name}`;
    }
    // Find common directory or extension
    const exts = [...new Set(files.map(f => f.split('.').pop()))];
    if (exts.length === 1) return `update ${files.length} ${exts[0]} files`;
    const dirs = [...new Set(files.map(f => f.split('/')[0]))];
    if (dirs.length === 1) return `update ${dirs[0]} (${files.length} files)`;
    return `update ${files.length} files`;
  } catch {
    return 'update files';
  }
}

export function gitPush(cwd: string): { ok: boolean; error?: string } {
  try {
    execFileSync('git', ['push'], { cwd, encoding: 'utf-8', timeout: 30000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message || String(e) };
  }
}

export function gitCommit(cwd: string, message: string): { ok: boolean; error?: string } {
  if (!message.trim()) return { ok: false, error: 'Empty commit message' };
  try {
    execFileSync('git', ['commit', '-m', message], { cwd, encoding: 'utf-8', timeout: 10000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message || String(e) };
  }
}

// ─── FILE OPERATIONS ─────────────────────────────────────────────
export function createFile(cwd: string, filePath: string, isDir: boolean): { ok: boolean; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd))) return { ok: false, error: 'Access denied' };
  try {
    if (isDir) {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, '', 'utf-8');
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

export function renameFile(cwd: string, oldPath: string, newPath: string): { ok: boolean; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullOld = path.resolve(cwd, oldPath);
  const fullNew = path.resolve(cwd, newPath);
  if (!fullOld.startsWith(path.resolve(cwd)) || !fullNew.startsWith(path.resolve(cwd))) return { ok: false, error: 'Access denied' };
  try {
    fs.renameSync(fullOld, fullNew);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

export function deleteFile(cwd: string, filePath: string): { ok: boolean; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd))) return { ok: false, error: 'Access denied' };
  try {
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

export function duplicateFile(cwd: string, filePath: string): { ok: boolean; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd))) return { ok: false, error: 'Access denied' };
  try {
    if (!fs.existsSync(fullPath)) return { ok: false, error: 'File not found' };
    const stat = fs.statSync(fullPath);
    const dir = path.dirname(fullPath);
    const baseName = path.basename(fullPath);

    // Split name and extension (last dot only)
    let nameWithoutExt: string;
    let ext: string;
    if (stat.isDirectory()) {
      nameWithoutExt = baseName;
      ext = '';
    } else {
      const dotIdx = baseName.lastIndexOf('.');
      // Handle dotfiles (.gitignore) and no-extension files (Makefile)
      if (dotIdx <= 0) {
        nameWithoutExt = baseName;
        ext = '';
      } else {
        nameWithoutExt = baseName.slice(0, dotIdx);
        ext = baseName.slice(dotIdx); // includes the dot
      }
    }

    // Find unique name: "name copy.ext", "name copy 2.ext", ...
    let copyPath: string;
    const candidate = `${nameWithoutExt} copy${ext}`;
    copyPath = path.join(dir, candidate);
    if (fs.existsSync(copyPath)) {
      let n = 2;
      while (fs.existsSync(path.join(dir, `${nameWithoutExt} copy ${n}${ext}`))) n++;
      copyPath = path.join(dir, `${nameWithoutExt} copy ${n}${ext}`);
    }

    if (stat.isDirectory()) {
      fs.cpSync(fullPath, copyPath, { recursive: true });
    } else {
      fs.copyFileSync(fullPath, copyPath);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

// ─── FILE READ ───────────────────────────────────────────────────
export function readFileContent(cwd: string, filePath: string): { content?: string; binary?: boolean; isImage?: boolean; imageData?: string; imageMime?: string; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullPath = path.resolve(cwd, filePath);

  // Security: ensure path is within cwd
  if (!fullPath.startsWith(path.resolve(cwd))) {
    return { error: 'Access denied' };
  }

  const imageExts: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  };

  try {
    const stat = fs.statSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mime = imageExts[ext];

    // Image files: return base64 data (up to 5MB for images)
    if (mime) {
      if (stat.size > 5 * 1024 * 1024) return { error: 'Image too large (>5MB)' };
      const buf = fs.readFileSync(fullPath);
      return { binary: true, isImage: true, imageData: buf.toString('base64'), imageMime: mime };
    }

    if (stat.size > 512 * 1024) return { error: 'File too large (>512KB)' };

    const buf = fs.readFileSync(fullPath);
    // Check if binary
    const isBinary = buf.slice(0, 8000).some((b: number) => b === 0);
    if (isBinary) return { binary: true };

    return { content: buf.toString('utf-8') };
  } catch (e: any) {
    return { error: e.message || String(e) };
  }
}

// ─── FILE SEARCH (grep) ──────────────────────────────────────────
export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export function searchInFiles(cwd: string, query: string, opts?: { caseSensitive?: boolean; useRegex?: boolean; include?: string }, maxResults = 100): SearchResult[] {
  if (!query.trim()) return [];
  try {
    const args = ['-rn', '-I', '--max-count=5'];
    if (!opts?.caseSensitive) args.push('-i');
    if (!opts?.useRegex) args.push('-F'); // fixed string (literal)
    // Include patterns
    if (opts?.include) {
      for (const pat of opts.include.split(',').map(s => s.trim()).filter(Boolean)) {
        args.push(`--include=${pat}`);
      }
    } else {
      args.push('--include=*.{js,ts,jsx,tsx,json,css,html,md,py,go,rs,rb,sh,yml,yaml,toml,txt,cfg,conf,env}');
    }
    args.push(query, '.');
    const raw = execFileSync('grep', args, { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: 1024 * 512 }).trim();

    if (!raw) return [];
    const results: SearchResult[] = [];
    for (const line of raw.split('\n')) {
      if (results.length >= maxResults) break;
      // Format: ./path/file:lineNum:text
      const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
      if (match) {
        results.push({ file: match[1], line: parseInt(match[2]), text: match[3].slice(0, 200) });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ─── FILE REPLACE ────────────────────────────────────────────────
export function replaceInFile(cwd: string, filePath: string, query: string, replacement: string, opts?: { caseSensitive?: boolean; useRegex?: boolean }): { ok: boolean; count: number; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd))) return { ok: false, count: 0, error: 'Access denied' };
  try {
    let content = fs.readFileSync(fullPath, 'utf-8');
    const flags = opts?.caseSensitive ? 'g' : 'gi';
    const pattern = opts?.useRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    let count = 0;
    content = content.replace(pattern, () => { count++; return replacement; });
    fs.writeFileSync(fullPath, content, 'utf-8');
    return { ok: true, count };
  } catch (e: any) {
    return { ok: false, count: 0, error: e.message || String(e) };
  }
}

export function replaceInAllFiles(cwd: string, query: string, replacement: string, opts?: { caseSensitive?: boolean; useRegex?: boolean; include?: string }): { ok: boolean; count: number; error?: string } {
  // First find matching files using search
  const results = searchInFiles(cwd, query, opts);
  const files = [...new Set(results.map(r => r.file))];
  let totalCount = 0;
  for (const file of files) {
    const result = replaceInFile(cwd, file, query, replacement, opts);
    if (result.ok) totalCount += result.count;
  }
  return { ok: true, count: totalCount };
}

export function getUpstreamStatus(cwd: string): { ahead: number; behind: number } {
  try {
    const raw = execFileSync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], {
      cwd, encoding: 'utf-8', timeout: 3000,
    }).trim();
    const [ahead, behind] = raw.split(/\s+/).map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

export function getGitRoot(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf-8', timeout: 2000,
    }).trim() || null;
  } catch {
    return null;
  }
}

// ─── GIT WORKTREE ────────────────────────────────────────────────
export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  isBare: boolean;
}

export function getWorktreeList(cwd: string): WorktreeEntry[] {
  try {
    const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd, encoding: 'utf-8', timeout: 5000,
    }).trim();
    if (!raw) return [];

    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) entries.push(current as WorktreeEntry);
        current = { path: line.slice(9), branch: '', head: '', isMain: false, isBare: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5, 12);
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.isBare = true;
      } else if (line === 'detached') {
        current.branch = current.head || '(detached)';
      }
    }
    if (current.path) entries.push(current as WorktreeEntry);

    if (entries.length > 0) entries[0].isMain = true;

    return entries;
  } catch {
    return [];
  }
}

export function addWorktree(cwd: string, wtPath: string, branch?: string, createBranch?: boolean): { ok: boolean; error?: string } {
  try {
    const args = ['worktree', 'add'];
    if (createBranch && branch) {
      args.push('-b', branch, wtPath);
    } else if (branch) {
      args.push(wtPath, branch);
    } else {
      args.push(wtPath);
    }
    execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message || String(e) };
  }
}

export function removeWorktree(cwd: string, wtPath: string, force?: boolean): { ok: boolean; error?: string } {
  try {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(wtPath);
    execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message || String(e) };
  }
}
