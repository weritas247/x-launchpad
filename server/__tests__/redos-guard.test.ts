/**
 * Tests for the ReDoS guard in replaceInFile.
 * The guard rejects regex patterns with adjacent quantifiers like *?, +?, *+.
 *
 * IMPORTANT: This guard is insufficient for real ReDoS protection.
 * Many catastrophic patterns bypass it (documented below as KNOWN BYPASSes).
 * Consider using safe-regex2 or worker-thread timeout for production.
 */

// Extract the ReDoS guard logic from replaceInFile for isolated testing
function isRegexTooComplex(query: string): boolean {
  return /(\+|\*|\{)\s*(\+|\*|\?)/.test(query) || query.length > 500;
}

describe('ReDoS guard', () => {
  // ─── Patterns the guard DOES catch ──────────────────────
  it('rejects pattern with *? (lazy after greedy)', () => {
    expect(isRegexTooComplex('.*?')).toBe(true);
  });

  it('rejects pattern with +? (lazy after greedy)', () => {
    expect(isRegexTooComplex('.+?')).toBe(true);
  });

  it('rejects pattern with *+ (possessive-like)', () => {
    expect(isRegexTooComplex('a*+')).toBe(true);
  });

  it('KNOWN BYPASS: {n}? lazy quantifier not caught', () => {
    // The guard only checks +/*/{  before */+/?, but } is not matched
    expect(isRegexTooComplex('a{3}?')).toBe(false); // BUG: should reject
  });

  it('rejects pattern longer than 500 chars', () => {
    const longPattern = 'a'.repeat(501);
    expect(isRegexTooComplex(longPattern)).toBe(true);
  });

  it('rejects direct ** pattern', () => {
    expect(isRegexTooComplex('a**')).toBe(true);
  });

  it('rejects direct ++ pattern', () => {
    expect(isRegexTooComplex('a++')).toBe(true);
  });

  // ─── Safe patterns the guard allows ────────────────────
  it('allows simple literal string', () => {
    expect(isRegexTooComplex('hello world')).toBe(false);
  });

  it('allows basic regex with single quantifier', () => {
    expect(isRegexTooComplex('\\d+')).toBe(false);
  });

  it('allows character class with quantifier', () => {
    expect(isRegexTooComplex('[a-z]+')).toBe(false);
  });

  it('allows alternation', () => {
    expect(isRegexTooComplex('foo|bar|baz')).toBe(false);
  });

  it('allows dot star', () => {
    expect(isRegexTooComplex('.*')).toBe(false);
  });

  it('allows exactly 500 char pattern', () => {
    const pattern = 'a'.repeat(500);
    expect(isRegexTooComplex(pattern)).toBe(false);
  });

  // ─── KNOWN BYPASS: Catastrophic patterns the guard MISSES ─
  // These document real security vulnerabilities in the current guard.
  // If you fix the guard, update these tests to expect `true`.

  it('KNOWN BYPASS: (a+)+ — nested quantifier separated by )', () => {
    // Catastrophic backtracking: exponential time on non-matching input
    expect(isRegexTooComplex('(a+)+')).toBe(false); // BUG: should reject
  });

  it('KNOWN BYPASS: (a|a)+ — alternation causing exponential paths', () => {
    expect(isRegexTooComplex('(a|a)+')).toBe(false); // BUG: should reject
  });

  it('KNOWN BYPASS: ([a-z]+)* — class quantifier inside group quantifier', () => {
    expect(isRegexTooComplex('([a-z]+)*')).toBe(false); // BUG: should reject
  });

  it('KNOWN BYPASS: (a{1,10}){1,10} — bounded but still exponential', () => {
    expect(isRegexTooComplex('(a{1,10}){1,10}')).toBe(false); // BUG: should reject
  });

  it('KNOWN BYPASS: a{3}* — quantifier after bounded quantifier', () => {
    // The guard regex requires +/*/{  before */+/?, but } is not in the first group
    expect(isRegexTooComplex('a{3}*')).toBe(false); // BUG: should reject
  });
});
