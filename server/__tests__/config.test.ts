jest.mock('../db', () => ({}));
jest.mock('../env', () => ({
  env: { SHELL: '/bin/bash', HOME: '/' },
}));

import { deepMerge } from '../config';

describe('deepMerge', () => {
  it('returns defaults when saved is empty', () => {
    const defaults = { a: 1, b: { c: 2 } };
    const result = deepMerge(defaults, {});
    expect(result).toEqual({ a: 1, b: { c: 2 } });
  });

  it('overrides top-level primitive', () => {
    const defaults = { a: 1, b: 2 };
    const saved = { a: 99 };
    expect(deepMerge(defaults, saved)).toEqual({ a: 99, b: 2 });
  });

  it('deep merges nested objects', () => {
    const defaults = { appearance: { theme: 'cyber', fontSize: 12 } };
    const saved = { appearance: { theme: 'nord' } };
    const result = deepMerge(defaults, saved);
    expect(result).toEqual({ appearance: { theme: 'nord', fontSize: 12 } });
  });

  it('preserves defaults for missing nested keys', () => {
    const defaults = { a: { x: 1, y: 2 }, b: { z: 3 } };
    const saved = { a: { x: 10 } };
    const result = deepMerge(defaults, saved);
    expect(result).toEqual({ a: { x: 10, y: 2 }, b: { z: 3 } });
  });

  it('replaces arrays instead of merging', () => {
    const defaults = { items: [1, 2, 3] };
    const saved = { items: [4, 5] };
    const result = deepMerge(defaults, saved);
    expect(result).toEqual({ items: [4, 5] });
  });

  it('handles null in saved by overwriting', () => {
    const defaults = { a: { b: 1 } };
    const saved = { a: null };
    const result = deepMerge(defaults, saved);
    expect(result.a).toBeNull();
  });

  it('handles saved key not in defaults', () => {
    const defaults = { a: 1 };
    const saved = { a: 2, extraKey: 'bonus' };
    const result = deepMerge(defaults, saved);
    expect(result).toEqual({ a: 2, extraKey: 'bonus' });
  });

  it('does not mutate defaults', () => {
    const defaults = { a: { b: 1 } };
    const saved = { a: { b: 99 } };
    deepMerge(defaults, saved);
    expect(defaults.a.b).toBe(1);
  });

  it('handles deeply nested merge (3+ levels)', () => {
    const defaults = { l1: { l2: { l3: { value: 'default' } } } };
    const saved = { l1: { l2: { l3: { value: 'saved' } } } };
    const result = deepMerge(defaults, saved);
    expect(result.l1.l2.l3.value).toBe('saved');
  });

  it('replaces primitive type with object from saved', () => {
    // If defaults has a primitive but saved has an object, saved wins
    const defaults = { a: 'string' };
    const saved = { a: { nested: true } };
    const result = deepMerge(defaults, saved);
    expect(result.a).toEqual({ nested: true });
  });

  // Real-world scenario: settings migration
  it('merges real AppSettings-like structure', () => {
    const defaults = {
      appearance: { theme: 'cyber', fontSize: 12, crtScanlines: true },
      terminal: { scrollback: 5000, bellStyle: 'none' },
      keybindings: { newSession: 'Ctrl+T', closeTab: 'Ctrl+W' },
    };
    const saved = {
      appearance: { theme: 'nord', fontSize: 14 },
      terminal: { scrollback: 10000 },
    };
    const result = deepMerge(defaults, saved);
    expect(result).toEqual({
      appearance: { theme: 'nord', fontSize: 14, crtScanlines: true },
      terminal: { scrollback: 10000, bellStyle: 'none' },
      keybindings: { newSession: 'Ctrl+T', closeTab: 'Ctrl+W' },
    });
  });
});
