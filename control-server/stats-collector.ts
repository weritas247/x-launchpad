import pidusage from 'pidusage';
import http from 'http';

export interface Stats {
  cpu: number;
  memory: number;
  sessions: number;
}

export class StatsCollector {
  private port: number;

  constructor(port: number) {
    this.port = port;
  }

  async collect(pid: number | null): Promise<Stats> {
    const stats: Stats = { cpu: 0, memory: 0, sessions: 0 };

    if (pid) {
      try {
        const usage = await pidusage(pid);
        stats.cpu = Math.round(usage.cpu * 10) / 10;
        stats.memory = usage.memory;
      } catch {}
    }

    if (pid) {
      try {
        stats.sessions = await this.fetchSessionCount();
      } catch {}
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
