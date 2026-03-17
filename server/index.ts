import express from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import * as os from 'os';

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
    newSession: 'Ctrl+Shift+T',
    closeSession: 'Ctrl+Shift+W',
    nextTab: 'Ctrl+Tab',
    prevTab: 'Ctrl+Shift+Tab',
    openSettings: 'Ctrl+,',
    fullscreen: 'F11',
  },
  advanced: {
    customCss: '',
    wsReconnectInterval: 3000,
    logLevel: 'info',
  },
};

// ─── SETTINGS PERSISTENCE ─────────────────────────────────────────
function loadSettings(): typeof DEFAULT_SETTINGS {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      return JSON.parse(raw);
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

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

// ─── SESSION MANAGEMENT ───────────────────────────────────────────
interface Session {
  id: string;
  name: string;
  pty: pty.IPty;
  createdAt: number;
  cwd: string;
  ai: string | null;
  cwdTimer?: ReturnType<typeof setInterval>;
}

const sessions = new Map<string, Session>();
const wsSession = new Map<WebSocket, string>();

function createSession(id: string, name: string, restoreCwd?: string): Session {
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

  const ptyProcess = pty.spawn(shellPath, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: fs.existsSync(cwd0) ? cwd0 : (process.env.HOME || '/'),
    env: mergedEnv,
  });
  const session: Session = { id, name, pty: ptyProcess, createdAt: Date.now(), cwd: cwd0, ai: null };
  sessions.set(id, session);

  // PTY output → all WS clients that have this session active
  ptyProcess.onData((chunk: string) => {
    const msg = JSON.stringify({ type: 'output', sessionId: id, data: chunk });
    wss.clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN && wsSession.get(c as WebSocket) === id) {
        (c as WebSocket).send(msg);
      }
    });
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[session] ${id} exited: ${exitCode}`);
    if (session.cwdTimer) clearInterval(session.cwdTimer);
    sessions.delete(id);
    broadcastSessionList();
  });

  // Poll CWD + detect running AI every 2s
  session.cwdTimer = setInterval(() => {
    try {
      const pid = ptyProcess.pid;
      // macOS: lsof -p <pid> to get cwd
      const { execSync } = require('child_process') as typeof import('child_process');
      let newCwd = cwd0;
      try {
        const out = execSync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null`, { encoding: 'utf-8', timeout: 500 });
        const match = out.match(/\nn(.+)/);
        if (match) newCwd = match[1].trim();
      } catch {}

      // Detect AI process in full process tree under this PTY
      // Use 'args' (full command line) instead of 'comm' so node-based CLIs are identifiable
      let newAi: string | null = null;
      try {
        const psOut = execSync(`ps -eo pid,ppid,args 2>/dev/null`, { encoding: 'utf-8', timeout: 800 });
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
        // Walk ancestors to find descendants of rootPid
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
        }
      } catch {}

      if (newCwd !== session.cwd || newAi !== session.ai) {
        session.cwd = newCwd;
        session.ai = newAi;
        // Broadcast updated session info
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
      id: s.id, name: s.name, createdAt: s.createdAt, cwd: s.cwd,
    }));
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
function restoreSessions() {
  try {
    if (!fs.existsSync(SESSIONS_PATH)) return;
    const raw = fs.readFileSync(SESSIONS_PATH, 'utf-8');
    const saved: Array<{ id: string; name: string; createdAt: number; cwd: string }> = JSON.parse(raw);
    if (!Array.isArray(saved) || saved.length === 0) return;
    console.log(`[session] Restoring ${saved.length} session(s) from disk...`);
    for (const s of saved) {
      createSession(s.id, s.name, s.cwd);
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
      createSession(id, name);
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
      if (session) session.pty.resize(parsed.cols as number, parsed.rows as number);
    }
  });

  ws.on('close', () => { wsSession.delete(ws); });
  ws.on('error', (err) => { console.error('[ws] Error:', err.message); });
});

server.listen(PORT, () => {
  console.log(`Claude Web Terminal → http://localhost:${PORT}`);
  restoreSessions();
});
