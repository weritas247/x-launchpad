import { app, BrowserWindow, session } from 'electron';
import * as path from 'path';
import * as net from 'net';
import { applySecurityPolicy, applyGlobalSecurityPolicy } from './security';

let mainWindow: BrowserWindow | null = null;
let serverPort: number = 0;

/** 사용 가능한 랜덤 포트 탐색 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** 서버가 실제로 리스닝할 때까지 대기 */
function waitForServer(port: number, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Server did not start within ${timeout}ms`));
        } else {
          setTimeout(check, 100);
        }
      });
    };
    check();
  });
}

async function startServer(port: number): Promise<void> {
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'production';
  process.env.ELECTRON = '1';
  // ASAR 내부에는 쓰기 불가 — userData 경로를 사용
  process.env.ELECTRON_USER_DATA = app.getPath('userData');
  // 서버 모듈 동적 임포트 — 환경변수 설정 후
  // __dirname 기반 동적 경로 — TypeScript가 따라가지 않도록
  const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
  await import(serverEntry);
  // 서버가 실제로 리스닝할 때까지 대기
  await waitForServer(port);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  applySecurityPolicy(mainWindow, serverPort);

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // 앱 전역 보안 정책 (1회)
  applyGlobalSecurityPolicy();

  try {
    serverPort = await findFreePort();
    console.log(`[electron] Starting server on port ${serverPort}`);
    await startServer(serverPort);
    console.log(`[electron] Server started successfully`);
  } catch (err) {
    console.error('[electron] Failed to start server:', err);
    app.quit();
    return;
  }

  // 외부 URL 요청 차단
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const url = new URL(details.url);
      if (url.hostname === '127.0.0.1' && url.port === String(serverPort)) {
        callback({});
      } else if (details.url.startsWith('devtools://')) {
        callback({});
      } else {
        callback({ cancel: true });
      }
    }
  );

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
