import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env.dev') });

import express from 'express';
import http from 'http';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { ProcessManager } from './process-manager';
import { PortSwitcher } from './port-switcher';
import { StatsCollector } from './stats-collector';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '3001');
const CONTROL_HOST = process.env.CONTROL_HOST || '127.0.0.1';
const APP_PORT = parseInt(process.env.APP_PORT || process.env.PORT || '3000');
const AUTO_START = process.env.AUTO_START === '1';
const SKIP_PORT_SWITCHER = process.env.SKIP_PORT_SWITCHER === '1';

const app = express();
const server = http.createServer(app);

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

const pm = new ProcessManager(PROJECT_ROOT);
const portSwitcher = new PortSwitcher(APP_PORT, CONTROL_PORT, CONTROL_HOST, PROJECT_ROOT);
const stats = new StatsCollector(APP_PORT);

// WebSocket (origin 검증)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info: { origin: string; secure: boolean; req: http.IncomingMessage }) => {
    const origin = info.origin || '';
    return origin.includes('localhost') || origin.includes('127.0.0.1') || !origin;
  },
});
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  broadcastState();
});

function broadcast(msg: object): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

async function broadcastState(): Promise<void> {
  const state = pm.getState();
  const s = await stats.collect(state.pid);
  broadcast({
    type: 'status',
    running: state.running,
    starting: state.starting,
    pid: state.pid,
    uptime: pm.getUptime(),
    exitCode: state.exitCode,
    exitSignal: state.exitSignal,
    cpu: s.cpu,
    memory: s.memory,
    sessions: s.sessions,
  });
}

setInterval(broadcastState, 1000);

pm.on('state', () => broadcastState());
pm.on('log', (line: string) => {
  broadcast({ type: 'log', line });
  process.stdout.write(line.endsWith('\n') ? line : line + '\n');
});
pm.on('started', async () => {
  broadcast({ type: 'started' });
  await portSwitcher.release();
});
pm.on('start_failed', (reason: string) => {
  broadcast({ type: 'start_failed', reason });
  portSwitcher.bind();
});
pm.on('exit', () => {
  portSwitcher.bind();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/release-port', async (_req, res) => {
  if (portSwitcher.isBound()) {
    await portSwitcher.release();
    res.json({ ok: true, message: 'Port released' });
  } else {
    res.json({ ok: true, message: 'Port was not bound' });
  }
});

app.get('/api/status', async (_req, res) => {
  const state = pm.getState();
  const s = await stats.collect(state.pid);
  res.json({
    running: state.running,
    starting: state.starting,
    pid: state.pid,
    uptime: pm.getUptime(),
    port: APP_PORT,
    exitCode: state.exitCode,
    exitSignal: state.exitSignal,
    cpu: s.cpu,
    memory: s.memory,
    sessions: s.sessions,
  });
});

app.post('/api/start', async (_req, res) => {
  const state = pm.getState();
  if (state.running || state.starting) {
    res.status(409).json({ error: 'Already running or starting' });
    return;
  }
  res.json({ ok: true, message: 'Starting...' });
  // 응답 전송 후 비동기로 release + start (port-switcher 해제 전에 응답 완료)
  setImmediate(async () => {
    try {
      await portSwitcher.release();
      await pm.start();
    } catch (err: any) {
      console.error('[control] Start failed:', err.message);
    }
  });
});

app.post('/api/stop', async (_req, res) => {
  const state = pm.getState();
  if (!state.running && !state.starting) {
    res.status(409).json({ error: 'Not running' });
    return;
  }
  try {
    await pm.stop();
    res.json({ ok: true, message: 'Stopped' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restart', async (_req, res) => {
  res.json({ ok: true, message: 'Restarting...' });
  setImmediate(async () => {
    try {
      await pm.stop();
      await portSwitcher.release();
      await pm.start();
    } catch (err: any) {
      console.error('[control] Restart failed:', err.message);
    }
  });
});

app.get('/api/logs', (req, res) => {
  if (req.query.stream === '1') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for (const line of pm.logs.getAll()) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    }

    const onLog = (line: string) => {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    };
    pm.on('log', onLog);
    req.on('close', () => pm.removeListener('log', onLog));
    return;
  }
  res.json({ logs: pm.logs.getAll() });
});

const publicDir = path.join(PROJECT_ROOT, 'control-server', 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

async function shutdown(): Promise<void> {
  console.log('[control] 종료 중...');
  if (pm.getState().running || pm.getState().starting) {
    await pm.stop();
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function isAppRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
  });
}

async function main(): Promise<void> {
  server.listen(CONTROL_PORT, CONTROL_HOST, async () => {
    console.log(`[control] Control Server → http://${CONTROL_HOST}:${CONTROL_PORT}`);

    if (SKIP_PORT_SWITCHER) {
      console.log('[control] SKIP_PORT_SWITCHER=1, port-switcher 비활성');
    } else if (AUTO_START) {
      console.log('[control] AUTO_START=1, X-Launchpad 시작...');
      await portSwitcher.release();
      await pm.start();
    } else {
      const appAlreadyUp = await isAppRunning(APP_PORT);
      if (appAlreadyUp) {
        console.log(`[control] App already running on port ${APP_PORT}, skipping port-switcher bind`);
      } else {
        await portSwitcher.bind();
      }
    }
  });
}

main().catch(console.error);
