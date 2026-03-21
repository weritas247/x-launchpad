import { BrowserWindow, app } from 'electron';

/** 윈도우별 보안 정책 적용 */
export function applySecurityPolicy(win: BrowserWindow, serverPort: number, devMode = false): void {
  if (!devMode) {
    // 1. DevTools 완전 차단 (프로덕션)
    win.webContents.on('before-input-event', (_event, input) => {
      if (
        (input.control || input.meta) &&
        input.shift &&
        input.key.toLowerCase() === 'i'
      ) {
        _event.preventDefault();
      }
      if (input.key === 'F12') {
        _event.preventDefault();
      }
    });

    // devtools 열기 자체를 차단
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools();
    });
  }

  // 2. 새 창 열기 차단
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // 3. 네비게이션 차단 (외부 URL로 이동 방지 — 호스트+포트 모두 검증)
  win.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || parsed.port !== String(serverPort)) {
      event.preventDefault();
    }
  });

  // 4. CSP 헤더 주입
  win.webContents.session.webRequest.onHeadersReceived(
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' http://127.0.0.1:*; " +
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:*; " +
            "style-src 'self' 'unsafe-inline' http://127.0.0.1:*; " +
            "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; " +
            "font-src 'self' http://127.0.0.1:*; " +
            "img-src 'self' data: http://127.0.0.1:*;"
          ],
        },
      });
    }
  );
}

/** 앱 전역 보안 정책 — app.whenReady() 후 1회만 호출 */
export function applyGlobalSecurityPolicy(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}
