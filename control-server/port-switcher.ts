import express from 'express';
import http from 'http';
import net from 'net';
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

    const publicDir = path.join(this.projectRoot, 'control-server', 'public');
    this.miniApp.use(express.static(publicDir));
    this.miniApp.get('*', (_req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  async bind(): Promise<void> {
    if (this.miniServer?.listening) {
      return; // 이미 바인딩됨
    }
    return new Promise((resolve, reject) => {
      this.miniServer = http.createServer(this.miniApp);

      // WebSocket 프록시: /ws 요청을 control server로 전달
      this.miniServer.on('upgrade', (req, socket, head) => {
        if (req.url === '/ws') {
          const proxySocket = net.createConnection({ host: '127.0.0.1', port: this.controlPort }, () => {
            proxySocket.write(
              `GET /ws HTTP/1.1\r\n` +
              `Host: 127.0.0.1:${this.controlPort}\r\n` +
              `Upgrade: websocket\r\n` +
              `Connection: Upgrade\r\n` +
              `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}\r\n` +
              `Sec-WebSocket-Version: ${req.headers['sec-websocket-version']}\r\n` +
              `\r\n`
            );
            proxySocket.pipe(socket as net.Socket);
            (socket as net.Socket).pipe(proxySocket);
          });
          proxySocket.on('error', () => socket.destroy());
          socket.on('error', () => proxySocket.destroy());
        } else {
          socket.destroy();
        }
      });

      this.miniServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[port-switcher] 포트 ${this.port} 사용 중, 바인딩 스킵`);
          resolve();
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
