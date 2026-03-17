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
import * as gitService from './git-service';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const PORT = process.env.PORT || 3000;
const SETTINGS_PATH  = path.join(__dirname, '../../settings.json');
const SESSIONS_PATH  = path.join(__dirname, '../../sessions.json');

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
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return deepMerge(DEFAULT_SETTINGS, JSON.parse(raw));
    }
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function saveSettings(s: typeof DEFAULT_SETTINGS): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2), 'utf-8');
}

let currentSettings = loadSettings();

// ─── HTTP ─────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../client')));

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

  const ptyProcess = pty.spawn(shellPath, ['-i'], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: fs.existsSync(cwd0) ? cwd0 : (process.env.HOME || '/'),
    env: mergedEnv,
  });
  const session: Session = { id, name, pty: ptyProcess, createdAt: Date.now(), cwd: cwd0, ai: null, cmd: restoreCmd };
  sessions.set(id, session);

  // PTY output → clients with this session active OR subscribed
  // Batch rapid output chunks to avoid per-character streaming flicker
  let outputBuf = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_DELAY = 16; // ms — batch within one animation frame

  function flushOutput() {
    flushTimer = null;
    if (!outputBuf) return;
    const msg = JSON.stringify({ type: 'output', sessionId: id, data: outputBuf });
    outputBuf = '';
    wss.clients.forEach(c => {
      const cws = c as WebSocket;
      if (cws.readyState !== WebSocket.OPEN) return;
      const active = wsSession.get(cws) === id;
      const subscribed = wsSubscriptions.get(cws)?.has(id) ?? false;
      if (active || subscribed) cws.send(msg);
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
    sessions.delete(id);
    broadcastSessionList();
  });

  // Poll CWD + detect running AI every 2s (non-blocking)
  session.cwdTimer = setInterval(async () => {
    try {
      const pid = ptyProcess.pid;
      let newCwd = cwd0;
      try {
        const { stdout } = await execFileAsync('lsof', ['-p', String(pid), '-a', '-d', 'cwd', '-Fn'], {
          encoding: 'utf-8', timeout: 500,
        });
        const match = stdout.match(/\nn(.+)/);
        if (match) newCwd = match[1].trim();
      } catch {}

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
        const rootPid = pid;
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
  try {
    const data = Array.from(sessions.values()).map(s => ({
      id: s.id, name: s.name, createdAt: s.createdAt, cwd: s.cwd, cmd: s.cmd,
    }));
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
    id: s.id, name: s.name, createdAt: s.createdAt,
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
    if (!fs.existsSync(SESSIONS_PATH)) return;
    const raw = fs.readFileSync(SESSIONS_PATH, 'utf-8');
    const saved: Array<{ id: string; name: string; createdAt: number; cwd: string; cmd?: string }> = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return;
    console.log(`[session] Restoring ${saved.length} session(s) from disk...`);
    for (const s of saved) {
      const cmd = cmdForSession(s);
      const sess = createSession(s.id, s.name, s.cwd, cmd);
      if (cmd) {
        console.log(`[session] Will run '${cmd}' in restored session '${s.name}' after first resize`);
        // Store as pending — will be executed when client sends first resize (correct terminal size)
        sess.pendingCmd = cmd;
        sess.resized = false;
      }
    }
  } catch (e) {
    console.warn('[session] Could not restore sessions:', e);
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────
wss.on('connection', (ws: WebSocket) => {
  console.log('[ws] Client connected');

  // Send initial data
  const list = Array.from(sessions.values()).map(s => ({
    id: s.id, name: s.name, createdAt: s.createdAt,
  }));
  ws.send(JSON.stringify({ type: 'session_list', sessions: list }));
  ws.send(JSON.stringify({ type: 'settings', settings: currentSettings }));

  ws.on('message', (message: Buffer | string) => {
    const data = message.toString();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(data); } catch { return; }

    if (parsed.type === 'session_create') {
      const id = `session-${Date.now()}`;
      const nameFormat = currentSettings.shell.sessionNameFormat || 'shell-{n}';
      const name = (parsed.name as string) || nameFormat.replace('{n}', String(sessions.size + 1));
      const sess = createSession(id, name);
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

    } else if (parsed.type === 'claude_usage') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const usage = getClaudeUsage(session.cwd);
      ws.send(JSON.stringify({ type: 'claude_usage_data', sessionId: id, usage }));
    }
  });

  ws.on('close', () => { wsSession.delete(ws); wsSubscriptions.delete(ws); });
  ws.on('error', (err) => { console.error('[ws] Error:', err.message); });
});

server.listen(PORT, () => {
  console.log(`Super Terminal → http://localhost:${PORT}`);
  restoreSessions();
});
