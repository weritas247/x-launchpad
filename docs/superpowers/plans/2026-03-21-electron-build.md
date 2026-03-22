# Electron Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** x-launchpad를 보안 강화된 Electron 데스크톱 앱으로 패키징한다.

**Architecture:** 기존 Express 서버를 Electron main process 내에서 127.0.0.1 랜덤 포트로 실행. BrowserWindow가 해당 로컬 서버를 로드. ASAR 암호화, JS 난독화, DevTools 차단, 코드 서명으로 리버스 엔지니어링 방지.

**Tech Stack:** Electron 35, electron-builder, javascript-obfuscator, @electron/asar

---

## File Structure

```
electron/
  main.ts              # Electron main process — 서버 기동 + BrowserWindow 생성
  preload.ts           # Context bridge (최소 API만 노출)
  security.ts          # 보안 설정 (CSP, 요청 차단, DevTools 차단)
electron-builder.yml   # electron-builder 설정 (ASAR, 코드서명, 타겟)
scripts/
  obfuscate.js         # javascript-obfuscator 빌드 후처리 스크립트
```

**수정 파일:**
- `package.json` — Electron 의존성 + 빌드 스크립트 추가
- `tsconfig.json` — electron/ 폴더 포함
- `vite.config.ts` — Electron 빌드 모드 추가
- `server/env.ts` — Electron 모드에서 랜덤 포트 지원

---

### Task 1: 브랜치 생성 및 Electron 의존성 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 브랜치 생성**

```bash
git checkout -b feature/electron-build
```

- [ ] **Step 2: Electron 및 빌드 도구 설치**

```bash
npm install --save-dev electron electron-builder javascript-obfuscator @electron/asar
npm install --save-dev @types/node
```

- [ ] **Step 3: package.json에 Electron 필드 추가**

`package.json`에 다음 필드 추가:
```json
{
  "main": "dist/electron/main.js",
  "scripts": {
    "electron:dev": "npm run build && electron .",
    "electron:build": "npm run build && node scripts/obfuscate.js && electron-builder",
    "electron:build:mac": "npm run build && node scripts/obfuscate.js && electron-builder --mac"
  }
}
```

- [ ] **Step 4: 커밋**

```bash
git add package.json package-lock.json
git commit -m "chore: add Electron and build dependencies"
```

---

### Task 2: Electron main process 작성

**Files:**
- Create: `electron/main.ts`
- Create: `electron/preload.ts`

- [ ] **Step 1: `electron/main.ts` 작성**

```typescript
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
```

- [ ] **Step 2: `electron/preload.ts` 작성**

```typescript
import { contextBridge } from 'electron';

// 최소한의 API만 노출 — 현재는 빈 브릿지
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
});
```

- [ ] **Step 3: 커밋**

```bash
git add electron/
git commit -m "feat(electron): add main process and preload script"
```

---

### Task 3: 보안 모듈 작성

**Files:**
- Create: `electron/security.ts`

- [ ] **Step 1: `electron/security.ts` 작성**

```typescript
import { BrowserWindow, app } from 'electron';

export function applySecurityPolicy(win: BrowserWindow): void {
  // 1. DevTools 완전 차단 (프로덕션)
  win.webContents.on('before-input-event', (_event, input) => {
    // Cmd+Shift+I, Cmd+Option+I, F12 차단
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

  // 2. 새 창 열기 차단
  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  // 3. 네비게이션 차단 (외부 URL로 이동 방지)
  win.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1') {
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

  // 5. 원격 콘텐츠 로드 차단
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}
```

- [ ] **Step 2: 커밋**

```bash
git add electron/security.ts
git commit -m "feat(electron): add security hardening module"
```

---

### Task 4: TypeScript 빌드 설정 수정

**Files:**
- Modify: `tsconfig.json`
- Create: `electron/tsconfig.json`

- [ ] **Step 1: `electron/tsconfig.json` 생성**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "../dist/electron",
    "rootDir": "./",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": false,
    "declaration": false
  },
  "include": ["./**/*"],
  "exclude": ["node_modules"]
}
```

참고: `sourceMap: false` — 리버스 엔지니어링 방지를 위해 소스맵 미생성.

- [ ] **Step 2: `package.json` 빌드 스크립트 수정**

기존 `build` 스크립트를 업데이트하고 electron 빌드 추가:
```json
{
  "scripts": {
    "build": "vite build --config vite.config.ts && tsc -p tsconfig.json",
    "build:electron": "tsc -p electron/tsconfig.json",
    "electron:dev": "npm run build && npm run build:electron && electron .",
    "electron:build": "npm run build && npm run build:electron && node scripts/obfuscate.js && electron-builder",
    "electron:build:mac": "npm run build && npm run build:electron && node scripts/obfuscate.js && electron-builder --mac"
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add electron/tsconfig.json package.json
git commit -m "chore: add Electron TypeScript build config"
```

---

### Task 5: server/env.ts Electron 모드 지원

**Files:**
- Modify: `server/env.ts`

- [ ] **Step 1: Electron 환경변수 지원 추가**

`server/env.ts`의 `EnvConfig` 인터페이스에 추가:
```typescript
ELECTRON: boolean;
```

`getEnv()` 리턴 객체에 추가:
```typescript
ELECTRON: env.ELECTRON === '1',
```

- [ ] **Step 2: server/index.ts에서 Electron 모드일 때 127.0.0.1 바인딩 강제**

서버 listen 부분에서 Electron 모드 분기:
```typescript
const HOST = env.ELECTRON ? '127.0.0.1' : '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
```

- [ ] **Step 3: 커밋**

```bash
git add server/env.ts server/index.ts
git commit -m "feat: add Electron mode with 127.0.0.1 binding"
```

---

### Task 6: JavaScript 난독화 스크립트

**Files:**
- Create: `scripts/obfuscate.js`

- [ ] **Step 1: `scripts/obfuscate.js` 작성**

```javascript
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const TARGETS = [
  'dist/electron/main.js',
  'dist/electron/preload.js',
  'dist/electron/security.js',
  'dist/server/index.js',
];

const OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  debugProtection: true,
  debugProtectionInterval: 2000,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  numbersToExpressions: true,
  renameGlobals: false, // node 모듈 호환성 유지
  selfDefending: true,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 5,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['rc4'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersType: 'function',
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: false,
};

for (const file of TARGETS) {
  const filePath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.warn(`[obfuscate] skip (not found): ${file}`);
    continue;
  }
  console.log(`[obfuscate] ${file}`);
  const code = fs.readFileSync(filePath, 'utf8');
  const result = JavaScriptObfuscator.obfuscate(code, OPTIONS);
  fs.writeFileSync(filePath, result.getObfuscatedCode());
}

// dist/client JS 파일도 난독화
const clientDir = path.resolve(__dirname, '..', 'dist/client/assets');
if (fs.existsSync(clientDir)) {
  const jsFiles = fs.readdirSync(clientDir).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    const filePath = path.join(clientDir, file);
    console.log(`[obfuscate] client: ${file}`);
    const code = fs.readFileSync(filePath, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(code, {
      ...OPTIONS,
      selfDefending: false, // 브라우저 환경에서 호환성
    });
    fs.writeFileSync(filePath, result.getObfuscatedCode());
  }
}

console.log('[obfuscate] done');
```

- [ ] **Step 2: 커밋**

```bash
git add scripts/obfuscate.js
git commit -m "feat: add JavaScript obfuscation build script"
```

---

### Task 7: electron-builder 설정

**Files:**
- Create: `electron-builder.yml`

- [ ] **Step 1: `electron-builder.yml` 작성**

```yaml
appId: com.xlaunchpad.app
productName: X-Launchpad
copyright: Copyright © 2026

directories:
  output: release

# ASAR 암호화
asar: true
asarUnpack:
  - "node_modules/node-pty/**"
  - "node_modules/better-sqlite3/**"

files:
  - "dist/**/*"
  - "node_modules/**/*"
  - "!node_modules/.cache"
  - "!**/*.ts"
  - "!**/*.map"
  - "!**/tsconfig*.json"
  - "!docs/**"
  - "!client/**"
  - "!server/**"
  - "!electron/**"
  - "!scripts/**"
  - "!.env*"
  - "!*.md"
  - "!.git"
  - "!.claude"

# 소스맵 완전 제거
removePackageScripts: true

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch:
        - arm64
        - x64
  identity: null  # 로컬 빌드용 — 배포 시 실제 인증서로 교체
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: null
  entitlementsInherit: null

dmg:
  title: X-Launchpad

# native 모듈 재빌드
electronDownload:
  mirror: https://npmmirror.com/mirrors/electron/

npmRebuild: true
buildDependenciesFromSource: true
```

- [ ] **Step 2: `.gitignore`에 release/ 추가**

```
release/
```

- [ ] **Step 3: 커밋**

```bash
git add electron-builder.yml .gitignore
git commit -m "feat: add electron-builder config with ASAR and code signing"
```

---

### Task 8: Vite 설정 수정 — 소스맵 제거

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: vite.config.ts에 소스맵 비활성화 추가**

build 옵션에 추가:
```typescript
build: {
  outDir: path.resolve(__dirname, 'dist/client'),
  emptyOutDir: true,
  sourcemap: false,  // 리버스 엔지니어링 방지
},
```

- [ ] **Step 2: 커밋**

```bash
git add vite.config.ts
git commit -m "chore: disable source maps in production build"
```

---

### Task 9: 통합 테스트 — Electron 개발 모드 실행

- [ ] **Step 1: 빌드 확인**

```bash
npm run build && npm run build:electron
```

Expected: 에러 없이 dist/electron/main.js, preload.js, security.js 생성.

- [ ] **Step 2: Electron 개발 모드 실행**

```bash
npm run electron:dev
```

Expected: Electron 창이 열리고 터미널 UI가 정상 표시됨.

- [ ] **Step 3: 보안 확인**
- DevTools 단축키(Cmd+Shift+I, F12) 동작 안 함 확인
- 외부 URL 로드 시도 — 차단 확인

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore: verify Electron build integration"
```

---

### Task 10: Electron 패키징 빌드

- [ ] **Step 1: macOS DMG 빌드**

```bash
npm run electron:build:mac
```

Expected: `release/` 디렉토리에 `.dmg` 파일 생성.

- [ ] **Step 2: DMG 설치 후 앱 실행 확인**
- 앱이 정상 실행되는지 확인
- 터미널 세션 생성/입력 동작 확인
- DevTools 차단 확인

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: complete Electron build with security hardening"
```

---

## Security Checklist

| 항목 | 구현 |
|------|------|
| 외부 네트워크 차단 | 127.0.0.1 바인딩 + webRequest 필터 |
| DevTools 차단 | before-input-event + devtools-opened 이벤트 |
| Context Isolation | contextIsolation: true, sandbox: true |
| Node Integration 차단 | nodeIntegration: false |
| 소스맵 제거 | vite sourcemap: false, electron tsconfig sourceMap: false |
| JS 난독화 | javascript-obfuscator (서버 + 클라이언트) |
| ASAR 패키징 | electron-builder asar: true |
| CSP 헤더 | Content-Security-Policy 주입 |
| 새 창 차단 | setWindowOpenHandler deny |
| WebView 차단 | will-attach-webview preventDefault |
| macOS Hardened Runtime | hardenedRuntime: true |
