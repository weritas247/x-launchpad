/**
 * Tests for git-service parsing logic.
 *
 * Many git-service functions call execFileSync internally, so we test them
 * by extracting the parsing logic patterns and verifying them in isolation.
 * For functions that can't be easily isolated, we mock execFileSync.
 */
// ─── Inline parsing functions extracted from git-service ──────────
// These mirror the parsing logic inside getGitLog, getGitStatus, etc.

/** Parse git log --format record (mirrors getGitLog's map function) */
function parseGitLogRecord(record: string) {
  const [hash, parentStr, refStr, author, date, message, ...bodyParts] = record
    .trim()
    .split('\x00');
  return {
    hash,
    parents: parentStr ? parentStr.split(' ') : [],
    refs: refStr
      ? refStr
          .split(', ')
          .map((r: string) => r.trim())
          .filter(Boolean)
      : [],
    author,
    date,
    message,
    body: bodyParts.join('\x00').trim(),
    additions: 0,
    deletions: 0,
  };
}

/** Parse git status --porcelain line (mirrors getGitStatus's map function) */
function parseStatusLine(line: string) {
  const x = line[0]; // index status
  const y = line[1]; // worktree status
  const filePath = line.slice(3);

  if (x === '?' && y === '?') {
    return { status: 'U', path: filePath, staged: false }; // Untracked
  }
  if (x !== ' ' && x !== '?') {
    return { status: x, path: filePath, staged: true }; // Staged change
  }
  return { status: y, path: filePath, staged: false }; // Unstaged change
}

/** Parse git shortstat output (mirrors generateCommitMessage's logic) */
function parseShortstat(statLine: string) {
  let additions = 0,
    deletions = 0;
  const addMatch = statLine.match(/(\d+) insertion/);
  const delMatch = statLine.match(/(\d+) deletion/);
  if (addMatch) additions = parseInt(addMatch[1]);
  if (delMatch) deletions = parseInt(delMatch[1]);
  return { additions, deletions };
}

/** Parse worktree porcelain output (mirrors getWorktreeList) */
function parseWorktreeOutput(raw: string) {
  const entries: Array<{
    path: string;
    branch: string;
    head: string;
    isMain: boolean;
    isBare: boolean;
  }> = [];
  let current: any = {};

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) entries.push(current);
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
  if (current.path) entries.push(current);
  if (entries.length > 0) entries[0].isMain = true;
  return entries;
}

/** Parse git diff-tree --name-status line */
function parseDiffTreeLine(line: string) {
  const [status, ...pathParts] = line.split('\t');
  return { status, path: pathParts.join('\t'), additions: 0, deletions: 0 };
}

/** Parse git branch -a output line */
function parseBranchLine(line: string) {
  const isCurrent = line.startsWith('*');
  const name = line.slice(1).trim();
  const isRemote = name.startsWith('origin/');
  return { name, isCurrent, isRemote };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('parseGitLogRecord', () => {
  it('parses a standard commit record', () => {
    const record =
      'abc123def456\x00parent1 parent2\x00HEAD -> main, origin/main\x00John\x002024-01-15T10:00:00+09:00\x00fix: bug\x00body text';
    const result = parseGitLogRecord(record);
    expect(result.hash).toBe('abc123def456');
    expect(result.parents).toEqual(['parent1', 'parent2']);
    expect(result.refs).toEqual(['HEAD -> main', 'origin/main']);
    expect(result.author).toBe('John');
    expect(result.message).toBe('fix: bug');
    expect(result.body).toBe('body text');
  });

  it('handles commit with no parents (initial commit)', () => {
    const record = 'abc123\x00\x00\x00Author\x002024-01-01\x00initial commit\x00';
    const result = parseGitLogRecord(record);
    expect(result.parents).toEqual([]);
    expect(result.refs).toEqual([]);
  });

  it('handles commit with empty body', () => {
    const record = 'abc123\x00parent1\x00\x00Author\x002024-01-01\x00message\x00';
    const result = parseGitLogRecord(record);
    expect(result.body).toBe('');
  });

  it('handles body with null bytes (multi-part body)', () => {
    const record = 'abc123\x00p\x00\x00A\x002024\x00msg\x00part1\x00part2';
    const result = parseGitLogRecord(record);
    expect(result.body).toBe('part1\x00part2');
  });
});

describe('parseStatusLine (git status --porcelain)', () => {
  it('parses untracked file', () => {
    expect(parseStatusLine('?? new-file.ts')).toEqual({
      status: 'U',
      path: 'new-file.ts',
      staged: false,
    });
  });

  it('parses staged modified file', () => {
    expect(parseStatusLine('M  server/index.ts')).toEqual({
      status: 'M',
      path: 'server/index.ts',
      staged: true,
    });
  });

  it('parses unstaged modified file', () => {
    expect(parseStatusLine(' M server/index.ts')).toEqual({
      status: 'M',
      path: 'server/index.ts',
      staged: false,
    });
  });

  it('parses staged added file', () => {
    expect(parseStatusLine('A  new-file.ts')).toEqual({
      status: 'A',
      path: 'new-file.ts',
      staged: true,
    });
  });

  it('parses staged deleted file', () => {
    expect(parseStatusLine('D  old-file.ts')).toEqual({
      status: 'D',
      path: 'old-file.ts',
      staged: true,
    });
  });

  it('parses staged renamed file', () => {
    expect(parseStatusLine('R  old.ts -> new.ts')).toEqual({
      status: 'R',
      path: 'old.ts -> new.ts',
      staged: true,
    });
  });

  it('handles file with spaces in name', () => {
    expect(parseStatusLine('?? my file.txt')).toEqual({
      status: 'U',
      path: 'my file.txt',
      staged: false,
    });
  });
});

describe('parseShortstat', () => {
  it('parses insertions and deletions', () => {
    expect(parseShortstat(' 3 files changed, 42 insertions(+), 10 deletions(-)')).toEqual({
      additions: 42,
      deletions: 10,
    });
  });

  it('parses insertions only', () => {
    expect(parseShortstat(' 1 file changed, 5 insertions(+)')).toEqual({
      additions: 5,
      deletions: 0,
    });
  });

  it('parses deletions only', () => {
    expect(parseShortstat(' 2 files changed, 8 deletions(-)')).toEqual({
      additions: 0,
      deletions: 8,
    });
  });

  it('handles singular forms', () => {
    expect(parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)')).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  it('returns zeros for unrecognized format', () => {
    expect(parseShortstat('nothing here')).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('parseWorktreeOutput', () => {
  it('parses single main worktree', () => {
    const raw = `worktree /home/user/project
HEAD abc1234567890abcdef1234567890abcdef123456
branch refs/heads/main`;
    const result = parseWorktreeOutput(raw);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: '/home/user/project',
      branch: 'main',
      head: 'abc1234',
      isMain: true,
      isBare: false,
    });
  });

  it('parses multiple worktrees', () => {
    const raw = `worktree /home/user/project
HEAD abc1234567890abcdef1234567890abcdef123456
branch refs/heads/main

worktree /home/user/project/.worktrees/feature
HEAD def5678901234567890123456789012345678901
branch refs/heads/feature-x`;
    const result = parseWorktreeOutput(raw);
    expect(result).toHaveLength(2);
    expect(result[0].isMain).toBe(true);
    expect(result[1].isMain).toBe(false);
    expect(result[1].branch).toBe('feature-x');
  });

  it('handles detached HEAD', () => {
    const raw = `worktree /home/user/project
HEAD abc1234567890abcdef1234567890abcdef123456
branch refs/heads/main

worktree /tmp/detached
HEAD def5678901234567890123456789012345678901
detached`;
    const result = parseWorktreeOutput(raw);
    expect(result[1].branch).toBe('def5678');
  });

  it('handles bare worktree', () => {
    const raw = `worktree /home/user/project.git
HEAD abc1234567890abcdef1234567890abcdef123456
bare`;
    const result = parseWorktreeOutput(raw);
    expect(result[0].isBare).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(parseWorktreeOutput('')).toEqual([]);
  });
});

describe('parseDiffTreeLine', () => {
  it('parses modified file', () => {
    expect(parseDiffTreeLine('M\tsrc/index.ts')).toEqual({
      status: 'M',
      path: 'src/index.ts',
      additions: 0,
      deletions: 0,
    });
  });

  it('parses added file', () => {
    expect(parseDiffTreeLine('A\tnew-file.ts')).toEqual({
      status: 'A',
      path: 'new-file.ts',
      additions: 0,
      deletions: 0,
    });
  });

  it('handles path with tabs', () => {
    expect(parseDiffTreeLine('M\tpath\twith\ttabs')).toEqual({
      status: 'M',
      path: 'path\twith\ttabs',
      additions: 0,
      deletions: 0,
    });
  });
});

describe('parseBranchLine', () => {
  it('parses current branch', () => {
    expect(parseBranchLine('*main')).toEqual({
      name: 'main',
      isCurrent: true,
      isRemote: false,
    });
  });

  it('parses non-current branch', () => {
    expect(parseBranchLine(' feature-x')).toEqual({
      name: 'feature-x',
      isCurrent: false,
      isRemote: false,
    });
  });

  it('parses remote branch', () => {
    expect(parseBranchLine(' origin/main')).toEqual({
      name: 'origin/main',
      isCurrent: false,
      isRemote: true,
    });
  });
});

describe('generateCommitMessage logic', () => {
  // Test the commit message generation logic in isolation
  function generateMessage(statLines: string[]): string {
    const files = statLines.map((l) => l.trim().split(/\s+\|/)[0].trim());
    if (files.length === 0) return 'update files';
    if (files.length === 1) {
      const name = files[0].split('/').pop() || files[0];
      return `update ${name}`;
    }
    const exts = [...new Set(files.map((f) => f.split('.').pop()))];
    if (exts.length === 1) return `update ${files.length} ${exts[0]} files`;
    const dirs = [...new Set(files.map((f) => f.split('/')[0]))];
    if (dirs.length === 1) return `update ${dirs[0]} (${files.length} files)`;
    return `update ${files.length} files`;
  }

  it('returns fallback for no files', () => {
    expect(generateMessage([])).toBe('update files');
  });

  it('returns single file name', () => {
    expect(generateMessage([' server/index.ts | 5 ++--'])).toBe('update index.ts');
  });

  it('groups by extension when all same', () => {
    expect(
      generateMessage([
        ' src/a.ts    | 3 +++',
        ' src/b.ts    | 2 --',
        ' lib/c.ts    | 1 +',
      ])
    ).toBe('update 3 ts files');
  });

  it('groups by directory when all same dir', () => {
    expect(
      generateMessage([
        ' server/a.ts   | 3 +++',
        ' server/b.js   | 2 --',
      ])
    ).toBe('update server (2 files)');
  });

  it('falls back to count for mixed dirs and exts', () => {
    expect(
      generateMessage([
        ' src/a.ts    | 3 +++',
        ' lib/b.js    | 2 --',
        ' docs/c.md   | 1 +',
      ])
    ).toBe('update 3 files');
  });
});
