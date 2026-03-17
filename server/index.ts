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
  ptyProcess.onData((chunk: string) => {
    const msg = JSON.stringify({ type: 'output', sessionId: id, data: chunk });
    wss.clients.forEach(c => {
      const cws = c as WebSocket;
      if (cws.readyState !== WebSocket.OPEN) return;
      const active = wsSession.get(cws) === id;
      const subscribed = wsSubscriptions.get(cws)?.has(id) ?? false;
      if (active || subscribed) cws.send(msg);
    });
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
    }
  });

  ws.on('close', () => { wsSession.delete(ws); wsSubscriptions.delete(ws); });
  ws.on('error', (err) => { console.error('[ws] Error:', err.message); });
});

server.listen(PORT, () => {
  console.log(`Super Terminal → http://localhost:${PORT}`);
  restoreSessions();
});
