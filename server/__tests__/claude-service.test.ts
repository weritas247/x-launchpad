import { cwdToProjectDir } from '../services/claude-service';

describe('cwdToProjectDir', () => {
  it('replaces forward slashes with dashes', () => {
    expect(cwdToProjectDir('/home/user/project')).toBe('-home-user-project');
  });

  it('replaces underscores with dashes', () => {
    expect(cwdToProjectDir('/home/my_project')).toBe('-home-my-project');
  });

  it('replaces both slashes and underscores', () => {
    expect(cwdToProjectDir('/Users/dev/my_cool_app')).toBe('-Users-dev-my-cool-app');
  });

  it('handles empty string', () => {
    expect(cwdToProjectDir('')).toBe('');
  });

  it('handles root path', () => {
    expect(cwdToProjectDir('/')).toBe('-');
  });

  // Known collision issue — documenting the problem
  it('produces collisions for paths differing only in / vs _ vs -', () => {
    // These all map to the same string — this is a known bug
    const a = cwdToProjectDir('/foo/bar');
    const b = cwdToProjectDir('/foo_bar');
    expect(a).toBe(b); // Both produce "-foo-bar" — collision!
  });

  it('preserves other special characters', () => {
    expect(cwdToProjectDir('/home/user/my.project')).toBe('-home-user-my.project');
  });

  it('handles path with trailing slash', () => {
    expect(cwdToProjectDir('/home/user/project/')).toBe('-home-user-project-');
  });
});
