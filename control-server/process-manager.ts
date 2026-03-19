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
      detached: true,
    });

    this.state.pid = this.child.pid ?? null;

    this.child.stdout?.on('data', (data: Buffer) => {
      const newLines = this.logs.pushMultiline(data.toString());
      for (const line of newLines) {
        this.emit('log', line);
      }
      const text = data.toString();
      if (text.includes('Super Terminal') && text.includes('http')) {
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

    this.startReadinessPolling();

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
      req.on('error', () => {});
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
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };

      this.child!.once('exit', done);

      try { process.kill(-pid, 'SIGTERM'); } catch {}

      setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch {}
        // Wait for exit event, but force resolve after another 2s as last resort
        setTimeout(done, 2000);
      }, 5000);
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise(r => setTimeout(r, 1000));
    await this.start();
  }

  private kill(): void {
    if (this.child?.pid) {
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch {}
    }
  }
}
