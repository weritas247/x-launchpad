import express from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { execSync } from 'child_process';
const execFileAsync = promisify(execFile);
import * as gitService from './git-service';
import * as db from './db';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

const app = express();
const server = http.createServer(app);
// Control WS: session management, settings, git, file ops (JSON)
const wss = new WebSocketServer({ noServer: true });
// Data WS: per-session terminal I/O (binary)
const wssData = new WebSocketServer({ noServer: true });

// Route upgrade requests to the right WSS
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  if (url.pathname === '/pty') {
    wssData.handleUpgrade(req, socket, head, (ws) => {
      wssData.emit('connection', ws, req);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});
const PORT = parseInt(process.env.PORT || '3000', 10);
const SETTINGS_PATH  = path.join(__dirname, '../../settings.json');
const SESSIONS_PATH  = path.join(__dirname, '../../sessions.json');

// ─── TMUX INTEGRATION ────────────────────────────────────────────
// tmux is opt-in: set ENABLE_TMUX=1 for remote/unstable network use
const TMUX_SOCKET = path.join(os.tmpdir(), 'super-terminal-tmux');
let tmuxAvailable = false;
const tmuxRequested = process.env.ENABLE_TMUX === '1';
if (tmuxRequested) {
  try {
    execSync('tmux -V', { stdio: 'ignore' });
    tmuxAvailable = true;
    console.log(`[tmux] Enabled — socket: ${TMUX_SOCKET}`);
  } catch {
    console.log('[tmux] Requested but not found — falling back to direct PTY');
  }
} else {
  console.log('[tmux] Disabled (set ENABLE_TMUX=1 to enable)');
}

function tmuxExec(args: string[], timeout = 3000): string {
  return execSync(`tmux -S "${TMUX_SOCKET}" ${args.join(' ')}`, {
    encoding: 'utf-8', timeout,
  }).trim();
}

function tmuxSessionExists(name: string): boolean {
  try {
    tmuxExec(['has-session', '-t', name]);
    return true;
  } catch { return false; }
}

function tmuxCreateSession(name: string, cwd: string, shell: string): void {
  const safeCwd = fs.existsSync(cwd) ? cwd : (process.env.HOME || '/');
  tmuxExec(['new-session', '-d', '-s', name, '-c', safeCwd, shell]);
  // Hide all tmux chrome — our UI provides its own
  try { tmuxExec(['set-option', '-t', name, 'status', 'off']); } catch {}
  try { tmuxExec(['set-option', '-t', name, 'pane-border-status', 'off']); } catch {}
  try { tmuxExec(['set-option', '-t', name, 'set-titles', 'off']); } catch {}
  // Disable tmux prefix key to avoid capturing user shortcuts
  try { tmuxExec(['set-option', '-t', name, 'prefix', 'None']); } catch {}
  try { tmuxExec(['set-option', '-t', name, 'prefix2', 'None']); } catch {}
}

function tmuxKillSession(name: string): void {
  try { tmuxExec(['kill-session', '-t', name]); } catch {}
}

function tmuxGetCwd(name: string): string | null {
  try {
    return tmuxExec(['display-message', '-t', name, '-p', '#{pane_current_path}']);
  } catch { return null; }
}

function tmuxGetPanePid(name: string): number | null {
  try {
    const pid = tmuxExec(['display-message', '-t', name, '-p', '#{pane_pid}']);
    return parseInt(pid) || null;
  } catch { return null; }
}

function tmuxListSessions(): string[] {
  try {
    const out = tmuxExec(['list-sessions', '-F', '#{session_name}']);
    return out.split('\n').filter(Boolean);
  } catch { return []; }
}

// ─── DEFAULT SETTINGS ─────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  appearance: {
    theme: 'cyber',
    fontFamily: '"JetBrains Mono",monospace',
    fontSize: 12,
    sidebarFontSize: 12,
    statusBarFontSize: 11,
    tabBarFontSize: 8,
    inputPanelFontSize: 11,
    fileViewerFontSize: 13,
    gitGraphFontSize: 12,
    lineHeight: 1.25,
    cursorStyle: 'block',
    cursorBlink: true,
    backgroundOpacity: 1.0,
    crtScanlines: true,
    crtScanlinesIntensity: 0.07,
    crtFlicker: true,
    vignette: true,
    glowIntensity: 1.0,
    screenDimOpacity: 0,
  },
  terminal: {
    scrollback: 5000,
    bellStyle: 'none',
    copyOnSelect: false,
    rightClickPaste: true,
    trimCopied: true,
    wordSeparators: ' ()[]{}\'":;,`|',
    renderer: 'canvas',
  },
  shell: {
    shellPath: process.env.SHELL || '/bin/bash',
    startDirectory: process.env.HOME || '/',
    env: {} as Record<string, string>,
    sessionNameFormat: 'shell-{n}',
    autoReconnect: true,
  },
  keybindings: {
    newSession: 'Ctrl+Shift+T',
    closeSession: 'Ctrl+Shift+W',
    nextTab: 'Ctrl+Tab',
    prevTab: 'Ctrl+Shift+Tab',
    openSettings: 'Ctrl+,',
    fullscreen: 'F11',
    renameSession: 'Ctrl+Shift+r',
    clearTerminal: 'Meta+k',
    splitSession: '',
    gitGraph: 'Ctrl+g',
    toggleSidebar: 'Ctrl+b',
    focusSearch: 'Ctrl+Shift+f',
    focusExplorer: 'Ctrl+Shift+e',
    focusSourceControl: 'Ctrl+Shift+g',
    toggleInputPanel: 'Meta+i',
  },
  advanced: {
    customCss: '',
    wsReconnectInterval: 3000,
    logLevel: 'info',
  },
};

// ─── SETTINGS PERSISTENCE ─────────────────────────────────────────
function deepMerge(defaults: any, saved: any): any {
  const result = { ...defaults };
  for (const key of Object.keys(saved)) {
    if (saved[key] && typeof saved[key] === 'object' && !Array.isArray(saved[key])
        && defaults[key] && typeof defaults[key] === 'object') {
      result[key] = deepMerge(defaults[key], saved[key]);
    } else {
      result[key] = saved[key];
    }
  }
  return result;
}

function loadSettings(): typeof DEFAULT_SETTINGS {
  // Try SQLite first
  try {
    const dbSettings = db.getSettings();
    if (dbSettings) return deepMerge(DEFAULT_SETTINGS, dbSettings as any);
  } catch {}
  // Fall back to JSON file (and migrate to SQLite)
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const settings = deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
      try { db.saveSettings(settings); } catch {} // migrate
      return settings;
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings(s: typeof DEFAULT_SETTINGS): void {
  db.saveSettings(s);
  // Also write JSON file for backwards compatibility
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8'); } catch {}
}

let currentSettings = loadSettings();

// ─── AUTHENTICATION ──────────────────────────────────────────────
import { timingSafeEqual } from 'crypto';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const tokenAuthEnabled = AUTH_TOKEN.length > 0;

function isAuthEnabled(): boolean {
  return tokenAuthEnabled || db.getUserCount() > 0 || isSetupRequired();
}

function isSetupRequired(): boolean {
  return db.getUserCount() === 0 && !tokenAuthEnabled;
}

function isRegistrationAllowed(): boolean {
  if (ALLOW_REGISTRATION) return true;
  return db.getUserCount() === 0;
}

function getAuthMode(): 'email' | 'token' | 'none' {
  const hasUsers = db.getUserCount() > 0;
  if (hasUsers) return 'email';
  if (tokenAuthEnabled) return 'token';
  return 'none';
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 12;
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === '1';

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

// Rate limiting for auth failures
const authFailures = new Map<string, { count: number; resetAt: number }>();
const AUTH_MAX_FAILURES = 5;
const AUTH_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || now > entry.resetAt) {
    authFailures.set(ip, { count: 0, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  return entry.count < AUTH_MAX_FAILURES;
}

function recordAuthFailure(ip: string): void {
  const entry = authFailures.get(ip);
  if (entry) entry.count++;
}

function verifyToken(token: string): boolean {
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

function getTokenPayload(token: string): { userId: number; email: string } | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; email: string };
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

function issueJwt(user: { id: number; email: string }): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN as string | number,
  } as jwt.SignOptions);
}

function extractToken(req: express.Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return (req.query.token as string) || '';
}

// Auth middleware — skip for login page and static assets
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!isAuthEnabled()) return next();
  if (['/api/auth/login', '/api/auth/check', '/api/auth/register'].includes(req.path)) return next();
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

if (tokenAuthEnabled) {
  console.log('[auth] Legacy token authentication enabled');
}
console.log(`[auth] Email auth: ${db.getUserCount()} registered user(s), registration ${isRegistrationAllowed() ? 'allowed' : 'locked'}`);

// ─── HTTP ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, '../../client')));

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  const { email, password, token } = req.body || {};

  // Legacy token login
  if (token && !email) {
    if (tokenAuthEnabled && verifyToken(token)) {
      return res.json({ ok: true });
    }
    recordAuthFailure(ip);
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  // Email login
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password required' });
  }

  const user = db.getUserByEmail(email);
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

app.post('/api/auth/register', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }

  if (!isRegistrationAllowed()) {
    return res.status(403).json({ ok: false, error: 'Registration is not allowed' });
  }

  const { email, password, name } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Valid email is required' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
  }
  if (password.length > 128) {
    return res.status(400).json({ ok: false, error: 'Password must be at most 128 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const userId = db.createUser(email, hash, name || '');
    const user = db.getUserById(userId)!;
    const jwtToken = issueJwt(user);
    console.log(`[auth] New user registered: ${email} (id: ${userId})`);
    res.json({
      ok: true,
      token: jwtToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err: any) {
    recordAuthFailure(ip);
    res.status(400).json({ ok: false, error: 'Registration failed' });
  }
});

app.get('/api/auth/check', (req, res) => {
  const authOn = isAuthEnabled();
  if (!authOn) return res.json({ ok: true, authEnabled: false, authMode: 'none', registrationAllowed: isRegistrationAllowed(), setupRequired: false });

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
      const user = db.getUserById(payload.userId);
      if (user) {
        result.user = { id: user.id, email: user.email, name: user.name };
      }
    }
  }

  res.json(result);
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/login.html'));
});

app.get('/api/settings', (_req, res) => {
  res.json(currentSettings);
});

app.post('/api/settings', (req, res) => {
  try {
    currentSettings = req.body as typeof DEFAULT_SETTINGS;
    saveSettings(currentSettings);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

app.get('/api/settings/default', (_req, res) => {
  res.json(DEFAULT_SETTINGS);
});

// ─── IMAGE UPLOAD ─────────────────────────────────────────────────
app.post('/api/upload-image',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: '20mb' }),
  (req, res) => {
    const sessionId = req.query.sessionId as string;
    const originalName = req.query.filename as string;
    if (!sessionId || !originalName) {
      return res.status(400).json({ ok: false, error: 'Missing sessionId or filename' });
    }
    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ ok: false, error: 'Session not found' });
    }
    const targetDir = (session.cwd && fs.existsSync(session.cwd))
      ? session.cwd
      : (currentSettings.shell.startDirectory || process.env.HOME || '/tmp');
    const ext = path.extname(originalName).toLowerCase() || '.png';
    const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({ ok: false, error: 'Unsupported image format' });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = `pasted-image-${timestamp}${ext}`;
    const fullPath = path.join(targetDir, safeName);
    try {
      fs.writeFileSync(fullPath, req.body);
      res.json({ ok: true, filename: safeName, fullPath });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  }
);

// ─── DELETE UPLOADED IMAGE ─────────────────────────────────────────
app.post('/api/delete-image', (req, res) => {
  const filePath = req.body?.filePath as string;
  if (!filePath || !filePath.includes('pasted-image-')) {
    return res.status(400).json({ ok: false });
  }
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ─── REVEAL IN FINDER ─────────────────────────────────────────────
app.post('/api/reveal-in-finder', (req, res) => {
  const sessionId = req.body?.sessionId as string;
  if (!sessionId) return res.status(400).json({ ok: false });
  const session = sessions.get(sessionId);
  const dir = session?.cwd || currentSettings.shell.startDirectory || process.env.HOME || '/tmp';
  if (!fs.existsSync(dir)) return res.status(404).json({ ok: false });
  execFile('open', [dir], (err) => {
    if (err) return res.status(500).json({ ok: false, error: String(err) });
    res.json({ ok: true });
  });
});

// ─── FILE DOWNLOAD ───────────────────────────────────────────────
app.get('/api/download', (req, res) => {
  const sessionId = req.query.sessionId as string;
  const filePath = req.query.path as string;
  if (!sessionId || !filePath) return res.status(400).json({ ok: false, error: 'Missing params' });
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
  const cwd = session.cwd || process.env.HOME || '/tmp';
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd))) return res.status(403).json({ ok: false, error: 'Access denied' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: 'File not found' });
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) return res.status(400).json({ ok: false, error: 'Cannot download directory' });
  if (stat.size > 50 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'File too large (>50MB)' });
  res.download(fullPath);
});

// ─── FILE UPLOAD ─────────────────────────────────────────────────
app.post('/api/upload',
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  (req, res) => {
    const sessionId = req.query.sessionId as string;
    const fileName = req.query.filename as string;
    const targetDir = req.query.dir as string | undefined;
    if (!sessionId || !fileName) return res.status(400).json({ ok: false, error: 'Missing params' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const cwd = session.cwd || process.env.HOME || '/tmp';
    const dir = targetDir ? path.resolve(cwd, targetDir) : cwd;
    if (!dir.startsWith(path.resolve(cwd))) return res.status(403).json({ ok: false, error: 'Access denied' });
    const safeName = path.basename(fileName); // strip directory components
    const fullPath = path.join(dir, safeName);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, req.body);
      res.json({ ok: true, filename: safeName, fullPath });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  }
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

// ─── CLAUDE USAGE TRACKING ───────────────────────────────────────
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalCost: number;
  sessionId: string | null;
  model: string | null;
}

// Model pricing per million tokens (input / output)
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheCreate: number }> = {
  'claude-opus-4-6':   { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.30, cacheCreate: 3.75 },
  'claude-haiku-4-5':  { input: 0.80, output: 4, cacheRead: 0.08, cacheCreate: 1 },
  // Fallback for older models
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.30, cacheCreate: 3.75 },
};

function cwdToProjectDir(cwd: string): string {
  // Convert /Users/foo/Dev/project → -Users-foo-Dev-project
  // Claude Code also replaces underscores with hyphens in project dir names
  return cwd.replace(/[/_]/g, '-');
}

function getClaudeUsage(cwd: string): ClaudeUsage | null {
  try {
    const projectKey = cwdToProjectDir(cwd);
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectKey);
    if (!fs.existsSync(projectDir)) return null;

    // Find active session from ~/.claude/sessions/
    let activeSessionId: string | null = null;
    try {
      const sessDir = path.join(CLAUDE_DIR, 'sessions');
      if (fs.existsSync(sessDir)) {
        const sessFiles = fs.readdirSync(sessDir).filter(f => f.endsWith('.json'));
        for (const sf of sessFiles) {
          try {
            const raw = fs.readFileSync(path.join(sessDir, sf), 'utf-8');
            const sess = JSON.parse(raw);
            if (sess.cwd === cwd && sess.sessionId) {
              activeSessionId = sess.sessionId;
            }
          } catch {}
        }
      }
    } catch {}

    // Find the most recent JSONL file (or the active session's file)
    let targetJsonl: string | null = null;
    if (activeSessionId) {
      const candidate = path.join(projectDir, `${activeSessionId}.jsonl`);
      if (fs.existsSync(candidate)) targetJsonl = candidate;
    }
    if (!targetJsonl) {
      // Fallback: find the most recently modified .jsonl
      const jsonls = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (jsonls.length > 0) targetJsonl = path.join(projectDir, jsonls[0].name);
    }
    if (!targetJsonl) return null;

    // Parse JSONL and aggregate usage
    const content = fs.readFileSync(targetJsonl, 'utf-8');
    const lines = content.trim().split('\n');

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreateTokens = 0;
    let totalCost = 0;
    let model: string | null = null;
    let claudeSessionId: string | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'assistant' || !entry.message?.usage) continue;

        const usage = entry.message.usage;
        const m = entry.message.model || '';
        if (m) model = m;
        if (entry.sessionId) claudeSessionId = entry.sessionId;

        const inp = usage.input_tokens || 0;
        const out = usage.output_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;

        inputTokens += inp;
        outputTokens += out;
        cacheReadTokens += cacheRead;
        cacheCreateTokens += cacheCreate;

        // Calculate cost
        const pricing = MODEL_PRICING[m] || MODEL_PRICING['claude-sonnet-4-6'];
        totalCost += (inp / 1_000_000) * pricing.input
                   + (out / 1_000_000) * pricing.output
                   + (cacheRead / 1_000_000) * pricing.cacheRead
                   + (cacheCreate / 1_000_000) * pricing.cacheCreate;
      } catch {}
    }

    if (inputTokens === 0 && outputTokens === 0) return null;

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, totalCost, sessionId: claudeSessionId, model };
  } catch {
    return null;
  }
}

function getClaudePrompts(cwd: string, aiPid: number | null): { text: string; timestamp: string }[] {
  try {
    const projectKey = cwdToProjectDir(cwd);
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectKey);
    if (!fs.existsSync(projectDir)) return [];

    // Find active session: prefer PID-based lookup, fall back to CWD match
    let activeSessionId: string | null = null;
    const sessDir = path.join(CLAUDE_DIR, 'sessions');

    // 1) PID-based: ~/.claude/sessions/{aiPid}.json → exact match
    if (aiPid) {
      try {
        const pidFile = path.join(sessDir, `${aiPid}.json`);
        console.log(`[claude_prompts] checking pidFile=${pidFile} exists=${fs.existsSync(pidFile)}`);
        if (fs.existsSync(pidFile)) {
          const sess = JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
          if (sess.sessionId) {
            activeSessionId = sess.sessionId;
            console.log(`[claude_prompts] PID match → sessionId=${activeSessionId}`);
          }
        }
      } catch {}
    }

    // 2) Fallback: CWD match (last match wins)
    if (!activeSessionId) {
      try {
        if (fs.existsSync(sessDir)) {
          const sessFiles = fs.readdirSync(sessDir).filter(f => f.endsWith('.json'));
          for (const sf of sessFiles) {
            try {
              const raw = fs.readFileSync(path.join(sessDir, sf), 'utf-8');
              const sess = JSON.parse(raw);
              if (sess.cwd === cwd && sess.sessionId) activeSessionId = sess.sessionId;
            } catch {}
          }
        }
      } catch {}
    }

    console.log(`[claude_prompts] resolved activeSessionId=${activeSessionId}`);
    let targetJsonl: string | null = null;
    if (activeSessionId) {
      const candidate = path.join(projectDir, `${activeSessionId}.jsonl`);
      if (fs.existsSync(candidate)) targetJsonl = candidate;
    }
    if (!targetJsonl) {
      const jsonls = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (jsonls.length > 0) targetJsonl = path.join(projectDir, jsonls[0].name);
      console.log(`[claude_prompts] fallback to most recent jsonl`);
    }
    if (!targetJsonl) return [];
    console.log(`[claude_prompts] reading ${path.basename(targetJsonl)}`);

    const content = fs.readFileSync(targetJsonl, 'utf-8');
    const lines = content.trim().split('\n');
    const prompts: { text: string; timestamp: string }[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Only real user prompts: type=user, no toolUseResult, no isMeta
        if (entry.type !== 'user' || entry.toolUseResult || entry.isMeta) continue;
        const msg = entry.message;
        if (!msg) continue;
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) { text = block.text; break; }
          }
        }
        const trimmed = text.trim();
        if (!trimmed) continue;
        // Skip system-generated command messages (e.g. /clear, /help)
        if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<local-command-caveat>')) continue;
        prompts.push({ text: trimmed, timestamp: entry.timestamp || '' });
      } catch {}
    }
    return prompts;
  } catch {
    return [];
  }
}

// ─── SESSION MANAGEMENT ───────────────────────────────────────────
const SCROLLBACK_LIMIT = 128 * 1024; // keep last 128KB of output per session

interface Session {
  id: string;
  name: string;
  pty: pty.IPty;
  createdAt: number;
  cwd: string;
  ai: string | null;
  aiPid: number | null;  // PID of detected AI process (e.g. Claude)
  cmd?: string;
  cwdTimer?: ReturnType<typeof setInterval>;
  pendingCmd?: string;
  resized?: boolean;
  scrollback: string; // ring buffer of recent output
  tmuxName?: string;  // tmux session name (if tmux-backed)
}

const sessions = new Map<string, Session>();
const wsSession = new Map<WebSocket, string>();
// Extra subscriptions: receive output without changing active session
const wsSubscriptions = new Map<WebSocket, Set<string>>();
// Per-session data WebSocket connections (terminal I/O)
const dataWsMap = new Map<string, Set<WebSocket>>();

function createSession(id: string, name: string, restoreCwd?: string, restoreCmd?: string): Session {
  const s = currentSettings.shell;
  const shellPath = s.shellPath || (os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash'));
  const mergedEnv = {
    ...(process.env as Record<string, string>),
    ...s.env,
    LANG: (process.env.LANG && process.env.LANG.includes('UTF')) ? process.env.LANG : 'en_US.UTF-8',
    LC_ALL: (process.env.LC_ALL && process.env.LC_ALL.includes('UTF')) ? process.env.LC_ALL : 'en_US.UTF-8',
    LC_CTYPE: (process.env.LC_CTYPE && process.env.LC_CTYPE.includes('UTF')) ? process.env.LC_CTYPE : 'en_US.UTF-8',
    TERM: 'xterm-256color',
  };
  const cwd0 = restoreCwd || s.startDirectory || process.env.HOME || '/';

  // Sanitize tmux session name: replace dots/colons which tmux doesn't like
  const tmuxName = id.replace(/[.:]/g, '-');
  const useTmux = tmuxAvailable;

  let ptyProcess: pty.IPty;
  if (useTmux) {
    // Create tmux session if it doesn't already exist (survives server restart)
    if (!tmuxSessionExists(tmuxName)) {
      tmuxCreateSession(tmuxName, cwd0, shellPath);
      console.log(`[tmux] Created session: ${tmuxName}`);
    } else {
      console.log(`[tmux] Reattaching to existing session: ${tmuxName}`);
    }
    // Attach to tmux session via PTY
    ptyProcess = pty.spawn('tmux', ['-S', TMUX_SOCKET, 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: fs.existsSync(cwd0) ? cwd0 : (process.env.HOME || '/'),
      env: mergedEnv,
    });
  } else {
    ptyProcess = pty.spawn(shellPath, ['-i'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: fs.existsSync(cwd0) ? cwd0 : (process.env.HOME || '/'),
      env: mergedEnv,
    });
  }
  const session: Session = { id, name, pty: ptyProcess, createdAt: Date.now(), cwd: cwd0, ai: null, aiPid: null, cmd: restoreCmd, scrollback: '', tmuxName: useTmux ? tmuxName : undefined };
  sessions.set(id, session);

  // PTY output → clients with this session active OR subscribed
  // Batch rapid output chunks to avoid per-character streaming flicker
  let outputBuf = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY = 16; // ms — batch within one animation frame

  // Pre-compute binary header for this session's output frames
  const sessionIdBuf = Buffer.from(id, 'utf-8');
  const binHeader = Buffer.alloc(1 + 2 + sessionIdBuf.length);
  binHeader[0] = 0x01; // type: terminal output
  binHeader.writeUInt16BE(sessionIdBuf.length, 1);
  sessionIdBuf.copy(binHeader, 3);

  function flushOutput() {
    flushTimer = null;
    if (!outputBuf) return;
    // Accumulate scrollback for reconnect replay (always, even if no client)
    session.scrollback += outputBuf;
    if (session.scrollback.length > SCROLLBACK_LIMIT) {
      session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
    }
    // Send raw output via per-session data WebSocket (no framing needed — 1 WS = 1 session)
    const data = outputBuf;
    outputBuf = '';
    const clients = dataWsMap.get(id);
    if (!clients || clients.size === 0) return;
    clients.forEach(ws => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if ((ws as any).bufferedAmount > 1024 * 1024) return; // backpressure
      ws.send(data);
    });
  }

  ptyProcess.onData((chunk: string) => {
    // Strip inline image protocols that xterm.js cannot render:
    // - iTerm2 inline images: OSC 1337 ; File=... ST
    // - Sixel graphics: DCS ... ST
    let filtered = chunk
      .replace(/\x1b\]1337;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1bP[pq][^\x1b]*\x1b\\/g, '');
    if (!filtered) return;

    outputBuf += filtered;

    // Flush immediately if buffer is large (interactive responsiveness)
    if (outputBuf.length > 64 * 1024) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushOutput();
      return;
    }

    // Otherwise debounce — batch rapid small chunks together
    if (!flushTimer) {
      flushTimer = setTimeout(flushOutput, FLUSH_DELAY);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[session] ${id} exited: ${exitCode}`);
    if (session.cwdTimer) clearInterval(session.cwdTimer);
    // For tmux sessions, only remove if tmux session itself is gone
    // (PTY exit just means detach — the shell survives)
    if (session.tmuxName && tmuxSessionExists(session.tmuxName)) {
      console.log(`[tmux] PTY detached but tmux session '${session.tmuxName}' still alive — keeping`);
      // Re-attach on next client connect via restoreSessions logic
      return;
    }
    sessions.delete(id);
    broadcastSessionList();
  });

  // Poll CWD + detect running AI (active session: 2s, background: 10s)
  const CWD_POLL_ACTIVE = 2000;
  const CWD_POLL_BG = 10000;
  let lastPollTime = 0;
  session.cwdTimer = setInterval(async () => {
    // Throttle background sessions: only poll every 10s
    const isActive = Array.from(wsSession.values()).includes(id);
    const interval = isActive ? CWD_POLL_ACTIVE : CWD_POLL_BG;
    const now = Date.now();
    if (now - lastPollTime < interval) return;
    lastPollTime = now;
    try {
      let newCwd = cwd0;
      let shellPid = ptyProcess.pid;

      if (session.tmuxName) {
        // tmux: get CWD and pane PID directly from tmux
        const tmuxCwd = tmuxGetCwd(session.tmuxName);
        if (tmuxCwd) newCwd = tmuxCwd;
        const panePid = tmuxGetPanePid(session.tmuxName);
        if (panePid) shellPid = panePid;
      } else {
        // Direct PTY: use lsof
        try {
          const { stdout } = await execFileAsync('lsof', ['-p', String(shellPid), '-a', '-d', 'cwd', '-Fn'], {
            encoding: 'utf-8', timeout: 500,
          });
          const match = stdout.match(/\nn(.+)/);
          if (match) newCwd = match[1].trim();
        } catch {}
      }

      let newAi: string | null = null;
      let newAiPid: number | null = null;
      try {
        const { stdout: psOut } = await execFileAsync('ps', ['-eo', 'pid,ppid,args'], {
          encoding: 'utf-8', timeout: 800,
        });
        const rows = psOut.trim().split('\n').slice(1);
        const parentOf = new Map<number, number>();
        const cmdOf = new Map<number, string>();
        for (const row of rows) {
          const m = row.trim().match(/^(\d+)\s+(\d+)\s+(.*)/);
          if (m) {
            const p = parseInt(m[1]);
            const pp = parseInt(m[2]);
            parentOf.set(p, pp);
            cmdOf.set(p, m[3]);
          }
        }
        const rootPid = shellPid;
        const descendants = new Set<number>([rootPid]);
        for (const [p, pp] of parentOf) {
          let cur = pp;
          const visited = new Set<number>();
          while (cur !== 0 && !visited.has(cur)) {
            visited.add(cur);
            if (cur === rootPid) { descendants.add(p); break; }
            cur = parentOf.get(cur) ?? 0;
          }
        }
        // Collect all AI-matching PIDs (not just first) so we can pick the session-file PID
        const aiCandidates: { pid: number; ai: string }[] = [];
        for (const dp of descendants) {
          const cmd = (cmdOf.get(dp) || '').toLowerCase();
          if (/claude/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'claude' });
          else if (/chatgpt/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'chatgpt' });
          else if (/\/gemini(\s|$)/.test(cmd) || /bin\/gemini/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'gemini' });
          else if (/copilot/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'copilot' });
          else if (/aider/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'aider' });
          else if (/cursor/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'cursor' });
          else if (/opencode/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'opencode' });
          else if (/codex/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'codex' });
        }
        if (aiCandidates.length > 0) {
          // For Claude: prefer the PID that has a session file in ~/.claude/sessions/
          const claudeCandidates = aiCandidates.filter(c => c.ai === 'claude');
          if (claudeCandidates.length > 0) {
            newAi = 'claude';
            const sessDir = path.join(CLAUDE_DIR, 'sessions');
            const matched = claudeCandidates.find(c => fs.existsSync(path.join(sessDir, `${c.pid}.json`)));
            newAiPid = matched ? matched.pid : claudeCandidates[0].pid;
          } else {
            newAi = aiCandidates[0].ai;
            newAiPid = aiCandidates[0].pid;
          }
        }
      } catch {}

      if (newCwd !== session.cwd || newAi !== session.ai || newAiPid !== session.aiPid) {
        session.cwd = newCwd;
        session.ai = newAi;
        session.aiPid = newAiPid;
        const msg = JSON.stringify({ type: 'session_info', sessionId: id, cwd: newCwd, ai: newAi });
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
      }
    } catch {}
  }, 2000);

  console.log(`[session] Created: ${id} (${name})`);
  return session;
}

function persistSessions() {
  const data = Array.from(sessions.values()).map(s => ({
    id: s.id, name: s.name, createdAt: s.createdAt, cwd: s.cwd, cmd: s.cmd,
  }));
  try { db.saveSessions(data); } catch {}
  // Also write JSON file for backwards compatibility
  try { fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
}

function stripEscape(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // CSI sequences
    .replace(/\x1b[()][AB012]/g, '')          // character set
    .replace(/\x1b./g, '')                    // other ESC sequences
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '') // control chars except \n
    .replace(/\r/g, '');
}

function runCmdWhenReady(sess: Session, cmd: string) {
  let sent = false;

  // Primary: detect shell prompt in PTY output
  let buf = '';
  let gotFirstData = false;
  const unsub = sess.pty.onData((chunk: string) => {
    if (sent) return;
    buf += chunk;
    gotFirstData = true;
    const clean = stripEscape(buf);
    if (/[$%>#❯›]\s*$/.test(clean)) {
      sent = true;
      unsub.dispose();
      setTimeout(() => sess.pty.write(cmd + '\r'), 100);
    }
    if (buf.length > 4000 && !sent) {
      sent = true;
      unsub.dispose();
      sess.pty.write(cmd + '\r');
    }
  });

  // Fallback A: if we got data but prompt regex never matched, send after 3s
  setTimeout(() => {
    if (!sent && gotFirstData) {
      sent = true;
      unsub.dispose();
      sess.pty.write(cmd + '\r');
    }
  }, 3000);

  // Fallback B: hard timeout — send no matter what after 6s
  setTimeout(() => {
    if (!sent) {
      sent = true;
      unsub.dispose();
      sess.pty.write(cmd + '\r');
    }
  }, 6000);
}

function broadcastSessionList(exclude?: WebSocket) {
  persistSessions();
  const list = Array.from(sessions.values()).map(s => ({
    id: s.id, name: s.name, createdAt: s.createdAt, cwd: s.cwd,
  }));
  const msg = JSON.stringify({ type: 'session_list', sessions: list });
  wss.clients.forEach(client => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ─── RESTORE SESSIONS ON STARTUP ──────────────────────────────────
// Map session names to their CLI commands
const NAME_TO_CMD: Record<string, string> = {
  claude: 'claude', gemini: 'gemini', codex: 'codex',
  opencode: 'opencode', aider: 'aider', copilot: 'copilot',
};

function cmdForSession(s: { name: string; cmd?: string }): string | undefined {
  if (s.cmd) return s.cmd;
  return NAME_TO_CMD[s.name.toLowerCase()];
}

function restoreSessions() {
  try {
    // Try SQLite first, fall back to JSON file
    let saved: Array<{ id: string; name: string; createdAt: number; cwd: string; cmd?: string }>;
    const dbSessions = db.listSessions();
    if (dbSessions.length > 0) {
      saved = dbSessions.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at, cwd: r.cwd, cmd: r.cmd || undefined }));
    } else if (fs.existsSync(SESSIONS_PATH)) {
      const raw = fs.readFileSync(SESSIONS_PATH, 'utf-8');
      saved = JSON.parse(raw);
    } else {
      return;
    }
    if (!Array.isArray(saved) || saved.length === 0) return;

    // Get list of live tmux sessions (if tmux is available)
    const liveTmux = tmuxAvailable ? new Set(tmuxListSessions()) : new Set<string>();

    console.log(`[session] Restoring ${saved.length} session(s) from disk...`);
    for (const s of saved) {
      const tmuxName = s.id.replace(/[.:]/g, '-');
      const tmuxAlive = liveTmux.has(tmuxName);

      if (tmuxAvailable && tmuxAlive) {
        // tmux session survived server restart — just reattach (no need to re-run command)
        console.log(`[session] Reattaching to live tmux session: ${s.name} (${tmuxName})`);
        const sess = createSession(s.id, s.name, s.cwd);
        // Don't set pendingCmd — the process is still running inside tmux
        sess.resized = false;
      } else {
        // No tmux or tmux session is gone — recreate with command
        const cmd = cmdForSession(s);
        const sess = createSession(s.id, s.name, s.cwd, cmd);
        if (cmd) {
          console.log(`[session] Will run '${cmd}' in restored session '${s.name}' after first resize`);
          sess.pendingCmd = cmd;
          sess.resized = false;
        }
      }
    }
  } catch (e) {
    console.warn('[session] Could not restore sessions:', e);
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────
// ─── DATA WEBSOCKET (per-session terminal I/O) ──────────────────
wssData.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sid') || '';

  // Auth check
  if (isAuthEnabled()) {
    const token = url.searchParams.get('token') || '';
    if (!verifyToken(token)) { ws.close(4001, 'Unauthorized'); return; }
  }

  const session = sessions.get(sessionId);
  if (!session) { ws.close(4002, 'Session not found'); return; }

  // Register this WS for this session's output
  if (!dataWsMap.has(sessionId)) dataWsMap.set(sessionId, new Set());
  dataWsMap.get(sessionId)!.add(ws);
  console.log(`[data-ws] Connected for ${sessionId.slice(-6)} (${dataWsMap.get(sessionId)!.size} clients)`);

  // Send scrollback immediately so client sees current state
  if (session.scrollback) {
    ws.send(session.scrollback);
  }

  // Input from client → PTY
  ws.on('message', (message: Buffer | string) => {
    const s = sessions.get(sessionId);
    if (s) s.pty.write(message.toString());
  });

  ws.on('close', () => {
    const set = dataWsMap.get(sessionId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) dataWsMap.delete(sessionId);
    }
    console.log(`[data-ws] Disconnected for ${sessionId.slice(-6)}`);
  });
});

// ─── CONTROL WEBSOCKET (session mgmt, settings, git, files) ─────
let clientCounter = 0;

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  // Authenticate WebSocket connections
  if (isAuthEnabled()) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';
    if (!verifyToken(token)) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }

  const clientId = ++clientCounter;
  const clientTag = `[ws:client-${clientId}]`;
  console.log(`${clientTag} Client connected (total: ${wss.clients.size})`);

  // Send initial data
  const list = Array.from(sessions.values()).map(s => ({
    id: s.id, name: s.name, createdAt: s.createdAt, cwd: s.cwd,
  }));
  ws.send(JSON.stringify({ type: 'session_list', sessions: list }));
  ws.send(JSON.stringify({ type: 'settings', settings: currentSettings }));
  console.log(`${clientTag} Sent initial data (${list.length} sessions)`);

  ws.on('message', (message: Buffer | string) => {
    const data = message.toString();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(data); } catch { return; }

    // Heartbeat: respond to client pings immediately
    if (parsed.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: parsed.t }));
      return;
    }

    // Log non-trivial messages (skip input/resize for noise reduction)
    if (parsed.type !== 'input' && parsed.type !== 'resize') {
      console.log(`${clientTag} ← ${parsed.type}${parsed.sessionId ? ` [${(parsed.sessionId as string).slice(-6)}]` : ''}`);
    }

    if (parsed.type === 'session_create') {
      const id = `session-${Date.now()}`;
      const nameFormat = currentSettings.shell.sessionNameFormat || 'shell-{n}';
      const name = (parsed.name as string) || nameFormat.replace('{n}', String(sessions.size + 1));
      const sess = createSession(id, name, parsed.cwd as string | undefined);
      wsSession.set(ws, id);
      if (parsed.cmd) {
        sess.cmd = parsed.cmd as string;
        runCmdWhenReady(sess, sess.cmd);
      }

      ws.send(JSON.stringify({ type: 'session_created', sessionId: id, name }));
      broadcastSessionList(); // calls persistSessions() — cmd is set above before this

    } else if (parsed.type === 'session_subscribe') {
      // Subscribe to output without changing the active session
      const ids = parsed.sessionIds as string[];
      if (Array.isArray(ids)) {
        wsSubscriptions.set(ws, new Set(ids.filter(id => sessions.has(id))));
      }

    } else if (parsed.type === 'session_duplicate') {
      const sourceId = parsed.sourceSessionId as string;
      const source = sessions.get(sourceId);
      const id = `session-${Date.now()}`;
      const name = (parsed.name as string) || 'Shell';
      const cwd = source?.cwd || currentSettings.shell.startDirectory || process.env.HOME || '/';
      createSession(id, name, cwd);
      wsSession.set(ws, id);
      ws.send(JSON.stringify({ type: 'session_created', sessionId: id, name }));
      broadcastSessionList();

    } else if (parsed.type === 'session_attach') {
      const id = parsed.sessionId as string;
      if (!sessions.has(id)) {
        ws.send(JSON.stringify({ type: 'error', message: `Session ${id} not found` }));
        return;
      }
      wsSession.set(ws, id);
      // Remove from subscriptions — active session gets output via wsSession
      wsSubscriptions.get(ws)?.delete(id);
      ws.send(JSON.stringify({ type: 'session_attached', sessionId: id }));
      // Replay current CWD/AI info immediately
      const sess = sessions.get(id)!;
      ws.send(JSON.stringify({ type: 'session_info', sessionId: id, cwd: sess.cwd, ai: sess.ai }));
      // Scrollback is now handled by per-session data WS on connect

    // scrollback is now handled by per-session data WS on connect

    } else if (parsed.type === 'session_rename') {
      const id = parsed.sessionId as string;
      const session = sessions.get(id);
      if (session) {
        session.name = (parsed.name as string) || session.name;
        broadcastSessionList();
      }

    } else if (parsed.type === 'session_close') {
      const id = parsed.sessionId as string;
      const session = sessions.get(id);
      if (session) {
        if (session.cwdTimer) clearInterval(session.cwdTimer);
        session.pty.kill();
        if (session.tmuxName) tmuxKillSession(session.tmuxName);
        sessions.delete(id);
        broadcastSessionList();
      }

    } else if (parsed.type === 'input') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (session) session.pty.write(parsed.data as string);

    } else if (parsed.type === 'resize') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (session) {
        session.pty.resize(parsed.cols as number, parsed.rows as number);
        // First resize after restore: now run the pending command at correct terminal size
        if (session.pendingCmd && !session.resized) {
          session.resized = true;
          const cmd = session.pendingCmd;
          session.pendingCmd = undefined;
          console.log(`[session] Running '${cmd}' in '${session.name}' after resize to ${parsed.cols}x${parsed.rows}`);
          runCmdWhenReady(session, cmd);
        }
      }

    } else if (parsed.type === 'git_graph') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      try {
        const commits = gitService.getGitLog(session.cwd);
        ws.send(JSON.stringify({ type: 'git_graph_data', sessionId: id, commits }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'git_graph_data', sessionId: id, commits: [], error: String(e) }));
      }

    } else if (parsed.type === 'git_file_list') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const hash = parsed.hash as string;
      if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) {
        ws.send(JSON.stringify({ type: 'git_file_list_data', hash, files: [], error: 'Invalid hash' }));
        return;
      }
      try {
        const files = gitService.getFileList(session.cwd, hash);
        ws.send(JSON.stringify({ type: 'git_file_list_data', sessionId: id, hash, files }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'git_file_list_data', sessionId: id, hash, files: [], error: String(e) }));
      }

    } else if (parsed.type === 'git_branch') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      try {
        const branch = gitService.getCurrentBranch(session.cwd);
        ws.send(JSON.stringify({ type: 'git_branch_data', sessionId: id, branch }));
      } catch {
        ws.send(JSON.stringify({ type: 'git_branch_data', sessionId: id, branch: null }));
      }

    } else if (parsed.type === 'git_branch_list') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      try {
        const branches = gitService.getBranchList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_branch_list_data', sessionId: id, branches }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'git_branch_list_data', sessionId: id, branches: [], error: String(e) }));
      }

    } else if (parsed.type === 'git_remote_url') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const url = gitService.getRemoteUrl(session.cwd);
      ws.send(JSON.stringify({ type: 'git_remote_url_data', sessionId: id, url }));

    } else if (parsed.type === 'git_checkout') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const branch = parsed.branch as string;
      if (!branch || !/^[a-zA-Z0-9][a-zA-Z0-9/_.\-]*$/.test(branch)) {
        ws.send(JSON.stringify({ type: 'git_checkout_ack', sessionId: id, error: 'Invalid branch name' }));
        return;
      }
      // For remote branches like origin/feature, create a local tracking branch
      let cmd: string;
      if (branch.startsWith('origin/')) {
        const localName = branch.slice(7);
        cmd = `git checkout -b ${localName} --track ${branch}`;
      } else {
        cmd = `git checkout ${branch}`;
      }
      session.pty.write(cmd + '\r');
      ws.send(JSON.stringify({ type: 'git_checkout_ack', sessionId: id, branch }));

    } else if (parsed.type === 'git_pull') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      session.pty.write('git pull\r');
      ws.send(JSON.stringify({ type: 'git_pull_ack', sessionId: id }));

    } else if (parsed.type === 'file_tree') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const targetDir = (parsed.dir as string) || session.cwd;
      try {
        const tree = gitService.getFileTree(targetDir);
        // Include git status for explorer badges
        let gitStatusMap: Record<string, string> = {};
        if (gitService.isGitRepo(targetDir)) {
          const files = gitService.getGitStatus(targetDir);
          for (const f of files) { gitStatusMap[f.path] = f.status; }
        }
        ws.send(JSON.stringify({ type: 'file_tree_data', sessionId: id, dir: targetDir, tree, gitStatus: gitStatusMap }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'file_tree_data', sessionId: id, dir: targetDir, tree: [], error: String(e) }));
      }

    } else if (parsed.type === 'git_status') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      try {
        const isRepo = gitService.isGitRepo(session.cwd);
        if (!isRepo) {
          ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files: [], isRepo: false }));
          return;
        }
        const files = gitService.getGitStatus(session.cwd);
        const branch = gitService.getCurrentBranch(session.cwd);
        const root = gitService.getGitRoot(session.cwd);
        const upstream = gitService.getUpstreamStatus(session.cwd);
        const worktrees = gitService.getWorktreeList(session.cwd);
        // Detect if current session is in a worktree (not main)
        const normalizedCwd = session.cwd.replace(/\/+$/, '');
        const mainWt = worktrees.find(w => w.isMain);
        const isInWorktree = mainWt ? normalizedCwd !== mainWt.path.replace(/\/+$/, '') : false;
        let mainBranchFileCount: number | undefined;
        if (isInWorktree && mainWt) {
          try {
            const mainFiles = gitService.getGitStatus(mainWt.path);
            mainBranchFileCount = mainFiles.length;
          } catch {}
        }
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true, upstream, worktrees, isInWorktree, mainBranchFileCount }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files: [], error: String(e), isRepo: false }));
      }

    } else if (parsed.type === 'git_diff') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const filePath = parsed.filePath as string | undefined;
      const staged = parsed.staged as boolean || false;
      const diff = gitService.getGitDiff(session.cwd, filePath, staged);
      ws.send(JSON.stringify({ type: 'git_diff_data', sessionId: id, filePath, staged, diff }));

    } else if (parsed.type === 'git_stage') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const filePath = parsed.filePath as string;
      const all = parsed.all as boolean || false;
      const ok = all ? gitService.gitStageAll(session.cwd) : gitService.gitStageFile(session.cwd, filePath);
      ws.send(JSON.stringify({ type: 'git_stage_ack', sessionId: id, ok }));
      // Auto-refresh status after staging
      if (ok) {
        const files = gitService.getGitStatus(session.cwd);
        const branch = gitService.getCurrentBranch(session.cwd);
        const root = gitService.getGitRoot(session.cwd);
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true }));
      }

    } else if (parsed.type === 'git_unstage') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const filePath = parsed.filePath as string;
      const all = parsed.all as boolean || false;
      const ok = all ? gitService.gitUnstageAll(session.cwd) : gitService.gitUnstageFile(session.cwd, filePath);
      ws.send(JSON.stringify({ type: 'git_unstage_ack', sessionId: id, ok }));
      if (ok) {
        const files = gitService.getGitStatus(session.cwd);
        const branch = gitService.getCurrentBranch(session.cwd);
        const root = gitService.getGitRoot(session.cwd);
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true }));
      }

    } else if (parsed.type === 'git_commit') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const message = parsed.message as string;
      const result = gitService.gitCommit(session.cwd, message);
      ws.send(JSON.stringify({ type: 'git_commit_ack', sessionId: id, ...result }));
      if (result.ok) {
        // Auto-refresh status after commit
        const files = gitService.getGitStatus(session.cwd);
        const branch = gitService.getCurrentBranch(session.cwd);
        const root = gitService.getGitRoot(session.cwd);
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true }));
        // Commit & Push
        if (parsed.push) {
          const pushResult = gitService.gitPush(session.cwd);
          ws.send(JSON.stringify({ type: 'git_push_ack', sessionId: id, ...pushResult }));
        }
      }

    } else if (parsed.type === 'file_create') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.createFile(session.cwd, parsed.filePath as string, parsed.isDir as boolean);
      ws.send(JSON.stringify({ type: 'file_op_ack', sessionId: id, op: 'create', ...result }));

    } else if (parsed.type === 'file_rename') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.renameFile(session.cwd, parsed.oldPath as string, parsed.newPath as string);
      ws.send(JSON.stringify({ type: 'file_op_ack', sessionId: id, op: 'rename', ...result }));

    } else if (parsed.type === 'file_delete') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.deleteFile(session.cwd, parsed.filePath as string);
      ws.send(JSON.stringify({ type: 'file_op_ack', sessionId: id, op: 'delete', ...result }));

    } else if (parsed.type === 'file_duplicate') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.duplicateFile(session.cwd, parsed.filePath as string);
      ws.send(JSON.stringify({ type: 'file_op_ack', sessionId: id, op: 'duplicate', ...result }));

    } else if (parsed.type === 'file_read') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const filePath = parsed.filePath as string;
      const result = gitService.readFileContent(session.cwd, filePath);
      ws.send(JSON.stringify({ type: 'file_read_data', sessionId: id, filePath, ...result }));

    } else if (parsed.type === 'file_search') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const query = parsed.query as string;
      const results = gitService.searchInFiles(session.cwd, query, {
        caseSensitive: parsed.caseSensitive as boolean,
        useRegex: parsed.useRegex as boolean,
        include: parsed.include as string,
      });
      ws.send(JSON.stringify({ type: 'file_search_data', sessionId: id, results }));

    } else if (parsed.type === 'file_replace') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.replaceInFile(session.cwd, parsed.filePath as string, parsed.query as string, parsed.replacement as string, {
        caseSensitive: parsed.caseSensitive as boolean,
        useRegex: parsed.useRegex as boolean,
      });
      ws.send(JSON.stringify({ type: 'file_replace_ack', sessionId: id, ...result }));

    } else if (parsed.type === 'file_replace_all') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.replaceInAllFiles(session.cwd, parsed.query as string, parsed.replacement as string, {
        caseSensitive: parsed.caseSensitive as boolean,
        useRegex: parsed.useRegex as boolean,
        include: parsed.include as string,
      });
      ws.send(JSON.stringify({ type: 'file_replace_ack', sessionId: id, ...result }));

    } else if (parsed.type === 'git_generate_message') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const message = gitService.generateCommitMessage(session.cwd);
      ws.send(JSON.stringify({ type: 'git_generate_message_data', sessionId: id, message }));

    } else if (parsed.type === 'git_discard') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const filePath = parsed.filePath as string;
      const ok = gitService.gitDiscard(session.cwd, filePath);
      if (ok) {
        const files = gitService.getGitStatus(session.cwd);
        const branch = gitService.getCurrentBranch(session.cwd);
        const root = gitService.getGitRoot(session.cwd);
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true }));
      }

    } else if (parsed.type === 'git_push') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.gitPush(session.cwd);
      ws.send(JSON.stringify({ type: 'git_push_ack', sessionId: id, ...result }));

    } else if (parsed.type === 'git_worktree_list') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      try {
        const worktrees = gitService.getWorktreeList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees: [], error: String(e) }));
      }

    } else if (parsed.type === 'git_worktree_add') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const wtPath = parsed.path as string;
      const branch = parsed.branch as string | undefined;
      const createBranch = parsed.createBranch as boolean | undefined;
      // Resolve relative path from git root, not session.cwd (which may be a worktree)
      const gitRoot = gitService.getGitRoot(session.cwd);
      const addCwd = gitRoot || session.cwd;
      const wtResult = gitService.addWorktree(addCwd, wtPath, branch, createBranch);
      ws.send(JSON.stringify({ type: 'git_worktree_add_ack', sessionId: id, ...wtResult }));
      if (wtResult.ok) {
        const worktrees = gitService.getWorktreeList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
      }

    } else if (parsed.type === 'git_worktree_remove') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const wtPath = parsed.path as string;
      const force = parsed.force as boolean || false;
      const wtResult = gitService.removeWorktree(session.cwd, wtPath, force);
      ws.send(JSON.stringify({ type: 'git_worktree_remove_ack', sessionId: id, ...wtResult }));
      if (wtResult.ok) {
        const worktrees = gitService.getWorktreeList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
      }

    } else if (parsed.type === 'git_worktree_switch') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const wtPath = parsed.path as string;
      const fs = require('fs');
      if (!fs.existsSync(wtPath)) {
        ws.send(JSON.stringify({ type: 'git_worktree_switch_ack', sessionId: id, ok: false, error: 'Path does not exist' }));
        return;
      }
      session.cwd = wtPath;
      if (session.pty) {
        // Use single-quotes for safe shell escaping
        const escaped = wtPath.replace(/'/g, "'\\''");
        session.pty.write(`cd '${escaped}'\r`);
      }
      ws.send(JSON.stringify({ type: 'git_worktree_switch_ack', sessionId: id, ok: true, path: wtPath }));
      // Broadcast session_info so tabs/statusbar/sidebar update
      const infoMsg = JSON.stringify({ type: 'session_info', sessionId: id, cwd: wtPath, ai: session.ai });
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(infoMsg); });
      try {
        const isRepo = gitService.isGitRepo(session.cwd);
        if (isRepo) {
          const files = gitService.getGitStatus(session.cwd);
          const branch = gitService.getCurrentBranch(session.cwd);
          const root = gitService.getGitRoot(session.cwd);
          const upstream = gitService.getUpstreamStatus(session.cwd);
          ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true, upstream }));
        }
      } catch {}
      const worktrees = gitService.getWorktreeList(session.cwd);
      ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));

    } else if (parsed.type === 'claude_usage') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const usage = getClaudeUsage(session.cwd);
      ws.send(JSON.stringify({ type: 'claude_usage_data', sessionId: id, usage }));

    } else if (parsed.type === 'claude_prompts') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      console.log(`[claude_prompts] cwd=${session.cwd} aiPid=${session.aiPid}`);
      const prompts = getClaudePrompts(session.cwd, session.aiPid);
      console.log(`[claude_prompts] found ${prompts.length} prompts`);
      ws.send(JSON.stringify({ type: 'claude_prompts_data', sessionId: id, prompts }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`${clientTag} Disconnected (code: ${code}, reason: ${reason || 'none'}) — remaining clients: ${wss.clients.size - 1}`);
    wsSession.delete(ws);
    wsSubscriptions.delete(ws);
  });
  ws.on('error', (err) => {
    console.error(`${clientTag} Error: ${err.message}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Super Terminal → http://localhost:${PORT}`);
  // 로컬 네트워크 IP 표시
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Network   → http://${net.address}:${PORT}`);
      }
    }
  }
  restoreSessions();
});

// Graceful shutdown — close database
process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
