# Client-Side Vite + TypeScript Migration

**Date:** 2026-03-20
**Branch:** `feature/vite-ts-migration`
**Scope:** `client/` 디렉토리 전체 — 서버 코드 변경 최소화

## Context

현재 클라이언트는 바닐라 JS 37개 파일(소스 33 + 번들/엔트리 4, ~11,000 LOC), `type="module"` ES import/export, vendor 글로벌 스크립트 로딩 방식. xterm은 `vendor/` 폴더가 아닌 Express의 `express.static`으로 `node_modules/`에서 서빙 중. 바이브 코딩 워크플로우에서 AI 코드 생성 정확도를 높이기 위해 TypeScript 전환이 필요.

## Decisions

| 항목 | 결정 |
|------|------|
| 빌드 도구 | Vite |
| 개발 서버 | Vite 단독 (Express는 API/WS만) |
| vendor 라이브러리 | npm import로 통합, vendor 폴더 제거 |
| 전환 방식 | 일괄 `.js` → `.ts` 리네임 |
| strict 모드 | `strict: false`로 시작 |

## 1. Build Infrastructure

### `vite.config.ts`

- `root: 'client/'`
- `build.outDir: '../dist/client'`
- `publicDir: 'public'` 또는 static assets(`icons/`, `fonts/`, `favicon.svg`)를 Vite가 처리하도록 설정
- `server.proxy`:
  ```ts
  proxy: {
    '/ws': { target: 'ws://localhost:3000', ws: true },
    '/api': { target: 'http://localhost:3000' }
  }
  ```

### `client/tsconfig.json` (new)

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "strict": false,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["js/**/*"]
}
```

### Root `tsconfig.json`

- 변경 없음 — 서버 전용 유지. 클라이언트는 자체 tsconfig 사용.

### `package.json` scripts

```json
{
  "dev": "concurrently \"vite --config vite.config.ts\" \"ts-node server/index.ts\"",
  "build": "vite build && tsc -p tsconfig.json",
  "start": "node dist/server/index.js"
}
```

- `build:editor`, `build:md` 스크립트 제거
- `postinstall`에서 `npm run build:editor && npm run build:md` 제거

### New Dependencies

- `vite` (devDep)
- `concurrently` (devDep)
- `@types/dompurify` (devDep) — markdown-preview.ts에서 사용

### Removable Dependencies

- `esbuild` (devDep) — CodeMirror/marked 번들링에만 사용, Vite가 대체

### Script Updates

- `format`: `client/**/*.{js,css,html}` → `client/**/*.{ts,css,html}`
- `typecheck`: `tsc --noEmit` → `tsc --noEmit && tsc --noEmit -p client/tsconfig.json` (서버 + 클라이언트)

## 2. Vendor Removal & npm Import

### xterm.js

**Before (index.html):**
```html
<link rel="stylesheet" href="/vendor/xterm/css/xterm.css" />
<script src="/vendor/xterm/lib/xterm.js"></script>
<script src="/vendor/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
<script src="/vendor/xterm-addon-webgl/lib/xterm-addon-webgl.js"></script>
```

**After (terminal.ts):**
```ts
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebglAddon } from 'xterm-addon-webgl'
import 'xterm/css/xterm.css'
```

- xterm은 실제로 `vendor/` 폴더에 없고 Express static route로 `node_modules/`에서 서빙 → 해당 Express static route 3개 제거 (`/vendor/xterm`, `/vendor/xterm-addon-fit`, `/vendor/xterm-addon-webgl`)
- `new Terminal()`, `new FitAddon.FitAddon()` → `new FitAddon()` 등 호출 방식 변경

### highlight.js

**Before (index.html):**
```html
<link rel="stylesheet" href="vendor/highlightjs/styles/vs2015.min.css" />
<script src="vendor/highlightjs/highlight.min.js"></script>
```

**After (사용처 .ts 파일):**
```ts
import hljs from 'highlight.js'
import 'highlight.js/styles/vs2015.css'
```

- `vendor/highlightjs/` 삭제

### CodeMirror & marked (esbuild → Vite)

- `codemirror-entry.js`, `codemirror-bundle.js` 삭제
- `marked-entry.js`, `marked-bundle.js` 삭제
- 사용처에서 직접 npm import:
  ```ts
  // file-editor.ts
  import { EditorState } from '@codemirror/state'
  import { EditorView } from '@codemirror/view'

  // markdown-preview.ts
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  ```

### Global exposure removal

- `window.MarkdownPreview` (markdown-preview.js) → 직접 import
- `window.FileEditor` (file-editor.js) → 직접 import

## 3. JS → TS Bulk Conversion

### Rename

33개 파일 일괄 `.js` → `.ts`:
```
client/js/core/main.js         → main.ts
client/js/core/state.js        → state.ts
client/js/core/constants.js    → constants.ts
client/js/core/keyboard.js     → keyboard.ts
client/js/core/websocket.js    → websocket.ts
client/js/terminal/terminal.js → terminal.ts
client/js/terminal/session.js  → session.ts
client/js/terminal/split-pane.js → split-pane.ts
client/js/terminal/stream-writer.js → stream-writer.ts
client/js/terminal/control-panel.js → control-panel.ts
client/js/ui/themes.js         → themes.ts
client/js/ui/settings.js       → settings.ts
client/js/ui/notifications.js  → notifications.ts
client/js/ui/tab-status.js     → tab-status.ts
client/js/ui/toast.js          → toast.ts
client/js/ui/context-menu.js   → context-menu.ts
client/js/ui/confirm-modal.js  → confirm-modal.ts
client/js/ui/scroll-float.js   → scroll-float.ts
client/js/ui/mobile.js         → mobile.ts
client/js/ui/image-attach.js   → image-attach.ts
client/js/ui/file-icons.js     → file-icons.ts
client/js/ui/folder.js         → folder.ts
client/js/sidebar/explorer.js  → explorer.ts
client/js/sidebar/search.js    → search.ts
client/js/sidebar/source-control.js → source-control.ts
client/js/sidebar/git-graph.js → git-graph.ts
client/js/sidebar/activity-bar.js → activity-bar.ts
client/js/sidebar/plan-panel.js → plan-panel.ts
client/js/sidebar/prompt-history.js → prompt-history.ts
client/js/editor/file-editor.js → file-editor.ts
client/js/editor/file-viewer.js → file-viewer.ts
client/js/editor/chat-editor.js → chat-editor.ts
client/js/editor/markdown-preview.js → markdown-preview.ts
```

### Import paths

- `from './state.js'` → `from './state'` (확장자 제거)
- 모든 파일의 모든 import에 적용

### Type handling (strict: false)

- DOM: `document.getElementById()` 리턴값에 최소 캐스팅 (`as HTMLElement`)
- `state.ts`의 `S` 객체: 현재 구조 유지, 타입 추론에 맡김
- JSDoc 주석: 제거하지 않음 (TS가 무시)

### Files to delete

- `client/js/codemirror-entry.js`
- `client/js/codemirror-bundle.js`
- `client/js/marked-entry.js`
- `client/js/marked-bundle.js`

## 4. index.html Changes

### Remove

```html
<!-- vendor scripts & styles -->
<script src="/vendor/xterm/lib/xterm.js"></script>
<script src="/vendor/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
<script src="/vendor/xterm-addon-webgl/lib/xterm-addon-webgl.js"></script>
<script src="vendor/highlightjs/highlight.min.js"></script>
<link rel="stylesheet" href="/vendor/xterm/css/xterm.css" />
<link rel="stylesheet" href="vendor/highlightjs/styles/vs2015.min.css" />

<!-- separate module scripts -->
<script type="module" src="js/editor/file-editor.js"></script>
<script type="module" src="js/editor/markdown-preview.js"></script>
<script type="module" src="js/ui/scroll-float.js"></script>
<script type="module" src="js/ui/mobile.js"></script>
<script type="module" src="js/core/main.js"></script>
```

### Add

```html
<script type="module" src="js/core/main.ts"></script>
```

단일 엔트리포인트. 나머지 모듈은 import 체인으로 로딩.

### `main.ts` entry point expansion

`file-editor`, `markdown-preview`, `scroll-float`, `mobile` 모듈을 main.ts에서 import하여 초기화.

## 5. Express Server Changes

### Vendor static routes 제거

`server/index.ts`에서 xterm 관련 `express.static` 라우트 3개 제거:
```ts
// 이 3줄 삭제
app.use('/vendor/xterm', express.static(...))
app.use('/vendor/xterm-addon-fit', express.static(...))
app.use('/vendor/xterm-addon-webgl', express.static(...))
```

### Development

- `client/` 정적 파일 서빙 코드 제거 또는 `NODE_ENV` 분기
- Vite dev server가 프론트엔드 담당

### Production

- `express.static('dist/client')` — 빌드된 파일 서빙
- WS, API 라우트 변경 없음

### Static Assets

- `fonts/fonts.css`, `styles.css` → `index.html`의 `<link>` 태그 유지 (Vite가 처리)
- `icons/`, `fonts/`, `favicon.svg` → Vite `publicDir` 설정 또는 HTML 참조를 통해 빌드에 포함
- 컨트롤 패널 HTML 마크업 → 변경 없음

## 6. Development & Production Workflow

### Development

```bash
npm run dev
# → concurrently:
#   1. vite (port 5173) — HMR, TS transpile, proxy to Express
#   2. ts-node server/index.ts (port 3000) — WS, API
# → 브라우저: http://localhost:5173
```

### Production

```bash
npm run build   # vite build + tsc
npm start       # node dist/server/index.js
# → 브라우저: http://localhost:3000
```

## Known Risks

- **xterm HMR**: xterm Terminal 인스턴스는 canvas/WebGL 상태를 보유하여 HMR이 제대로 안 될 수 있음. 터미널 관련 변경 시 full reload 필요할 수 있음.
- **xterm CSS**: xterm v5의 CSS가 번들러 환경에서 WebGL addon과 호환성 이슈 가능. 발생 시 CSS를 `index.html`에서 직접 로딩으로 롤백.
- **concurrently 시작 순서**: Express가 준비되기 전에 브라우저가 열리면 WS 연결 실패. Vite의 `server.open` 비활성화 또는 Express 준비 후 열기.

## Not In Scope

- strict 모드 활성화 (추후 점진적으로)
- 서버 코드 변경 (API/WS 로직 — vendor static route 제거는 예외)
- CSS 변경
- 기존 로직/함수 시그니처 변경
- 테스트 프레임워크 도입
- `control-server/` 디렉토리 및 관련 스크립트 (`dev:control`, `build:control` 등)
