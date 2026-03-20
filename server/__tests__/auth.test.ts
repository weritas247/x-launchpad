/**
 * Auth module tests.
 *
 * Note: verifyToken/issueJwt/getTokenPayload depend on JWT_SECRET which is
 * initialized at module load from DB or env. We test extractToken (pure) and
 * rate limiting (stateful but isolated) which have no such dependency.
 */

// Mock dependencies before importing auth module
jest.mock('../db', () => ({
  getSetting: jest.fn(() => 'test-jwt-secret-for-unit-tests'),
  setSetting: jest.fn(),
}));

jest.mock('../supabase', () => ({
  getUserCount: jest.fn(() => 0),
}));

jest.mock('../env', () => ({
  env: {
    AUTH_TOKEN: '',
    JWT_SECRET: 'test-jwt-secret-for-unit-tests',
    JWT_EXPIRES_IN: '7d',
    ALLOW_REGISTRATION: false,
  },
}));

import {
  extractToken,
  checkRateLimit,
  recordAuthFailure,
  issueJwt,
  verifyToken,
  getTokenPayload,
} from '../auth';

describe('extractToken', () => {
  it('extracts Bearer token from Authorization header', () => {
    const req = {
      headers: { authorization: 'Bearer abc123token' },
      query: {},
    };
    expect(extractToken(req as any)).toBe('abc123token');
  });

  it('returns empty string when no Authorization header', () => {
    const req = { headers: {}, query: {} };
    expect(extractToken(req as any)).toBe('');
  });

  it('returns empty string for non-Bearer auth header', () => {
    const req = {
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
      query: {},
    };
    expect(extractToken(req as any)).toBe('');
  });

  it('falls back to query parameter token', () => {
    const req = {
      headers: {},
      query: { token: 'query-token-value' },
    };
    expect(extractToken(req as any)).toBe('query-token-value');
  });

  it('prefers Bearer header over query parameter', () => {
    const req = {
      headers: { authorization: 'Bearer header-token' },
      query: { token: 'query-token' },
    };
    expect(extractToken(req as any)).toBe('header-token');
  });

  it('handles Bearer with empty token after space', () => {
    const req = {
      headers: { authorization: 'Bearer ' },
      query: {},
    };
    expect(extractToken(req as any)).toBe('');
  });
});

describe('checkRateLimit + recordAuthFailure', () => {
  it('allows first attempt from new IP', () => {
    expect(checkRateLimit('192.168.1.1')).toBe(true);
  });

  it('allows up to 5 failures', () => {
    const ip = '10.0.0.1';
    checkRateLimit(ip);
    for (let i = 0; i < 4; i++) {
      recordAuthFailure(ip);
    }
    // 4 failures — still under limit
    expect(checkRateLimit(ip)).toBe(true);
  });

  it('blocks after 5 failures', () => {
    const ip = '10.0.0.2';
    checkRateLimit(ip);
    for (let i = 0; i < 5; i++) {
      recordAuthFailure(ip);
    }
    expect(checkRateLimit(ip)).toBe(false);
  });

  it('isolates rate limits per IP', () => {
    const ip1 = '192.168.1.10';
    const ip2 = '192.168.1.20';
    checkRateLimit(ip1);
    for (let i = 0; i < 5; i++) recordAuthFailure(ip1);
    expect(checkRateLimit(ip1)).toBe(false);
    expect(checkRateLimit(ip2)).toBe(true);
  });
});

describe('issueJwt + verifyToken + getTokenPayload', () => {
  it('issues a valid JWT that can be verified', () => {
    const token = issueJwt({ id: 42, email: 'test@example.com' });
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    expect(verifyToken(token)).toBe(true);
  });

  it('extracts correct payload from issued JWT', () => {
    const token = issueJwt({ id: 7, email: 'admin@test.com' });
    const payload = getTokenPayload(token);
    expect(payload).not.toBeNull();
    expect(payload!.userId).toBe(7);
    expect(payload!.email).toBe('admin@test.com');
  });

  it('rejects empty token', () => {
    expect(verifyToken('')).toBe(false);
  });

  it('rejects garbage token', () => {
    expect(verifyToken('not.a.jwt')).toBe(false);
  });

  it('rejects tampered token', () => {
    const token = issueJwt({ id: 1, email: 'a@b.com' });
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(verifyToken(tampered)).toBe(false);
  });

  it('returns null payload for invalid token', () => {
    expect(getTokenPayload('invalid')).toBeNull();
  });
});
