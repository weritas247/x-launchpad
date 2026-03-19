import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.dev' });

// ─── Global error handlers ───────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  const code = (reason as any)?.code;
  if (code === 'PGRST205' || code === 'PGRST116') {
    console.warn(
      '[supabase] Background query failed (table may not exist yet):',
      (reason as any)?.message
    );
    return;
  }
  console.error('[UnhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err.message, err.stack);
  // Give time for error to be logged, then exit
  setTimeout(() => process.exit(1), 100);
});

import express from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

import * as db from './db';
import * as userDb from './supabase';
import * as bcrypt from 'bcryptjs';

// ─── Extracted modules ───────────────────────────────────────────
import {
  DEFAULT_SETTINGS,
  AppSettings,
  loadSettings,
  saveSettings as saveSettingsToStore,
} from './config';
import {
  tmuxAvailable,
  TMUX_SOCKET,
  tmuxSessionExists,
  tmuxCreateSession,
  tmuxGetCwd,
  tmuxGetPanePid,
  tmuxListSessions,
} from './tmux';
import {
  isAuthEnabled,
  isSetupRequired,
  isRegistrationAllowed,
  getAuthMode,
  verifyToken,
  getTokenPayload,
  issueJwt,
  extractToken,
  authMiddleware,
  checkRateLimit,
  recordAuthFailure,
  tokenAuthEnabled,
  BCRYPT_ROUNDS,
} from './auth';
import {
  dispatch,
  shouldLogMessage,
  type WsContext,
  type Session as WsSession,
} from './ws-handlers';
import { env } from './env';
import { createPlansRouter } from './routes/plans';

// ─── Server setup ────────────────────────────────────────────────
/** Safe WebSocket send — no-ops if socket is not OPEN */
function wsSend(ws: WebSocket, data: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const wssData = new WebSocketServer({ noServer: true });

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

const PORT = env.PORT;
const SETTINGS_PATH = path.join(__dirname, '../../settings.json');
const SESSIONS_PATH = path.join(__dirname, '../../sessions.json');

// ─── Settings ────────────────────────────────────────────────────
let currentSettings = loadSettings(SETTINGS_PATH);

function saveSettings(s: AppSettings): void {
  saveSettingsToStore(s, SETTINGS_PATH);
}

// ─── HTTP ────────────────────────────────────────────────────────
// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json());

// Health check — unauthenticated, for load balancers and monitoring
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

app.use(authMiddleware);
app.use(express.static(path.join(__dirname, '../../client')));

// Auth endpoints
app.post('/api/auth/login', async (req, res) => {
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

app.post('/api/auth/register', async (req, res) => {
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

app.get('/api/auth/check', async (req, res) => {
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

app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/login.html'));
});

// Settings endpoints
app.get('/api/settings', (_req, res) => {
  res.json(currentSettings);
});
app.post('/api/settings', (req, res) => {
  try {
    currentSettings = req.body as AppSettings;
    saveSettings(currentSettings);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});
app.get('/api/settings/default', (_req, res) => {
  res.json(DEFAULT_SETTINGS);
});

// ─── PLANS API (extracted to routes/plans.ts) ───────────────────
app.use('/api/plans', createPlansRouter(wss));

// ─── IMAGE UPLOAD ────────────────────────────────────────────────
app.post(
  '/api/upload-image',
  express.raw({ type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'], limit: '20mb' }),
  (req, res) => {
    const sessionId = req.query.sessionId as string;
    const originalName = req.query.filename as string;
    if (!sessionId || !originalName)
      return res.status(400).json({ ok: false, error: 'Missing sessionId or filename' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const targetDir =
      session.cwd && fs.existsSync(session.cwd)
        ? session.cwd
        : currentSettings.shell.startDirectory || env.HOME;
    const ext = path.extname(originalName).toLowerCase() || '.png';
    const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
    if (!allowedExts.includes(ext))
      return res.status(400).json({ ok: false, error: 'Unsupported image format' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23);
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

app.post('/api/delete-image', (req, res) => {
  const filePath = req.body?.filePath as string;
  if (!filePath || !filePath.includes('pasted-image-')) return res.status(400).json({ ok: false });
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ─── FILE OPERATIONS ─────────────────────────────────────────────
app.post('/api/reveal-in-finder', (req, res) => {
  const sessionId = req.body?.sessionId as string;
  if (!sessionId) return res.status(400).json({ ok: false });
  const session = sessions.get(sessionId);
  const dir = session?.cwd || currentSettings.shell.startDirectory || env.HOME;
  if (!fs.existsSync(dir)) return res.status(404).json({ ok: false });
  execFile('open', [dir], (err) => {
    if (err) return res.status(500).json({ ok: false, error: String(err) });
    res.json({ ok: true });
  });
});

app.get('/api/download', (req, res) => {
  const sessionId = req.query.sessionId as string;
  const filePath = req.query.path as string;
  if (!sessionId || !filePath) return res.status(400).json({ ok: false, error: 'Missing params' });
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
  const cwd = session.cwd || env.HOME;
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd)))
    return res.status(403).json({ ok: false, error: 'Access denied' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ ok: false, error: 'File not found' });
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory())
    return res.status(400).json({ ok: false, error: 'Cannot download directory' });
  if (stat.size > 50 * 1024 * 1024)
    return res.status(413).json({ ok: false, error: 'File too large (>50MB)' });
  res.download(fullPath);
});

app.post(
  '/api/upload',
  express.raw({ type: 'application/octet-stream', limit: '50mb' }),
  (req, res) => {
    const sessionId = req.query.sessionId as string;
    const fileName = req.query.filename as string;
    const targetDir = req.query.dir as string | undefined;
    if (!sessionId || !fileName)
      return res.status(400).json({ ok: false, error: 'Missing params' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'Session not found' });
    const cwd = session.cwd || env.HOME;
    const dir = targetDir ? path.resolve(cwd, targetDir) : cwd;
    if (!dir.startsWith(path.resolve(cwd)))
      return res.status(403).json({ ok: false, error: 'Access denied' });
    const safeName = path.basename(fileName);
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

// Global Express error handler — catches unhandled errors in route handlers
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[express] Unhandled error:', err.message, err.stack);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

// ─── SESSION MANAGEMENT ──────────────────────────────────────────
const SCROLLBACK_LIMIT = 128 * 1024;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');

interface Session {
  id: string;
  name: string;
  pty: pty.IPty;
  createdAt: number;
  cwd: string;
  ai: string | null;
  aiPid: number | null;
  cmd?: string;
  cwdTimer?: ReturnType<typeof setInterval>;
  pendingCmd?: string;
  resized?: boolean;
  scrollback: string;
  tmuxName?: string;
}

const sessions = new Map<string, Session>();
const wsSession = new Map<WebSocket, string>();
const wsSubscriptions = new Map<WebSocket, Set<string>>();
const dataWsMap = new Map<string, Set<WebSocket>>();

function createSession(
  id: string,
  name: string,
  restoreCwd?: string,
  restoreCmd?: string,
  extraEnv?: Record<string, string>
): Session {
  const s = currentSettings.shell;
  const shellPath = s.shellPath || (os.platform() === 'win32' ? 'powershell.exe' : env.SHELL);
  const mergedEnv = {
    ...(process.env as Record<string, string>),
    ...s.env,
    ...(extraEnv || {}),
    LANG: process.env.LANG && process.env.LANG.includes('UTF') ? process.env.LANG : 'en_US.UTF-8',
    LC_ALL:
      process.env.LC_ALL && process.env.LC_ALL.includes('UTF') ? process.env.LC_ALL : 'en_US.UTF-8',
    LC_CTYPE:
      process.env.LC_CTYPE && process.env.LC_CTYPE.includes('UTF')
        ? process.env.LC_CTYPE
        : 'en_US.UTF-8',
    TERM: 'xterm-256color',
  };
  const cwd0 = restoreCwd || s.startDirectory || env.HOME;
  const tmuxName = id.replace(/[.:]/g, '-');
  const useTmux = tmuxAvailable;

  let ptyProcess: pty.IPty;
  if (useTmux) {
    if (!tmuxSessionExists(tmuxName)) {
      tmuxCreateSession(tmuxName, cwd0, shellPath);
      console.log(`[tmux] Created session: ${tmuxName}`);
    } else {
      console.log(`[tmux] Reattaching to existing session: ${tmuxName}`);
    }
    ptyProcess = pty.spawn('tmux', ['-S', TMUX_SOCKET, 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: fs.existsSync(cwd0) ? cwd0 : env.HOME,
      env: mergedEnv,
    });
  } else {
    ptyProcess = pty.spawn(shellPath, ['-i'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: fs.existsSync(cwd0) ? cwd0 : env.HOME,
      env: mergedEnv,
    });
  }

  const session: Session = {
    id,
    name,
    pty: ptyProcess,
    createdAt: Date.now(),
    cwd: cwd0,
    ai: null,
    aiPid: null,
    cmd: restoreCmd,
    scrollback: '',
    tmuxName: useTmux ? tmuxName : undefined,
  };
  sessions.set(id, session);

  // PTY output batching
  let outputBuf = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY = 16;

  function flushOutput() {
    flushTimer = null;
    if (!outputBuf) return;
    session.scrollback += outputBuf;
    if (session.scrollback.length > SCROLLBACK_LIMIT) {
      session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
    }
    const data = outputBuf;
    outputBuf = '';
    const clients = dataWsMap.get(id);
    if (!clients || clients.size === 0) return;
    clients.forEach((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if ((ws as any).bufferedAmount > 1024 * 1024) return;
      ws.send(data);
    });
  }

  const ptyDataSub = ptyProcess.onData((chunk: string) => {
    const filtered = chunk
      .replace(/\x1b\]1337;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1bP[pq][^\x1b]*\x1b\\/g, '');
    if (!filtered) return;
    outputBuf += filtered;
    if (outputBuf.length > 64 * 1024) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flushOutput();
      return;
    }
    if (!flushTimer) flushTimer = setTimeout(flushOutput, FLUSH_DELAY);
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[session] ${id} exited: ${exitCode}`);
    if (session.cwdTimer) clearInterval(session.cwdTimer);
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    ptyDataSub.dispose();
    const dataClients = dataWsMap.get(id);
    if (dataClients) {
      dataClients.forEach((ws) => ws.close(1000, 'Session ended'));
      dataWsMap.delete(id);
    }
    if (session.tmuxName && tmuxSessionExists(session.tmuxName)) {
      console.log(
        `[tmux] PTY detached but tmux session '${session.tmuxName}' still alive — keeping`
      );
      return;
    }
    sessions.delete(id);
    broadcastSessionList();
  });

  // Poll CWD + detect running AI
  const CWD_POLL_ACTIVE = 2000;
  const CWD_POLL_BG = 10000;
  let lastPollTime = 0;
  session.cwdTimer = setInterval(() => {
    const isActive = Array.from(wsSession.values()).includes(id);
    const interval = isActive ? CWD_POLL_ACTIVE : CWD_POLL_BG;
    const now = Date.now();
    if (now - lastPollTime < interval) return;
    lastPollTime = now;
    void (async () => {
      try {
        let newCwd = cwd0;
        let shellPid = ptyProcess.pid;
        if (session.tmuxName) {
          const tmuxCwd = tmuxGetCwd(session.tmuxName);
          if (tmuxCwd) newCwd = tmuxCwd;
          const panePid = tmuxGetPanePid(session.tmuxName);
          if (panePid) shellPid = panePid;
        } else {
          try {
            const { stdout } = await execFileAsync(
              'lsof',
              ['-p', String(shellPid), '-a', '-d', 'cwd', '-Fn'],
              { encoding: 'utf-8', timeout: 500 }
            );
            const match = stdout.match(/\nn(.+)/);
            if (match) newCwd = match[1].trim();
          } catch {}
        }
        let newAi: string | null = null;
        let newAiPid: number | null = null;
        try {
          const { stdout: psOut } = await execFileAsync('ps', ['-eo', 'pid,ppid,args'], {
            encoding: 'utf-8',
            timeout: 800,
          });
          const rows = psOut.trim().split('\n').slice(1);
          const parentOf = new Map<number, number>();
          const cmdOf = new Map<number, string>();
          for (const row of rows) {
            const m = row.trim().match(/^(\d+)\s+(\d+)\s+(.*)/);
            if (m) {
              parentOf.set(parseInt(m[1]), parseInt(m[2]));
              cmdOf.set(parseInt(m[1]), m[3]);
            }
          }
          const rootPid = shellPid;
          const descendants = new Set<number>([rootPid]);
          for (const [p, pp] of parentOf) {
            let cur = pp;
            const visited = new Set<number>();
            while (cur !== 0 && !visited.has(cur)) {
              visited.add(cur);
              if (cur === rootPid) {
                descendants.add(p);
                break;
              }
              cur = parentOf.get(cur) ?? 0;
            }
          }
          const aiCandidates: { pid: number; ai: string }[] = [];
          for (const dp of descendants) {
            const cmd = (cmdOf.get(dp) || '').toLowerCase();
            if (/claude/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'claude' });
            else if (/chatgpt/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'chatgpt' });
            else if (/\/gemini(\s|$)/.test(cmd) || /bin\/gemini/.test(cmd))
              aiCandidates.push({ pid: dp, ai: 'gemini' });
            else if (/copilot/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'copilot' });
            else if (/aider/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'aider' });
            else if (/cursor/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'cursor' });
            else if (/opencode/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'opencode' });
            else if (/codex/.test(cmd)) aiCandidates.push({ pid: dp, ai: 'codex' });
          }
          if (aiCandidates.length > 0) {
            const claudeCandidates = aiCandidates.filter((c) => c.ai === 'claude');
            if (claudeCandidates.length > 0) {
              newAi = 'claude';
              const sessDir = path.join(CLAUDE_DIR, 'sessions');
              const matched = claudeCandidates.find((c) =>
                fs.existsSync(path.join(sessDir, `${c.pid}.json`))
              );
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
          const msg = JSON.stringify({
            type: 'session_info',
            sessionId: id,
            cwd: newCwd,
            ai: newAi,
          });
          wss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) c.send(msg);
          });
        }
      } catch (e) {
        console.error(`[cwd-poll] Error for ${id}:`, e);
      }
    })();
  }, 2000);

  console.log(`[session] Created: ${id} (${name})`);
  return session;
}

function persistSessions() {
  const data = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    cwd: s.cwd,
    cmd: s.cmd,
  }));
  try {
    db.saveSessions(data);
  } catch {}
  try {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

function broadcastSessionList(exclude?: WebSocket) {
  persistSessions();
  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    cwd: s.cwd,
  }));
  const msg = JSON.stringify({ type: 'session_list', sessions: list });
  wss.clients.forEach((client) => {
    if (client !== exclude && client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ─── RESTORE SESSIONS ON STARTUP ─────────────────────────────────
const NAME_TO_CMD: Record<string, string> = {
  claude: 'claude --dangerously-skip-permissions',
  gemini: 'gemini',
  codex: 'codex',
  opencode: 'opencode',
  aider: 'aider',
  copilot: 'copilot',
};

function cmdForSession(s: { name: string; cmd?: string }): string | undefined {
  if (s.cmd) return s.cmd;
  return NAME_TO_CMD[s.name.toLowerCase()];
}

function restoreSessions() {
  try {
    let saved: Array<{ id: string; name: string; createdAt: number; cwd: string; cmd?: string }>;
    const dbSessions = db.listSessions();
    if (dbSessions.length > 0) {
      saved = dbSessions.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        cwd: r.cwd,
        cmd: r.cmd || undefined,
      }));
    } else if (fs.existsSync(SESSIONS_PATH)) {
      saved = JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'));
    } else {
      return;
    }
    if (!Array.isArray(saved) || saved.length === 0) return;
    const liveTmux = tmuxAvailable ? new Set(tmuxListSessions()) : new Set<string>();
    console.log(`[session] Restoring ${saved.length} session(s) from disk...`);
    for (const s of saved) {
      const tmuxName = s.id.replace(/[.:]/g, '-');
      const tmuxAlive = liveTmux.has(tmuxName);
      if (tmuxAvailable && tmuxAlive) {
        console.log(`[session] Reattaching to live tmux session: ${s.name} (${tmuxName})`);
        const sess = createSession(s.id, s.name, s.cwd);
        sess.resized = false;
      } else {
        const cmd = cmdForSession(s);
        const sess = createSession(s.id, s.name, s.cwd, cmd);
        if (cmd) {
          console.log(
            `[session] Will run '${cmd}' in restored session '${s.name}' after first resize`
          );
          sess.pendingCmd = cmd;
          sess.resized = false;
        }
      }
    }
  } catch (e) {
    console.warn('[session] Could not restore sessions:', e);
  }
}

// ─── DATA WEBSOCKET (per-session terminal I/O) ──────────────────
wssData.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sid') || '';
  if (isAuthEnabled()) {
    const token = url.searchParams.get('token') || '';
    if (!verifyToken(token)) {
      ws.close(4001, 'Unauthorized');
      return;
    }
  }
  const session = sessions.get(sessionId);
  if (!session) {
    ws.close(4002, 'Session not found');
    return;
  }
  if (!dataWsMap.has(sessionId)) dataWsMap.set(sessionId, new Set());
  dataWsMap.get(sessionId)!.add(ws);
  console.log(
    `[data-ws] Connected for ${sessionId.slice(-6)} (${dataWsMap.get(sessionId)!.size} clients)`
  );
  if (session.scrollback) ws.send(session.scrollback);
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
  ws.on('error', (err) => {
    console.error(`[data-ws] Error for ${sessionId.slice(-6)}:`, err.message);
  });
});

// ─── CONTROL WEBSOCKET ───────────────────────────────────────────
let clientCounter = 0;

wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
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

  const list = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    cwd: s.cwd,
  }));
  wsSend(ws, JSON.stringify({ type: 'session_list', sessions: list }));
  wsSend(ws, JSON.stringify({ type: 'settings', settings: currentSettings }));

  ws.on('message', (message: Buffer | string) => {
    const data = message.toString();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    const type = parsed.type as string;
    if (shouldLogMessage(type)) {
      console.log(
        `${clientTag} ← ${type}${parsed.sessionId ? ` [${(parsed.sessionId as string).slice(-6)}]` : ''}`
      );
    }

    const ctx: WsContext = {
      ws,
      wss,
      sessions: sessions as Map<string, WsSession>,
      wsSession,
      wsSubscriptions,
      dataWsMap,
      currentSettings,
      createSession,
      broadcastSessionList,
      wsSend,
    };

    dispatch(ctx, parsed);
  });

  ws.on('close', (code, reason) => {
    console.log(
      `${clientTag} Disconnected (code: ${code}, reason: ${reason || 'none'}) — remaining clients: ${wss.clients.size - 1}`
    );
    wsSession.delete(ws);
    wsSubscriptions.delete(ws);
  });
  ws.on('error', (err) => {
    console.error(`${clientTag} Error: ${err.message}`);
  });
});

// ─── SERVER STARTUP ──────────────────────────────────────────────
async function startServer() {
  try {
    await userDb.initUserCount();
    await userDb.ensurePlanImagesBucket();
    console.log(
      `[auth] Email auth: ${userDb.getUserCount()} registered user(s), registration ${isRegistrationAllowed() ? 'allowed' : 'locked'}`
    );
  } catch (err) {
    console.error('[supabase] Failed to initialize user count:', err);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Super Terminal → http://localhost:${PORT}`);
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]!) {
        if (net.family === 'IPv4' && !net.internal)
          console.log(`  Network   → http://${net.address}:${PORT}`);
      }
    }
    restoreSessions();
  });
}
startServer();

// Graceful shutdown — persist state and clean up resources
function shutdown(signal: string) {
  console.log(`[shutdown] Received ${signal}, cleaning up...`);
  try {
    persistSessions();
  } catch {}
  try {
    // Close all WebSocket connections gracefully
    wss.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
    wssData.clients.forEach((ws) => ws.close(1001, 'Server shutting down'));
  } catch {}
  try {
    db.close();
  } catch {}
  server.close(() => {
    console.log(`[shutdown] Server closed`);
    process.exit(0);
  });
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    console.warn('[shutdown] Forced exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
