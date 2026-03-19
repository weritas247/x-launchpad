# Control Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** X-Launchpad을 켜고 끌 수 있는 별도 경량 컨트롤 서버(포트 3001) + 메인 UI 플로팅 버튼 구현

**Architecture:** 독립 Express 서버가 child_process.spawn으로 X-Launchpad을 관리. 포트 3000을 OFF 시 바인딩/ON 시 release하여 동일 URL에서 꺼짐 페이지 또는 X-Launchpad을 보여줌. 메인 UI에는 왼쪽 아래 플로팅 버튼으로 컨트롤 패널 접근.

**Tech Stack:** Node.js, TypeScript, Express, WebSocket (ws), pidusage, child_process

**Spec:** `docs/superpowers/specs/2026-03-19-control-server-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `control-server/log-buffer.ts` | stdout/stderr 링 버퍼 (500줄) |
| Create | `control-server/process-manager.ts` | spawn/kill/restart + readiness detection |
| Create | `control-server/port-switcher.ts` | 포트 3000 바인딩/release + API 프록시 |
| Create | `control-server/stats-collector.ts` | pidusage로 CPU/메모리 수집 |
| Create | `control-server/index.ts` | Express + WebSocket 엔트리포인트 |
| Create | `control-server/tsconfig.json` | 별도 TypeScript 설정 |
| Create | `control-server/public/styles.css` | 꺼짐 페이지 + 대시보드 공통 스타일 |
| Create | `control-server/public/index.html` | 서버 OFF 페이지 |
| Create | `control-server/public/app.js` | OFF 페이지 클라이언트 JS |
| Create | `control-server/public/dashboard.html` | 풀페이지 대시보드 (3001 접근용) |
| Create | `client/js/control-panel.js` | 플로팅 버튼 + 패널 모듈 |
| Modify | `client/index.html` | 플로팅 버튼/패널 HTML 추가 |
| Modify | `client/styles.css` | 플로팅 버튼/패널 스타일 |
| Modify | `client/js/main.js` | control-panel.js import + 초기화 |
| Modify | `package.json` | pidusage 의존성 + npm scripts |
| Modify | `.env.dev` | CONTROL_PORT, CONTROL_HOST, AUTO_START |

---

### Task 1: 프로젝트 설정 — 의존성 및 빌드 구성

**Files:**
- Modify: `package.json`
- Create: `control-server/tsconfig.json`
- Modify: `.env.dev`

- [ ] **Step 1: pidusage 설치**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal
npm i pidusage && npm i -D @types/pidusage
```

- [ ] **Step 2: package.json에 npm scripts 추가**

`package.json`의 `scripts` 섹션에 추가:

```json
"dev:control": "ts-node --project control-server/tsconfig.json control-server/index.ts",
"build:control": "tsc -p control-server/tsconfig.json",
"start:control": "node dist/control-server/index.js",
"dev:all": "npm run dev:control"
```

- [ ] **Step 3: control-server/tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "../dist/control-server",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["./**/*.ts"]
}
```

- [ ] **Step 4: .env.dev에 환경변수 추가**

`.env.dev` 끝에 추가:

```
# Control Server
CONTROL_PORT=3001
CONTROL_HOST=127.0.0.1
AUTO_START=0
```

- [ ] **Step 5: 커밋**

```bash
git add package.json package-lock.json control-server/tsconfig.json .env.dev
git commit -m "설정: 컨트롤 서버 의존성 및 빌드 구성 추가"
```

---

### Task 2: LogBuffer — 링 버퍼 모듈

**Files:**
- Create: `control-server/log-buffer.ts`

- [ ] **Step 1: log-buffer.ts 구현**

```typescript
export class LogBuffer {
  private lines: string[] = [];
  private maxLines: number;

  constructor(maxLines = 500) {
    this.maxLines = maxLines;
  }

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.maxLines) {
      this.lines.shift();
    }
  }

  pushMultiline(data: string): string[] {
    const newLines = data.split('\n').filter(l => l.length > 0);
    for (const line of newLines) {
      this.push(line);
    }
    return newLines;
  }

  getAll(): string[] {
    return [...this.lines];
  }

  clear(): void {
    this.lines = [];
  }

  get length(): number {
    return this.lines.length;
  }
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc -p control-server/tsconfig.json --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add control-server/log-buffer.ts
git commit -m "기능: 컨트롤 서버 로그 링 버퍼 모듈"
```

---

### Task 3: ProcessManager — 프로세스 spawn/kill/restart

**Files:**
- Create: `control-server/process-manager.ts`

- [ ] **Step 1: process-manager.ts 구현**

```typescript
import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { LogBuffer } from './log-buffer';
import http from 'http';

export interface ProcessState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  exitSignal: string | null;
  starting: boolean;
}

export class ProcessManager extends EventEmitter {
  private child: ChildProcess | null = null;
  private state: ProcessState = {
    running: false,
    pid: null,
    startedAt: null,
    exitCode: null,
    exitSignal: null,
    starting: false,
  };
  public readonly logs = new LogBuffer(500);
  private projectRoot: string;
  private readinessTimer: NodeJS.Timeout | null = null;
  private readinessTimeout: NodeJS.Timeout | null = null;

  constructor(projectRoot: string) {
    super();
    this.projectRoot = projectRoot;
  }

  getState(): ProcessState {
    return { ...this.state };
  }

  getUptime(): number {
    if (!this.state.running || !this.state.startedAt) return 0;
    return Date.now() - this.state.startedAt;
  }

  async start(): Promise<void> {
    if (this.state.running || this.state.starting) return;
    this.state.starting = true;
    this.emit('state', this.getState());

    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    const cmd = isDev ? 'npx' : 'node';
    const args = isDev
      ? ['ts-node', 'server/index.ts']
      : ['dist/server/index.js'];

    this.child = spawn(cmd, args, {
      cwd: this.projectRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // 별도 프로세스 그룹으로 spawn → process.kill(-pid) 가능
    });

    this.state.pid = this.child.pid ?? null;

    this.child.stdout?.on('data', (data: Buffer) => {
      const newLines = this.logs.pushMultiline(data.toString());
      for (const line of newLines) {
        this.emit('log', line);
      }
      // stdout에서 listening 메시지 감지 (1차)
      const text = data.toString();
      if (text.includes('X-Launchpad') && text.includes('http')) {
        this.onReady();
      }
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      const newLines = this.logs.pushMultiline(data.toString());
      for (const line of newLines) {
        this.emit('log', line);
      }
    });

    this.child.on('exit', (code, signal) => {
      this.clearReadinessChecks();
      this.state = {
        running: false,
        pid: null,
        startedAt: null,
        exitCode: code,
        exitSignal: signal?.toString() ?? null,
        starting: false,
      };
      this.child = null;
      this.emit('state', this.getState());
      this.emit('exit', code, signal);
    });

    // 2차: health check 폴링 (500ms 간격)
    this.startReadinessPolling();

    // 10초 타임아웃
    this.readinessTimeout = setTimeout(() => {
      if (this.state.starting && !this.state.running) {
        this.logs.push('[control] 시작 타임아웃 (10초). 프로세스 종료.');
        this.emit('log', '[control] 시작 타임아웃 (10초). 프로세스 종료.');
        this.kill();
        this.state.starting = false;
        this.emit('start_failed', 'timeout');
        this.emit('state', this.getState());
      }
    }, 10000);
  }

  private startReadinessPolling(): void {
    const port = process.env.PORT || 3000;
    this.readinessTimer = setInterval(() => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        if (res.statusCode === 200 || res.statusCode === 304 || res.statusCode === 302) {
          this.onReady();
        }
        res.resume();
      });
      req.on('error', () => { /* 아직 안 됨, 계속 폴링 */ });
      req.setTimeout(1000, () => req.destroy());
    }, 500);
  }

  private onReady(): void {
    if (!this.state.starting) return;
    this.clearReadinessChecks();
    this.state.starting = false;
    this.state.running = true;
    this.state.startedAt = Date.now();
    this.emit('state', this.getState());
    this.emit('started');
  }

  private clearReadinessChecks(): void {
    if (this.readinessTimer) { clearInterval(this.readinessTimer); this.readinessTimer = null; }
    if (this.readinessTimeout) { clearTimeout(this.readinessTimeout); this.readinessTimeout = null; }
  }

  async stop(): Promise<void> {
    if (!this.child || (!this.state.running && !this.state.starting)) return;
    const pid = this.child.pid;
    if (!pid) return;

    return new Promise((resolve) => {
      this.child!.once('exit', () => resolve());

      // 프로세스 그룹 kill
      try { process.kill(-pid, 'SIGTERM'); } catch { /* ignore */ }

      // 5초 후 SIGKILL
      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* ignore */ }
        setTimeout(resolve, 500);
      }, 5000);
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    // stop 후 포트가 해제될 때까지 잠시 대기
    await new Promise(r => setTimeout(r, 1000));
    await this.start();
  }

  private kill(): void {
    if (this.child?.pid) {
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc -p control-server/tsconfig.json --noEmit
```

Expected: 에러 없음

- [ ] **Step 3: 커밋**

```bash
git add control-server/process-manager.ts
git commit -m "기능: 프로세스 매니저 (spawn/kill/restart + readiness detection)"
```

---

### Task 4: PortSwitcher — 포트 3000 전환 + API 프록시

**Files:**
- Create: `control-server/port-switcher.ts`

- [ ] **Step 1: port-switcher.ts 구현**

```typescript
import express from 'express';
import http from 'http';
import path from 'path';

export class PortSwitcher {
  private miniServer: http.Server | null = null;
  private miniApp: express.Express;
  private port: number;
  private controlPort: number;
  private host: string;
  private projectRoot: string;

  constructor(port: number, controlPort: number, host: string, projectRoot: string) {
    this.port = port;
    this.controlPort = controlPort;
    this.host = host;
    this.projectRoot = projectRoot;
    this.miniApp = express();

    // /api/* 요청을 컨트롤 서버로 프록시
    this.miniApp.use('/api', (req, res) => {
      const opts: http.RequestOptions = {
        hostname: '127.0.0.1',
        port: this.controlPort,
        path: `/api${req.url}`,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${this.controlPort}` },
      };
      const proxyReq = http.request(opts, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => {
        res.status(502).json({ error: 'Control server unavailable' });
      });
      req.pipe(proxyReq);
    });

    // 정적 파일 (꺼짐 페이지) — projectRoot 기반으로 경로 해결 (tsc 빌드 후에도 동작)
    const publicDir = path.join(this.projectRoot, 'control-server', 'public');
    this.miniApp.use(express.static(publicDir));
    this.miniApp.get('*', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  async bind(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.miniServer = http.createServer(this.miniApp);
      this.miniServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[port-switcher] 포트 ${this.port} 사용 중, 바인딩 스킵`);
          resolve(); // X-Launchpad이 이미 떠 있을 수 있음
        } else {
          reject(err);
        }
      });
      this.miniServer.listen(this.port, this.host, () => {
        console.log(`[port-switcher] 꺼짐 페이지 → http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  async release(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.miniServer) { resolve(); return; }
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      this.miniServer.close(() => {
        this.miniServer = null;
        console.log(`[port-switcher] 포트 ${this.port} release`);
        done();
      });
      // 강제 종료 타이머 (3초)
      setTimeout(() => {
        if (this.miniServer) {
          this.miniServer.closeAllConnections?.();
          this.miniServer = null;
        }
        done();
      }, 3000);
    });
  }

  isBound(): boolean {
    return this.miniServer !== null && this.miniServer.listening;
  }
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc -p control-server/tsconfig.json --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add control-server/port-switcher.ts
git commit -m "기능: 포트 스위처 (3000 바인딩/release + API 프록시)"
```

---

### Task 5: StatsCollector — CPU/메모리/세션 수집

**Files:**
- Create: `control-server/stats-collector.ts`

- [ ] **Step 1: stats-collector.ts 구현**

```typescript
import pidusage from 'pidusage';
import http from 'http';

export interface Stats {
  cpu: number;      // percentage
  memory: number;   // bytes
  sessions: number;
}

export class StatsCollector {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  async collect(pid: number | null): Promise<Stats> {
    const stats: Stats = { cpu: 0, memory: 0, sessions: 0 };

    // CPU/메모리
    if (pid) {
      try {
        const usage = await pidusage(pid);
        stats.cpu = Math.round(usage.cpu * 10) / 10;
        stats.memory = usage.memory;
      } catch { /* 프로세스 없음 */ }
    }

    // 세션 수 (X-Launchpad API 호출)
    if (pid) {
      try {
        stats.sessions = await this.fetchSessionCount();
      } catch { /* 서버 응답 없음 */ }
    }

    return stats;
  }

  private fetchSessionCount(): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${this.port}/api/sessions`, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          try {
            const sessions = JSON.parse(data);
            resolve(Array.isArray(sessions) ? sessions.length : 0);
          } catch { resolve(0); }
        });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
    });
  }
}
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc -p control-server/tsconfig.json --noEmit
```

- [ ] **Step 3: 커밋**

```bash
git add control-server/stats-collector.ts
git commit -m "기능: CPU/메모리/세션 수 수집기 (pidusage)"
```

---

### Task 6: 컨트롤 서버 엔트리포인트 — Express + WebSocket

**Files:**
- Create: `control-server/index.ts`

- [ ] **Step 1: index.ts 구현**

```typescript
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env.dev') });

import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { ProcessManager } from './process-manager';
import { PortSwitcher } from './port-switcher';
import { StatsCollector } from './stats-collector';

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '3001');
const CONTROL_HOST = process.env.CONTROL_HOST || '127.0.0.1';
const APP_PORT = parseInt(process.env.PORT || '3000');
const AUTO_START = process.env.AUTO_START === '1';

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
  verifyClient: (info) => {
    const origin = info.origin || '';
    return origin.includes('localhost') || origin.includes('127.0.0.1') || !origin;
  },
});
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  // 즉시 현재 상태 전송
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

// 1초마다 상태 브로드캐스트
setInterval(broadcastState, 1000);

// 프로세스 이벤트 → 브로드캐스트
pm.on('state', () => broadcastState());
pm.on('log', (line: string) => broadcast({ type: 'log', line }));
pm.on('started', async () => {
  broadcast({ type: 'started' });
});
pm.on('start_failed', (reason: string) => {
  broadcast({ type: 'start_failed', reason });
  // 포트 3000 다시 바인딩
  portSwitcher.bind();
});
pm.on('exit', () => {
  // X-Launchpad이 죽으면 포트 3000 다시 바인딩
  portSwitcher.bind();
});

// API 엔드포인트
app.get('/api/health', (_req, res) => res.json({ ok: true }));

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
  try {
    await portSwitcher.release();
    await pm.start();
    res.json({ ok: true, message: 'Starting...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
  try {
    await pm.stop();
    await portSwitcher.release();
    await pm.start();
    res.json({ ok: true, message: 'Restarting...' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/logs', (req, res) => {
  if (req.query.stream === '1') {
    // SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 기존 로그 전송
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

// 대시보드 정적 파일 — PROJECT_ROOT 기반 (tsc 빌드 후에도 동작)
const publicDir = path.join(PROJECT_ROOT, 'control-server', 'public');
app.use(express.static(publicDir));
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'dashboard.html'));
});

// Graceful shutdown — 컨트롤 서버 종료 시 X-Launchpad도 정리
async function shutdown(): Promise<void> {
  console.log('[control] 종료 중...');
  if (pm.getState().running || pm.getState().starting) {
    await pm.stop();
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 서버 시작
async function main(): Promise<void> {
  server.listen(CONTROL_PORT, CONTROL_HOST, async () => {
    console.log(`[control] Control Server → http://${CONTROL_HOST}:${CONTROL_PORT}`);

    if (AUTO_START) {
      console.log('[control] AUTO_START=1, X-Launchpad 시작...');
      await pm.start();
    } else {
      // 꺼짐 페이지로 포트 3000 바인딩
      await portSwitcher.bind();
    }
  });
}

main().catch(console.error);
```

- [ ] **Step 2: 컴파일 확인**

```bash
npx tsc -p control-server/tsconfig.json --noEmit
```

- [ ] **Step 3: 기본 동작 확인**

```bash
npx ts-node --project control-server/tsconfig.json control-server/index.ts
```

Expected: `[control] Control Server → http://127.0.0.1:3001` + `[port-switcher] 꺼짐 페이지 → http://127.0.0.1:3000`

Ctrl+C로 종료

- [ ] **Step 4: 커밋**

```bash
git add control-server/index.ts
git commit -m "기능: 컨트롤 서버 엔트리포인트 (Express + WebSocket + API)"
```

---

### Task 7: 서버 OFF 페이지 — HTML/CSS/JS

**Files:**
- Create: `control-server/public/index.html`
- Create: `control-server/public/styles.css`
- Create: `control-server/public/app.js`

- [ ] **Step 1: styles.css 생성**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
  background: #0d1117;
  color: #c9d1d9;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.container {
  text-align: center;
  max-width: 400px;
  padding: 40px;
}
.logo { font-size: 48px; margin-bottom: 16px; }
.title { font-size: 20px; font-weight: bold; color: #f0f6fc; margin-bottom: 8px; }
.subtitle { font-size: 13px; color: #8b949e; margin-bottom: 32px; }

.power-btn {
  width: 80px; height: 80px;
  border-radius: 50%;
  border: 3px solid #238636;
  background: rgba(35,134,54,0.1);
  cursor: pointer;
  margin: 0 auto 24px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.3s ease;
  font-size: 36px; color: #3fb950;
}
.power-btn:hover {
  background: rgba(35,134,54,0.25);
  box-shadow: 0 0 20px rgba(35,134,54,0.3);
  transform: scale(1.05);
}
.power-btn.starting {
  border-color: #d29922;
  color: #d29922;
  animation: pulse 1.5s infinite;
  pointer-events: none;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.info-box {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  text-align: left;
  margin-top: 16px;
}
.info-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
.info-row:last-child { margin-bottom: 0; }
.info-label { color: #8b949e; font-size: 12px; }
.info-value { color: #c9d1d9; font-size: 12px; }

.status-msg {
  font-size: 13px; margin-top: 16px;
  color: #d29922;
  min-height: 20px;
}
.status-msg.error { color: #f85149; }
```

- [ ] **Step 2: index.html 생성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X-Launchpad — Offline</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container">
    <div class="logo">⚡</div>
    <div class="title">X-Launchpad</div>
    <div class="subtitle">서버가 꺼져 있습니다</div>

    <button class="power-btn" id="power-btn" title="서버 시작">⏻</button>

    <div class="info-box" id="info-box">
      <div class="info-row">
        <span class="info-label">상태</span>
        <span class="info-value" id="info-status">꺼짐</span>
      </div>
      <div class="info-row">
        <span class="info-label">마지막 종료</span>
        <span class="info-value" id="info-last-exit">—</span>
      </div>
    </div>

    <div class="status-msg" id="status-msg"></div>
  </div>
  <script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: app.js 생성**

```javascript
const powerBtn = document.getElementById('power-btn');
const statusMsg = document.getElementById('status-msg');
const infoStatus = document.getElementById('info-status');

// WebSocket으로 컨트롤 서버 상태 수신
let ws = null;
function connectWS() {
  ws = new WebSocket('ws://127.0.0.1:3001/ws');
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') {
      if (msg.running) {
        infoStatus.textContent = '실행 중';
      } else if (msg.starting) {
        infoStatus.textContent = '시작 중...';
      } else {
        infoStatus.textContent = '꺼짐';
      }
      if (msg.exitCode !== null && msg.exitCode !== undefined) {
        document.getElementById('info-last-exit').textContent =
          msg.exitCode === 0 ? '정상 종료' : `종료 코드: ${msg.exitCode}`;
      }
    }
    if (msg.type === 'started') {
      statusMsg.textContent = '서버 시작 완료! 리다이렉트 중...';
      statusMsg.className = 'status-msg';
      setTimeout(() => location.reload(), 500);
    }
    if (msg.type === 'start_failed') {
      statusMsg.textContent = `시작 실패: ${msg.reason}`;
      statusMsg.className = 'status-msg error';
      powerBtn.classList.remove('starting');
    }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
  ws.onerror = () => ws.close();
}
connectWS();

powerBtn.addEventListener('click', async () => {
  powerBtn.classList.add('starting');
  statusMsg.textContent = '서버 시작 중...';
  statusMsg.className = 'status-msg';

  try {
    const res = await fetch('/api/start', { method: 'POST' });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Start failed');
    }
  } catch (err) {
    statusMsg.textContent = `오류: ${err.message}`;
    statusMsg.className = 'status-msg error';
    powerBtn.classList.remove('starting');
  }
});
```

- [ ] **Step 4: 동작 확인**

```bash
npx ts-node --project control-server/tsconfig.json control-server/index.ts &
sleep 2
curl -s http://127.0.0.1:3000 | head -5
kill %1
```

Expected: HTML 응답에 "X-Launchpad" 포함

- [ ] **Step 5: 커밋**

```bash
git add control-server/public/
git commit -m "기능: 서버 OFF 페이지 (전원 버튼 + WebSocket 상태)"
```

---

### Task 8: 대시보드 페이지 — 풀페이지 대시보드 (3001)

**Files:**
- Create: `control-server/public/dashboard.html`

- [ ] **Step 1: dashboard.html 생성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X-Launchpad — Control Dashboard</title>
  <link rel="stylesheet" href="/styles.css">
  <style>
    body { align-items: flex-start; padding: 40px; }
    .dashboard { max-width: 800px; width: 100%; margin: 0 auto; }
    .dash-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .dash-title { font-size: 18px; font-weight: bold; color: #f0f6fc; }
    .badge { font-size: 11px; padding: 3px 10px; border-radius: 12px; font-weight: bold; }
    .badge.on { background: #238636; color: #fff; }
    .badge.off { background: #da3633; color: #fff; }
    .badge.starting { background: #d29922; color: #1e1e2e; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .stat-label { font-size: 11px; color: #8b949e; margin-bottom: 4px; }
    .stat-value { font-size: 20px; font-weight: bold; color: #f0f6fc; }
    .actions { display: flex; gap: 8px; margin-bottom: 24px; }
    .btn { padding: 8px 20px; border: none; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer; font-family: inherit; }
    .btn-start { background: #238636; color: #fff; }
    .btn-stop { background: #da3633; color: #fff; }
    .btn-restart { background: #1f6feb; color: #fff; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .log-box {
      background: #0d1117; border: 1px solid #30363d; border-radius: 8px;
      padding: 12px; font-size: 12px; line-height: 1.6;
      max-height: 400px; overflow-y: auto;
    }
    .log-line { color: #8b949e; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="dash-header">
      <div class="dash-title">⚡ X-Launchpad Control</div>
      <span class="badge off" id="badge">OFF</span>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Uptime</div>
        <div class="stat-value" id="s-uptime">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sessions</div>
        <div class="stat-value" id="s-sessions">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">CPU</div>
        <div class="stat-value" id="s-cpu">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Memory</div>
        <div class="stat-value" id="s-memory">—</div>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-start" id="btn-start">Start</button>
      <button class="btn btn-stop" id="btn-stop" disabled>Stop</button>
      <button class="btn btn-restart" id="btn-restart" disabled>Restart</button>
    </div>

    <h3 style="color:#f0f6fc;margin-bottom:8px;font-size:14px;">Logs</h3>
    <div class="log-box" id="log-box"></div>
  </div>

  <script>
    const badge = document.getElementById('badge');
    const sUptime = document.getElementById('s-uptime');
    const sSessions = document.getElementById('s-sessions');
    const sCpu = document.getElementById('s-cpu');
    const sMemory = document.getElementById('s-memory');
    const btnStart = document.getElementById('btn-start');
    const btnStop = document.getElementById('btn-stop');
    const btnRestart = document.getElementById('btn-restart');
    const logBox = document.getElementById('log-box');

    function formatUptime(ms) {
      if (!ms) return '—';
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
    }
    function formatBytes(b) {
      if (!b) return '—';
      return (b / 1024 / 1024).toFixed(0) + 'MB';
    }

    function addLog(line) {
      const el = document.createElement('div');
      el.className = 'log-line';
      el.textContent = line;
      logBox.appendChild(el);
      logBox.scrollTop = logBox.scrollHeight;
    }

    // WebSocket
    function connectWS() {
      const ws = new WebSocket(`ws://${location.host}/ws`);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'status') {
          const running = msg.running;
          const starting = msg.starting;
          badge.textContent = running ? 'ON' : starting ? 'STARTING' : 'OFF';
          badge.className = `badge ${running ? 'on' : starting ? 'starting' : 'off'}`;
          sUptime.textContent = formatUptime(msg.uptime);
          sSessions.textContent = msg.sessions;
          sCpu.textContent = msg.cpu ? msg.cpu + '%' : '—';
          sMemory.textContent = formatBytes(msg.memory);
          btnStart.disabled = running || starting;
          btnStop.disabled = !running && !starting;
          btnRestart.disabled = !running;
        }
        if (msg.type === 'log') addLog(msg.line);
      };
      ws.onclose = () => setTimeout(connectWS, 3000);
      ws.onerror = () => ws.close();
    }
    connectWS();

    // 초기 로그 로드
    fetch('/api/logs').then(r => r.json()).then(d => {
      (d.logs || []).forEach(addLog);
    });

    async function apiCall(endpoint) {
      try {
        const res = await fetch(`/api/${endpoint}`, { method: 'POST' });
        if (!res.ok) {
          const d = await res.json();
          addLog(`[error] ${d.error}`);
        }
      } catch (err) { addLog(`[error] ${err.message}`); }
    }
    btnStart.onclick = () => apiCall('start');
    btnStop.onclick = () => apiCall('stop');
    btnRestart.onclick = () => apiCall('restart');
  </script>
</body>
</html>
```

- [ ] **Step 2: 커밋**

```bash
git add control-server/public/dashboard.html
git commit -m "기능: 풀페이지 컨트롤 대시보드 (포트 3001)"
```

---

### Task 9: 통합 테스트 — 컨트롤 서버 start/stop 사이클

**Files:** (기존 파일만 사용)

- [ ] **Step 1: 컨트롤 서버 시작 + API 테스트**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal
npx ts-node --project control-server/tsconfig.json control-server/index.ts &
CONTROL_PID=$!
sleep 2

# health 체크
curl -s http://127.0.0.1:3001/api/health
# Expected: {"ok":true}

# status 체크
curl -s http://127.0.0.1:3001/api/status | python3 -m json.tool
# Expected: running: false

# 꺼짐 페이지 확인
curl -s http://127.0.0.1:3000 | grep "X-Launchpad"
# Expected: 매치됨
```

- [ ] **Step 2: X-Launchpad start/stop 사이클**

```bash
# 시작
curl -s -X POST http://127.0.0.1:3001/api/start
# Expected: {"ok":true,"message":"Starting..."}

sleep 5

# 상태 확인
curl -s http://127.0.0.1:3001/api/status | python3 -m json.tool
# Expected: running: true, pid: <number>

# X-Launchpad 접근 확인
curl -s http://127.0.0.1:3000 | head -3
# Expected: X-Launchpad HTML

# 종료
curl -s -X POST http://127.0.0.1:3001/api/stop
sleep 2

# 꺼짐 페이지 복귀 확인
curl -s http://127.0.0.1:3000 | grep "서버가 꺼져 있습니다"
# Expected: 매치됨

kill $CONTROL_PID
```

- [ ] **Step 3: 문제 있으면 수정 후 커밋**

```bash
git add -A
git commit -m "수정: 통합 테스트에서 발견된 이슈 해결"
```

---

### Task 10: 플로팅 버튼 + 패널 — X-Launchpad 메인 UI

**Files:**
- Create: `client/js/control-panel.js`
- Modify: `client/index.html`
- Modify: `client/styles.css`
- Modify: `client/js/main.js`

- [ ] **Step 1: client/js/control-panel.js 생성**

```javascript
// Control Panel — 플로팅 버튼 + 미니 대시보드 패널
const CONTROL_PORT = 3001;
let controlWs = null;
let panelOpen = false;
let lastStatus = {};

const floatingBtn = document.getElementById('control-floating-btn');
const controlPanel = document.getElementById('control-panel');
const cpBadge = document.getElementById('cp-badge');
const cpUptime = document.getElementById('cp-uptime');
const cpSessions = document.getElementById('cp-sessions');
const cpCpu = document.getElementById('cp-cpu');
const cpMemory = document.getElementById('cp-memory');
const cpBtnStop = document.getElementById('cp-btn-stop');
const cpBtnRestart = document.getElementById('cp-btn-restart');
const cpBtnLogs = document.getElementById('cp-btn-logs');

function formatUptime(ms) {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}
function formatBytes(b) {
  if (!b) return '—';
  return (b / 1024 / 1024).toFixed(0) + 'MB';
}

function connectControlWS() {
  controlWs = new WebSocket(`ws://127.0.0.1:${CONTROL_PORT}/ws`);
  controlWs.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'status') {
      lastStatus = msg;
      updatePanel(msg);
    }
  };
  controlWs.onclose = () => setTimeout(connectControlWS, 5000);
  controlWs.onerror = () => controlWs.close();
}

function updatePanel(s) {
  if (!cpBadge) return;
  cpBadge.textContent = s.running ? 'ON' : s.starting ? 'STARTING' : 'OFF';
  cpBadge.className = `cp-badge ${s.running ? 'on' : s.starting ? 'starting' : 'off'}`;
  cpUptime.textContent = formatUptime(s.uptime);
  cpSessions.textContent = s.sessions || 0;
  cpCpu.textContent = s.cpu ? s.cpu + '%' : '—';
  cpMemory.textContent = formatBytes(s.memory);
}

function togglePanel() {
  panelOpen = !panelOpen;
  controlPanel.classList.toggle('open', panelOpen);
}

async function controlApiCall(endpoint) {
  try {
    const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}/api/${endpoint}`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      console.error('[control]', d.error);
    }
  } catch (err) {
    console.error('[control]', err.message);
  }
}

// 이벤트 바인딩
if (floatingBtn) {
  floatingBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanel();
  });
}
if (cpBtnStop) cpBtnStop.addEventListener('click', () => controlApiCall('stop'));
if (cpBtnRestart) cpBtnRestart.addEventListener('click', () => controlApiCall('restart'));
if (cpBtnLogs) cpBtnLogs.addEventListener('click', () => {
  window.open(`http://127.0.0.1:${CONTROL_PORT}`, '_blank');
});

// 패널 밖 클릭 시 닫기
document.addEventListener('click', (e) => {
  if (panelOpen && controlPanel && !controlPanel.contains(e.target) && e.target !== floatingBtn) {
    panelOpen = false;
    controlPanel.classList.remove('open');
  }
});

export function initControlPanel() {
  connectControlWS();
}
```

- [ ] **Step 2: client/index.html에 플로팅 버튼/패널 HTML 추가**

`</body>` 태그 직전에 추가:

```html
<!-- Control Panel Floating Button -->
<button id="control-floating-btn" class="control-floating-btn" title="Control Panel">⚡</button>
<div id="control-panel" class="control-panel">
  <div class="cp-header">
    <span class="cp-title">⚡ X-Launchpad</span>
    <span class="cp-badge off" id="cp-badge">OFF</span>
  </div>
  <div class="cp-stats">
    <div class="cp-row"><span>Uptime</span><span id="cp-uptime">—</span></div>
    <div class="cp-row"><span>Sessions</span><span id="cp-sessions">0</span></div>
    <div class="cp-row"><span>CPU</span><span id="cp-cpu">—</span></div>
    <div class="cp-row"><span>Memory</span><span id="cp-memory">—</span></div>
  </div>
  <div class="cp-actions">
    <button class="cp-btn cp-btn-stop" id="cp-btn-stop">Stop</button>
    <button class="cp-btn cp-btn-restart" id="cp-btn-restart">Restart</button>
    <button class="cp-btn cp-btn-logs" id="cp-btn-logs">Logs</button>
  </div>
</div>
```

- [ ] **Step 3: client/styles.css에 스타일 추가**

파일 끝에 추가:

```css
/* ─── Control Panel Floating Button ─── */
.control-floating-btn {
  position: fixed;
  bottom: 24px;
  left: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #89b4fa, #cba6f7);
  color: #1e1e2e;
  font-size: 20px;
  cursor: pointer;
  z-index: 8000;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: transform 0.2s, box-shadow 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
.control-floating-btn:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 20px rgba(0,0,0,0.5);
}

.control-panel {
  position: fixed;
  bottom: 78px;
  left: 24px;
  width: 260px;
  background: var(--bg-panel, #181825);
  border: 1px solid var(--border-lit, #313244);
  border-radius: 12px;
  padding: 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 8000;
  opacity: 0;
  transform: translateY(10px) scale(0.95);
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
}
.control-panel.open {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

.cp-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.cp-title { font-size: 13px; font-weight: bold; color: #f0f6fc; }
.cp-badge {
  font-size: 9px; padding: 2px 8px; border-radius: 10px; font-weight: bold;
}
.cp-badge.on { background: #238636; color: #fff; }
.cp-badge.off { background: #da3633; color: #fff; }
.cp-badge.starting { background: #d29922; color: #1e1e2e; }

.cp-stats { margin-bottom: 10px; }
.cp-row {
  display: flex; justify-content: space-between;
  font-size: 11px; margin-bottom: 4px;
}
.cp-row span:first-child { color: #8b949e; }
.cp-row span:last-child { color: #c9d1d9; }

.cp-actions { display: flex; gap: 6px; }
.cp-btn {
  flex: 1; text-align: center; padding: 6px;
  border: none; border-radius: 6px;
  font-size: 10px; font-weight: bold;
  cursor: pointer; font-family: inherit;
}
.cp-btn-stop { background: #f38ba8; color: #1e1e2e; }
.cp-btn-restart { background: #a6e3a1; color: #1e1e2e; }
.cp-btn-logs { background: var(--border-lit, #313244); color: #cdd6f4; }
.cp-btn:hover { opacity: 0.85; }
```

- [ ] **Step 4: client/js/main.js에 import 추가**

기존 import 목록 끝에 추가:

```javascript
import { initControlPanel } from './control-panel.js';
```

그리고 초기화 코드 영역에서 `initControlPanel()` 호출 추가.

- [ ] **Step 5: 커밋**

```bash
git add client/js/control-panel.js client/index.html client/styles.css client/js/main.js
git commit -m "기능: 메인 UI 플로팅 컨트롤 버튼 + 미니 대시보드 패널"
```

---

### Task 11: End-to-End 테스트 — 전체 흐름 검증

- [ ] **Step 1: 컨트롤 서버로 전체 사이클 테스트**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal
npx ts-node --project control-server/tsconfig.json control-server/index.ts &
sleep 2
```

체크리스트:
1. `http://127.0.0.1:3001` 접근 → 대시보드 표시 (OFF 상태)
2. `http://127.0.0.1:3000` 접근 → 꺼짐 페이지 표시
3. 꺼짐 페이지에서 전원 버튼 클릭 → X-Launchpad 시작 → 자동 리다이렉트
4. X-Launchpad UI에서 왼쪽 아래 플로팅 버튼 확인
5. 플로팅 버튼 클릭 → 패널 열림 (ON 상태, uptime, sessions 등)
6. 패널의 Stop 버튼 클릭 → X-Launchpad 종료 → 꺼짐 페이지로 전환
7. `http://127.0.0.1:3001` 대시보드에서 Start → 다시 시작 확인

- [ ] **Step 2: 에지 케이스 확인**

- 중복 시작 요청 → 409 응답
- 서버가 꺼진 상태에서 Stop → 409 응답
- Restart 동작 확인

- [ ] **Step 3: 발견된 이슈 수정 후 커밋**

```bash
git add -A
git commit -m "수정: E2E 테스트 이슈 해결"
```

---

### Task 12: .gitignore 정리 + 최종 커밋

- [ ] **Step 1: .gitignore에 .superpowers/ 추가 (아직 없으면)**

```bash
echo ".superpowers/" >> .gitignore
```

- [ ] **Step 2: 최종 커밋**

```bash
git add .gitignore
git commit -m "정리: .gitignore에 .superpowers/ 추가"
```
