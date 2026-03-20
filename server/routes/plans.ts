/**
 * Plans API routes — CRUD for plans, plan logs, and plan images.
 *
 * Uses a factory function to inject WebSocket server dependency
 * for broadcasting plan completion events.
 */

import { Router } from 'express';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import * as userDb from '../supabase';
import { extractToken, getTokenPayload } from '../auth';
import { startHeadless, cancelHeadless } from '../handlers/headless';

/** Helper: extract and verify JWT payload, returning 401 if invalid */
function requireAuth(req: express.Request, res: express.Response) {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return null;
  }
  return payload;
}

export function createPlansRouter(wss: WebSocketServer): Router {
  const router = Router();

  // ─── Plans CRUD ─────────────────────────────────────────────────

  router.get('/', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    try {
      const plans = await userDb.getPlans(payload.userId);
      res.json({ ok: true, plans });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.post('/', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const { id, title, content, category, status } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
    try {
      const plan = await userDb.createPlan(payload.userId, {
        id,
        title: title || '',
        content: content || '',
        category: category || 'other',
        status: status || 'todo',
      });
      res.json({ ok: true, plan });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.put('/:id', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const { title, content, category, status, use_worktree, use_headless } = req.body || {};
    try {
      const plan = await userDb.updatePlan(payload.userId, req.params.id, {
        title,
        content,
        category,
        status,
        use_worktree,
        use_headless,
      });
      res.json({ ok: true, plan });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.delete('/:id', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    try {
      await userDb.deletePlan(payload.userId, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.patch('/:id/status', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const { status } = req.body || {};
    const validStatuses = ['todo', 'doing', 'done', 'on_hold', 'cancelled'];
    if (!status || !validStatuses.includes(status))
      return res.status(400).json({ ok: false, error: 'Invalid status' });
    try {
      const plan = await userDb.updatePlanStatus(payload.userId, req.params.id, status);
      res.json({ ok: true, plan });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ─── Headless AI ─────────────────────────────────────────────────

  router.post('/:id/headless', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const planId = req.params.id;
    const { prompt, useWorktree, category, cwd } = req.body || {};
    if (!prompt) return res.status(400).json({ ok: false, error: 'Missing prompt' });
    try {
      const result = await startHeadless(wss, payload.userId, planId, prompt, {
        useWorktree,
        category,
        cwd,
      });
      res.json({ ok: true, sessionId: result.sessionId });
    } catch (e: any) {
      const status = e.message === 'Too many concurrent headless jobs' ? 429 : 500;
      res.status(status).json({ ok: false, error: String(e) });
    }
  });

  router.delete('/:id/headless/:sessionId', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const ok = cancelHeadless(req.params.sessionId);
    if (ok) {
      const msg = JSON.stringify({
        type: 'headless_failed',
        planId: req.params.id,
        sessionId: req.params.sessionId,
        error: 'Cancelled by user',
      });
      wss.clients.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      });
    }
    res.json({ ok });
  });

  // ─── Plan Logs ──────────────────────────────────────────────────

  router.get('/:id/logs', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    try {
      const logs = await userDb.getPlanLogs(payload.userId, req.params.id);
      res.json({ ok: true, logs });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.post('/log', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const { plan_id, type, content, commit_hash } = req.body || {};
    if (!type || !['commit', 'summary'].includes(type))
      return res.status(400).json({ ok: false, error: 'Invalid type' });
    try {
      const result = await userDb.appendPlanLog(payload.userId, {
        plan_id,
        type,
        content: content || '',
        commit_hash,
      });
      if (type === 'summary' && result.plan) {
        const msg = JSON.stringify({
          type: 'plan_ai_done',
          planId: result.plan.id,
          planTitle: result.plan.title,
          planStatus: result.plan.status,
        });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) c.send(msg);
        });
      }
      res.json({ ok: true, plan: result.plan, log: result.log });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  // ─── Plan Images (Supabase Storage) ─────────────────────────────

  router.post(
    '/:id/images',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: '10mb' }),
    async (req, res) => {
      const payload = requireAuth(req, res);
      if (!payload) return;
      const planId = req.params.id;
      const filename = (req.query.filename as string) || `img-${Date.now()}.png`;
      try {
        const result = await userDb.uploadPlanImage(
          payload.userId,
          planId,
          filename,
          req.body,
          req.headers['content-type'] || 'image/png'
        );
        res.json({ ok: true, ...result });
      } catch (e) {
        res.status(500).json({ ok: false, error: String(e) });
      }
    }
  );

  router.get('/:id/images', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    try {
      const images = await userDb.listPlanImages(payload.userId, req.params.id);
      res.json({ ok: true, images });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  router.delete('/:id/images/:filename', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    try {
      await userDb.deletePlanImage(payload.userId, req.params.id, req.params.filename);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  return router;
}
