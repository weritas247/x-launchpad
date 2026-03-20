import { app, BrowserWindow, session } from 'electron';
import * as path from 'path';
import * as net from 'net';
import { applySecurityPolicy } from './security';

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

async function startServer(port: number): Promise<void> {
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'production';
  process.env.ELECTRON = '1';
  // 서버 모듈 동적 임포트 — 환경변수 설정 후
  await import('../dist/server/index.js');
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

  applySecurityPolicy(mainWindow);

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  serverPort = await findFreePort();
  await startServer(serverPort);

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
