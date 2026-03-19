/**
 * Authentication HTTP routes — login, register, auth check.
 */

import { Router } from 'express';
import * as bcrypt from 'bcryptjs';
import * as userDb from '../supabase';
import {
  isAuthEnabled,
  isSetupRequired,
  isRegistrationAllowed,
  getAuthMode,
  verifyToken,
  getTokenPayload,
  issueJwt,
  extractToken,
  checkRateLimit,
  recordAuthFailure,
  tokenAuthEnabled,
  BCRYPT_ROUNDS,
} from '../auth';

export function createAuthRouter(): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    }
    const { email, password, token } = req.body || {};
    if (token && !email) {
      if (tokenAuthEnabled && verifyToken(token)) return res.json({ ok: true });
      recordAuthFailure(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email and password required' });
    }
    const user = await userDb.getUserByEmail(email);
    if (!user) {
      recordAuthFailure(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordAuthFailure(ip);
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    const jwtToken = issueJwt(user);
    res.json({
      ok: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  });

  router.post('/register', async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(ip))
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    if (!isRegistrationAllowed())
      return res.status(403).json({ ok: false, error: 'Registration is not allowed' });
    const { email, password, name } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ ok: false, error: 'Valid email is required' });
    if (!password || password.length < 8)
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    if (password.length > 128)
      return res.status(400).json({ ok: false, error: 'Password must be at most 128 characters' });
    try {
      const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const userId = await userDb.createUser(email, hash, name || '');
      const user = await userDb.getUserById(userId);
      if (!user) throw new Error('User creation failed');
      const jwtToken = issueJwt(user);
      console.log(`[auth] New user registered: ${email} (id: ${userId})`);
      res.json({
        ok: true,
        token: jwtToken,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (err: any) {
      console.error('[auth] Registration error:', err?.message || err?.code || err);
      recordAuthFailure(ip);
      res.status(400).json({ ok: false, error: 'Registration failed' });
    }
  });

  router.get('/check', async (req, res) => {
    const authOn = isAuthEnabled();
    if (!authOn)
      return res.json({
        ok: true,
        authEnabled: false,
        authMode: 'none',
        registrationAllowed: isRegistrationAllowed(),
        setupRequired: false,
      });
    const token = extractToken(req);
    const valid = token ? verifyToken(token) : false;
    const result: any = {
      ok: valid,
      authEnabled: true,
      authMode: getAuthMode(),
      registrationAllowed: isRegistrationAllowed(),
      setupRequired: isSetupRequired(),
      tokenAuthEnabled,
    };
    if (valid && token) {
      const payload = getTokenPayload(token);
      if (payload) {
        const user = await userDb.getUserById(payload.userId);
        if (user) result.user = { id: user.id, email: user.email, name: user.name };
      }
    }
    res.json(result);
  });

  return router;
}
