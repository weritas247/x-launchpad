import { app, BrowserWindow, session, dialog, Menu } from 'electron';
import * as path from 'path';
import * as net from 'net';
import * as fs from 'fs';
import { applySecurityPolicy, applyGlobalSecurityPolicy } from './security';

// ─── File-based error logging (GUI 실행 시에도 에러 확인 가능) ────────
const LOG_DIR = app.isReady()
  ? app.getPath('userData')
  : path.join(
      process.env.HOME || '/tmp',
      'Library',
      'Application Support',
      'x-launchpad',
    );
const LOG_PATH = path.join(LOG_DIR, 'electron.log');

function ensureLogDir(): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function logToFile(level: string, ...args: unknown[]): void {
  ensureLogDir();
  const ts = new Date().toISOString();
  const msg = args
    .map((a) =>
      a instanceof Error ? `${a.message}\n${a.stack}` : String(a),
    )
    .join(' ');
  const line = `[${ts}] [${level}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    /* ignore */
  }
}

// 새 세션 시작 시 구분선 기록
ensureLogDir();
fs.appendFileSync(
  LOG_PATH,
  `\n${'='.repeat(60)}\n[${new Date().toISOString()}] === Electron app starting ===\n`,
);

// console.log / console.error 래핑
const origLog = console.log;
const origErr = console.error;
console.log = (...args: unknown[]) => {
  origLog(...args);
  logToFile('INFO', ...args);
};
console.error = (...args: unknown[]) => {
  origErr(...args);
  logToFile('ERROR', ...args);
};

// 전역 예외 처리
process.on('uncaughtException', (err) => {
  logToFile('FATAL', 'UncaughtException:', err);
  dialog
    .showMessageBox({
      type: 'error',
      title: 'X-Launchpad Crash',
      message: `Unexpected error:\n${err.message}`,
      detail: `Log: ${LOG_PATH}\n\n${err.stack}`,
    })
    .finally(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  logToFile(
    'FATAL',
    'UnhandledRejection:',
    reason instanceof Error ? reason : String(reason),
  );
});

const devMode = process.argv.includes('--dev');

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

  applySecurityPolicy(mainWindow, serverPort, devMode);

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  if (devMode) {
    mainWindow.webContents.openDevTools();
  }

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
    await dialog.showMessageBox({
      type: 'error',
      title: 'X-Launchpad — Server Start Failed',
      message: `서버를 시작할 수 없습니다.`,
      detail: `${err instanceof Error ? err.stack : String(err)}\n\nLog: ${LOG_PATH}`,
    });
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

  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'X-Launchpad',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  if (devMode) {
    menuTemplate.push({
      label: 'Dev',
      submenu: [
        { role: 'toggleDevTools', accelerator: 'CmdOrCtrl+Shift+I' },
        { role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', accelerator: 'CmdOrCtrl+Shift+R' },
      ],
    });
    console.log('[electron] Dev mode enabled — DevTools available via Cmd+Shift+I');
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
