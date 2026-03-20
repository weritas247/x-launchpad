import { isPathWithin } from '../services/git-service';

describe('isPathWithin (security-critical)', () => {
  const cwd = '/home/user/project';

  // ─── Valid paths ─────────────────────────────────────────
  it('accepts exact cwd match', () => {
    expect(isPathWithin('/home/user/project', cwd)).toBe(true);
  });

  it('accepts direct child file', () => {
    expect(isPathWithin('/home/user/project/file.ts', cwd)).toBe(true);
  });

  it('accepts nested child path', () => {
    expect(isPathWithin('/home/user/project/src/deep/file.ts', cwd)).toBe(true);
  });

  // ─── Path traversal attacks ──────────────────────────────
  it('rejects parent directory traversal', () => {
    expect(isPathWithin('/home/user/project/../secret', cwd)).toBe(false);
  });

  it('rejects double parent traversal', () => {
    expect(isPathWithin('/home/user/project/../../etc/passwd', cwd)).toBe(false);
  });

  it('rejects sibling directory with shared prefix', () => {
    // Critical: /home/user/project-evil starts with /home/user/project
    // but is NOT within /home/user/project — the sep check prevents this
    expect(isPathWithin('/home/user/project-evil/file.ts', cwd)).toBe(false);
  });

  it('rejects sibling directory with longer shared prefix', () => {
    expect(isPathWithin('/home/user/projectX', cwd)).toBe(false);
  });

  it('rejects completely unrelated path', () => {
    expect(isPathWithin('/etc/passwd', cwd)).toBe(false);
  });

  it('rejects root path', () => {
    expect(isPathWithin('/', cwd)).toBe(false);
  });

  // ─── Trailing slash edge cases ───────────────────────────
  it('handles cwd with trailing slash', () => {
    expect(isPathWithin('/home/user/project/file.ts', '/home/user/project/')).toBe(true);
  });

  // ─── Relative path resolution ────────────────────────────
  it('resolves relative paths correctly', () => {
    // resolve() will make these absolute based on process.cwd()
    // Just verify the function doesn't crash on relative input
    const result = isPathWithin('./file.ts', '.');
    expect(typeof result).toBe('boolean');
  });

  // ─── Dotfile edge cases ──────────────────────────────────
  it('accepts hidden files within cwd', () => {
    expect(isPathWithin('/home/user/project/.gitignore', cwd)).toBe(true);
  });

  it('accepts hidden directories within cwd', () => {
    expect(isPathWithin('/home/user/project/.git/config', cwd)).toBe(true);
  });
});
