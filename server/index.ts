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

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const SETTINGS_PATH  = path.join(__dirname, '../../settings.json');
const SESSIONS_PATH  = path.join(__dirname, '../../sessions.json');

// ─── TMUX INTEGRATION ────────────────────────────────────────────
const TMUX_SOCKET = path.join(os.tmpdir(), 'super-terminal-tmux');
let tmuxAvailable = false;
try {
  execSync('tmux -V', { stdio: 'ignore' });
  tmuxAvailable = true;
  console.log(`[tmux] Available — socket: ${TMUX_SOCKET}`);
} catch {
  console.log('[tmux] Not found — falling back to direct PTY');
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
    fontFamily: '"JetBrains Mono", "Share Tech Mono", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorStyle: 'block',
    cursorBlink: true,
    backgroundOpacity: 1.0,
    crtScanlines: true,
    crtScanlinesIntensity: 0.07,
    crtFlicker: true,
    vignette: true,
    glowIntensity: 1.0,
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
    newSession: 'Ctrl+t',
    closeSession: 'Ctrl+w',
    nextTab: 'Ctrl+Shift+]',
    prevTab: 'Ctrl+Shift+[',
    openSettings: 'Meta+,',
    fullscreen: 'F11',
    renameSession: 'Ctrl+Shift+r',
    clearTerminal: 'Meta+k',
    splitSession: '',
    gitGraph: 'Ctrl+g',
    toggleSidebar: 'Ctrl+b',
    focusSearch: 'Ctrl+Shift+f',
    focusExplorer: 'Ctrl+Shift+e',
    focusSourceControl: 'Ctrl+Shift+g',
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
const authEnabled = AUTH_TOKEN.length > 0;

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
  if (!authEnabled) return true;
  if (!token || token.length !== AUTH_TOKEN.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(AUTH_TOKEN));
  } catch {
    return false;
  }
}

function extractToken(req: express.Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return (req.query.token as string) || '';
}

// Auth middleware — skip for login page and static assets
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!authEnabled) return next();
  // Allow login endpoint and static assets without auth
  if (req.path === '/api/auth/login' || req.path === '/api/auth/check') return next();
  // Allow the login page itself
  if (req.path === '/login' || req.path === '/login.html') return next();

  const token = extractToken(req);
  if (verifyToken(token)) return next();

  // For API calls, return 401; for page loads, redirect to login
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
  } else if (req.path === '/' || req.path === '/index.html') {
    res.redirect('/login');
  } else {
    // Allow static assets (CSS, JS, icons) without auth so login page works
    next();
  }
}

if (authEnabled) {
  console.log('[auth] Token authentication enabled');
}

// ─── HTTP ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(authMiddleware);
app.use(express.static(path.join(__dirname, '../../client')));

// Auth endpoints
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
  }
  const token = req.body?.token as string;
  if (verifyToken(token)) {
    res.json({ ok: true });
  } else {
    recordAuthFailure(ip);
    res.status(401).json({ ok: false, error: 'Invalid token' });
  }
});

app.get('/api/auth/check', (req, res) => {
  if (!authEnabled) return res.json({ ok: true, authEnabled: false });
  const token = extractToken(req);
  res.json({ ok: verifyToken(token), authEnabled: true });
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
  return cwd.replace(/\//g, '-');
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

// ─── SESSION MANAGEMENT ───────────────────────────────────────────
const SCROLLBACK_LIMIT = 128 * 1024; // keep last 128KB of output per session

interface Session {
  id: string;
  name: string;
  pty: pty.IPty;
  createdAt: number;
  cwd: string;
  ai: string | null;
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
  const session: Session = { id, name, pty: ptyProcess, createdAt: Date.now(), cwd: cwd0, ai: null, cmd: restoreCmd, scrollback: '', tmuxName: useTmux ? tmuxName : undefined };
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
    // Accumulate scrollback for reconnect replay
    session.scrollback += outputBuf;
    if (session.scrollback.length > SCROLLBACK_LIMIT) {
      session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
    }
    // Build binary frame: [0x01][sessionId-len:u16][sessionId][data]
    const dataBuf = Buffer.from(outputBuf, 'utf-8');
    const frame = Buffer.concat([binHeader, dataBuf]);
    const byteLen = outputBuf.length;
    outputBuf = '';
    let sentCount = 0;
    wss.clients.forEach(c => {
      const cws = c as WebSocket;
      if (cws.readyState !== WebSocket.OPEN) return;
      const active = wsSession.get(cws) === id;
      const subscribed = wsSubscriptions.get(cws)?.has(id) ?? false;
      if (active || subscribed) { cws.send(frame); sentCount++; }
    });
    if (sentCount === 0 && wss.clients.size > 0) {
      console.warn(`[pty:${id.slice(-6)}] Output dropped (${byteLen}B) — no active/subscribed client`);
    }
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

  // Poll CWD + detect running AI every 2s (non-blocking)
  session.cwdTimer = setInterval(async () => {
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
        for (const dp of descendants) {
          const cmd = (cmdOf.get(dp) || '').toLowerCase();
          if (/claude/.test(cmd)) { newAi = 'claude'; break; }
          if (/chatgpt/.test(cmd)) { newAi = 'chatgpt'; break; }
          if (/\/gemini(\s|$)/.test(cmd) || /bin\/gemini/.test(cmd)) { newAi = 'gemini'; break; }
          if (/copilot/.test(cmd)) { newAi = 'copilot'; break; }
          if (/aider/.test(cmd)) { newAi = 'aider'; break; }
          if (/cursor/.test(cmd)) { newAi = 'cursor'; break; }
          if (/opencode/.test(cmd)) { newAi = 'opencode'; break; }
          if (/codex/.test(cmd)) { newAi = 'codex'; break; }
        }
      } catch {}

      if (newCwd !== session.cwd || newAi !== session.ai) {
        session.cwd = newCwd;
        session.ai = newAi;
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
let clientCounter = 0;

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  // Authenticate WebSocket connections
  if (authEnabled) {
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

    } else if (parsed.type === 'scrollback_request') {
      const id = parsed.sessionId as string;
      const session = sessions.get(id);
      if (session && session.scrollback) {
        // Send scrollback via binary frame (same format as output)
        const sidBuf = Buffer.from(id, 'utf-8');
        const hdr = Buffer.alloc(1 + 2 + sidBuf.length);
        hdr[0] = 0x02; // type: scrollback replay
        hdr.writeUInt16BE(sidBuf.length, 1);
        sidBuf.copy(hdr, 3);
        const dataBuf = Buffer.from(session.scrollback, 'utf-8');
        ws.send(Buffer.concat([hdr, dataBuf]));
      }

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
        ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true, upstream }));
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

server.listen(PORT, () => {
  console.log(`Super Terminal → http://localhost:${PORT}`);
  restoreSessions();
});

// Graceful shutdown — close database
process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });
