import { execFileSync } from 'child_process';

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

export function getGitLog(cwd: string, maxCount = 50): CommitEntry[] {
  const raw = execFileSync('git', [
    'log', '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00%b%x01',
    `--max-count=${maxCount}`, '--all',
  ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

  const commits = raw.split('\x01').filter(Boolean).map(record => {
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

  // Fetch per-commit stats separately
  try {
    const statsRaw = execFileSync('git', [
      'log', '--format=%H', '--shortstat', `--max-count=${maxCount}`, '--all',
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

  return commits;
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
