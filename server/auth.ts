/**
 * Authentication service — JWT, legacy token, rate limiting.
 */
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { timingSafeEqual } from 'crypto';
import express from 'express';
import * as db from './db';
import * as userDb from './supabase';

// ─── Configuration ───────────────────────────────────────────────
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const tokenAuthEnabled = AUTH_TOKEN.length > 0;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
export const BCRYPT_ROUNDS = 12;
export const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === '1';

if (tokenAuthEnabled) {
  console.log('[auth] Legacy token authentication enabled');
}

// ─── JWT Secret ──────────────────────────────────────────────────
function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let secret = db.getSetting('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(64).toString('hex');
    db.setSetting('jwt_secret', secret);
    console.log('[auth] Generated and persisted new JWT secret');
  }
  return secret;
}

const JWT_SECRET = getJwtSecret();

// ─── Rate Limiting ───────────────────────────────────────────────
const authFailures = new Map<string, { count: number; resetAt: number }>();
const AUTH_MAX_FAILURES = 5;
const AUTH_WINDOW_MS = 60_000;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || now > entry.resetAt) {
    authFailures.set(ip, { count: 0, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  return entry.count < AUTH_MAX_FAILURES;
}

export function recordAuthFailure(ip: string): void {
  const entry = authFailures.get(ip);
  if (entry) entry.count++;
}

// ─── Token Functions ─────────────────────────────────────────────
export function isAuthEnabled(): boolean {
  return tokenAuthEnabled || userDb.getUserCount() > 0 || isSetupRequired();
}

export function isSetupRequired(): boolean {
  return userDb.getUserCount() === 0 && !tokenAuthEnabled;
}

export function isRegistrationAllowed(): boolean {
  if (ALLOW_REGISTRATION) return true;
  return userDb.getUserCount() === 0;
}

export function getAuthMode(): 'email' | 'token' | 'none' {
  const hasUsers = userDb.getUserCount() > 0;
  if (hasUsers) return 'email';
  if (tokenAuthEnabled) return 'token';
  return 'none';
}

export function verifyToken(token: string): boolean {
  if (!token) return false;
  // 1) Try JWT verification
  try {
    jwt.verify(token, JWT_SECRET);
    return true;
  } catch {}
  // 2) Fall back to legacy AUTH_TOKEN
  if (tokenAuthEnabled && AUTH_TOKEN) {
    try {
      return timingSafeEqual(Buffer.from(token), Buffer.from(AUTH_TOKEN));
    } catch {}
  }
  return false;
}

export function getTokenPayload(token: string): { userId: number; email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; email: string };
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export function issueJwt(user: { id: number; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as string | number,
  } as jwt.SignOptions);
}

export function extractToken(req: express.Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return (req.query.token as string) || '';
}

export { tokenAuthEnabled };

// ─── Middleware ───────────────────────────────────────────────────
export function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!isAuthEnabled()) return next();
  if (['/api/auth/login', '/api/auth/check', '/api/auth/register'].includes(req.path))
    return next();
  if (req.path === '/login' || req.path === '/login.html') return next();

  const token = extractToken(req);
  if (token && verifyToken(token)) return next();

  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
  } else if (req.path === '/' || req.path === '/index.html') {
    res.redirect('/login');
  } else {
    next();
  }
}
