# Vite + TypeScript Client Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Client-side 바닐라 JS를 TypeScript로 일괄 전환하고, Vite 빌드 시스템을 도입하여 AI 코드 생성 정확도를 높인다.

**Architecture:** Vite dev server가 클라이언트를 담당하고 Express로 WS/API를 프록시. 33개 JS 파일을 일괄 .ts로 리네임하고, vendor 글로벌 스크립트를 npm import로 전환. strict: false로 시작.

**Tech Stack:** Vite, TypeScript (strict: false), xterm.js (npm import), CodeMirror 6 (npm import), Express (서버, 기존 유지)

**Spec:** `docs/superpowers/specs/2026-03-20-vite-ts-migration-design.md`

**Worktree:** `.worktrees/vite-ts` (branch: `feature/vite-ts-migration`)

---

## File Map

### New Files
- `vite.config.ts` — Vite 설정 (proxy, publicDir, build output)
- `client/tsconfig.json` — 클라이언트 전용 TypeScript 설정

### Modified Files
- `package.json` — scripts, dependencies 변경
- `server/index.ts:123-128` — vendor static routes 및 client static 서빙 변경
- `client/index.html` — vendor scripts/styles 제거, 단일 엔트리포인트
- `client/js/core/main.ts` — 엔트리포인트 확장 (file-editor, markdown-preview, scroll-float, mobile import)
- `client/js/terminal/terminal.ts` — xterm npm import, FitAddon/WebglAddon 호출 변경
- `client/js/editor/file-editor.ts` — codemirror-bundle → 직접 npm import
- `client/js/editor/file-viewer.ts` — window.MarkdownPreview/FileEditor → 직접 import
- `client/js/editor/markdown-preview.ts` — marked-bundle → 직접 npm import, window 글로벌 제거
- 33개 파일 모두: `.js` → `.ts` 리네임 + import 경로 `.js` 확장자 제거

### Deleted Files
- `client/js/codemirror-entry.js`
- `client/js/codemirror-bundle.js`
- `client/js/marked-entry.js`
- `client/js/marked-bundle.js`
- `client/vendor/highlightjs/` (전체 디렉토리)

---

## Task 1: Install Dependencies & Config Files

**Files:**
- Create: `vite.config.ts`
- Create: `client/tsconfig.json`
- Modify: `package.json`

- [ ] **Step 1: Install new dependencies**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.worktrees/vite-ts
npm install --save-dev --legacy-peer-deps vite concurrently @types/dompurify
```

- [ ] **Step 2: Remove esbuild**

```bash
npm uninstall esbuild --legacy-peer-deps
```

- [ ] **Step 3: Create `client/public/` and move static assets**

Vite의 `publicDir`은 `root`와 같은 디렉토리가 될 수 없으므로, `client/public/`을 만들고 static assets를 이동:

```bash
mkdir -p client/public
git mv client/favicon.svg client/public/
git mv client/icons client/public/
git mv client/fonts client/public/
# alert.m4a 등 기타 정적 파일이 있으면 같이 이동
ls client/*.m4a client/*.png client/*.ico 2>/dev/null && git mv client/*.m4a client/*.png client/*.ico client/public/ 2>/dev/null || true
```

`index.html`에서 이들의 상대 경로는 변경 불필요 — Vite가 `publicDir` 파일을 루트(`/`)에서 서빙.

- [ ] **Step 4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'client',
  publicDir: 'public', // client/public/ 의 static assets를 빌드에 포함
  build: {
    outDir: path.resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
});
```

- [ ] **Step 5: Create `client/tsconfig.json`**

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

- [ ] **Step 6: Update `package.json` scripts**

변경할 scripts:
```json
{
  "dev": "concurrently -n vite,server -c cyan,green \"vite --config vite.config.ts\" \"ts-node server/index.ts\"",
  "build": "vite build --config vite.config.ts && tsc -p tsconfig.json",
  "start": "NODE_ENV=production node dist/server/index.js",
  "typecheck": "tsc --noEmit && tsc --noEmit -p client/tsconfig.json",
  "format": "prettier --write \"server/**/*.ts\" \"client/**/*.{ts,css,html}\"",
  "format:check": "prettier --check \"server/**/*.ts\" \"client/**/*.{ts,css,html}\""
}
```

제거할 scripts: `build:editor`, `build:md`

`postinstall`에서 `&& npm run build:editor && npm run build:md` 부분 제거.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts client/tsconfig.json client/public/ package.json package-lock.json
git commit -m "feat: Vite + 클라이언트 TypeScript 빌드 인프라 추가"
```

---

## Task 2: Bulk Rename .js → .ts & Fix Import Paths

**Files:**
- Rename: 33개 `.js` → `.ts` 파일 (리스트는 spec Section 3 참조)
- Delete: `client/js/codemirror-entry.js`, `client/js/codemirror-bundle.js`, `client/js/marked-entry.js`, `client/js/marked-bundle.js`

- [ ] **Step 1: Rename all 33 .js files to .ts**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.worktrees/vite-ts
for f in $(find client/js -name '*.js' \
  ! -name 'codemirror-bundle.js' \
  ! -name 'codemirror-entry.js' \
  ! -name 'marked-bundle.js' \
  ! -name 'marked-entry.js'); do
  git mv "$f" "${f%.js}.ts"
done
```

- [ ] **Step 2: Delete bundle/entry files**

```bash
git rm client/js/codemirror-entry.js client/js/codemirror-bundle.js client/js/marked-entry.js client/js/marked-bundle.js
```

- [ ] **Step 3: Fix all import paths — remove `.js` extensions**

모든 `.ts` 파일에서 `from '...*.js'` → `from '...*'` (확장자 제거). 약 103개의 import 문.

```bash
find client/js -name '*.ts' -exec sed -i '' "s/from '\([^']*\)\.js'/from '\1'/g" {} +
```

검증: `grep "\.js'" client/js/**/*.ts` 로 남은 `.js` import가 없는지 확인. 남아있으면 수동 수정.

- [ ] **Step 4: Commit**

```bash
git add -A client/js/
git commit -m "refactor: 33개 JS 파일을 TS로 일괄 리네임 + import 경로 수정"
```

---

## Task 3: Vendor → npm Import (xterm)

**Files:**
- Modify: `client/js/terminal/terminal.ts:248-278` — xterm import 변경
- Modify: `client/index.html` — xterm script/link 태그 제거
- Modify: `server/index.ts:123-125` — vendor static routes 제거

- [ ] **Step 1: Add xterm imports to `terminal.ts`**

파일 상단에 추가:
```ts
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebglAddon } from 'xterm-addon-webgl'
import 'xterm/css/xterm.css'
```

- [ ] **Step 2: Fix xterm usage in `terminal.ts`**

변경 전:
```js
const fitAddon = new FitAddon.FitAddon();
// ...
if (typeof WebglAddon !== 'undefined') {
  webglAddon = new WebglAddon.WebglAddon();
```

변경 후:
```ts
const fitAddon = new FitAddon();
// ...
try {
  const webglAddon = new WebglAddon();
```

`typeof WebglAddon !== 'undefined'` 체크 제거 — npm import이므로 항상 사용 가능. try/catch는 WebGL 컨텍스트 실패 대비로 유지.

- [ ] **Step 3: Remove xterm vendor scripts/styles from `index.html`**

제거할 라인:
```html
<link rel="stylesheet" href="/vendor/xterm/css/xterm.css" />
<script src="/vendor/xterm/lib/xterm.js"></script>
<script src="/vendor/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
<script src="/vendor/xterm-addon-webgl/lib/xterm-addon-webgl.js"></script>
```

- [ ] **Step 4: Remove xterm Express static routes from `server/index.ts`**

`server/index.ts:123-125`의 다음 3줄 삭제:
```ts
app.use('/vendor/xterm', express.static(path.join(PROJECT_ROOT, 'node_modules/xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(PROJECT_ROOT, 'node_modules/xterm-addon-fit')));
app.use('/vendor/xterm-addon-webgl', express.static(path.join(PROJECT_ROOT, 'node_modules/xterm-addon-webgl')));
```

- [ ] **Step 5: Commit**

```bash
git add client/js/terminal/terminal.ts client/index.html server/index.ts
git commit -m "refactor: xterm vendor 글로벌 스크립트 → npm import 전환"
```

---

## Task 4: Vendor → npm Import (highlight.js)

**Files:**
- Modify: hljs 사용처 `.ts` 파일 (grep으로 확인)
- Modify: `client/index.html` — highlightjs script/link 제거
- Delete: `client/vendor/highlightjs/` 디렉토리

- [ ] **Step 1: Check hljs usage in client JS**

```bash
grep -rn 'hljs\.' client/js/ --include='*.ts'
```

highlight.js는 `index.html`에서 글로벌 스크립트로 로딩되지만, 클라이언트 JS에서 직접 `hljs`를 참조하는 곳이 없을 수 있음. 이 경우:
- `marked`가 코드 블록 하이라이팅에 hljs를 사용하는지 확인 (`markdown-preview.ts`의 `marked.setOptions` 확인)
- 사용하면: `markdown-preview.ts`에서 `import hljs from 'highlight.js'`하고 `marked`에 등록
- 사용하지 않으면: highlight.js를 완전히 제거 가능 (dependencies에서도 삭제)

hljs를 사용하는 파일이 있다면 해당 파일 상단에 import 추가:
```ts
import hljs from 'highlight.js'
```

CSS import는 앱 전체에서 한 번만. `main.ts`에 추가:
```ts
import 'highlight.js/styles/vs2015.css'
```

- [ ] **Step 2: Remove highlight.js from `index.html`**

제거할 라인:
```html
<link rel="stylesheet" href="vendor/highlightjs/styles/vs2015.min.css" />
<script src="vendor/highlightjs/highlight.min.js"></script>
```

- [ ] **Step 3: Delete vendor directory**

```bash
git rm -r client/vendor/highlightjs/
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: highlight.js vendor → npm import 전환 + vendor 디렉토리 삭제"
```

---

## Task 5: CodeMirror & Marked → Direct npm Import

**Files:**
- Modify: `client/js/editor/file-editor.ts:1-13` — codemirror-bundle → 직접 npm import
- Modify: `client/js/editor/markdown-preview.ts:2` — marked-bundle → 직접 npm import
- Modify: `client/js/editor/markdown-preview.ts:31` — `window.MarkdownPreview` 제거
- Modify: `client/js/editor/file-editor.ts:201` — `window.FileEditor` 제거
- Modify: `client/js/editor/file-viewer.ts:209,218,290,302` — window.MarkdownPreview → 직접 import

- [ ] **Step 1: Fix `file-editor.ts` imports**

변경 전:
```ts
import {
  EditorState, Compartment, EditorView, keymap, lineNumbers,
  // ... 많은 export들
} from '../codemirror-bundle.js';
```

변경 후 — 각 패키지에서 직접 import:
```ts
import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, openSearchPanel, search, highlightSelectionMatches } from '@codemirror/search'
import { syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { rust } from '@codemirror/lang-rust'
import { cpp } from '@codemirror/lang-cpp'
import { java } from '@codemirror/lang-java'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { tags } from '@lezer/highlight'
```

`@lezer/highlight`는 CodeMirror의 transitive dependency. 빌드 안정성을 위해 `package.json`에 명시적으로 추가:
```bash
npm install --save --legacy-peer-deps @lezer/highlight
```

`codemirror-entry.js`의 re-export 목록을 참조하여 누락 없이 매핑.

- [ ] **Step 2: Remove `window.FileEditor` from `file-editor.ts`**

파일 마지막줄 제거:
```ts
window.FileEditor = { createEditor, setReadOnly, getContent, destroyEditor };
```

- [ ] **Step 3: Fix `markdown-preview.ts` imports**

변경 전:
```ts
import { marked, DOMPurify } from '../marked-bundle.js';
```

변경 후:
```ts
import { marked } from 'marked'
import DOMPurify from 'dompurify'
```

- [ ] **Step 4: Remove `window.MarkdownPreview` from `markdown-preview.ts`**

파일 마지막줄 제거:
```ts
window.MarkdownPreview = { renderPreview, destroyPreview };
```

- [ ] **Step 5: Fix `file-viewer.ts` — window 글로벌 → 직접 import**

`file-viewer.ts`에서 `window.MarkdownPreview` 및 `window.FileEditor` 참조를 직접 import로 변경.

import 추가:
```ts
import { renderPreview, destroyPreview } from './markdown-preview'
```

(Note: `file-editor.ts`의 `createEditor` 등은 이미 `file-viewer.ts:5`에서 직접 import 중)

변경:
- `window.MarkdownPreview` → 직접 함수 호출 (`renderPreview`, `destroyPreview`)
- `if (isMarkdownFile(filePath) && window.MarkdownPreview)` → `if (isMarkdownFile(filePath))`

- [ ] **Step 6: Commit**

```bash
git add client/js/editor/
git commit -m "refactor: CodeMirror/marked 번들 → 직접 npm import + window 글로벌 제거"
```

---

## Task 6: index.html Entry Point & main.ts Expansion

**Files:**
- Modify: `client/index.html` — module script 태그 → 단일 엔트리
- Modify: `client/js/core/main.ts` — 추가 모듈 import

- [ ] **Step 1: Replace module scripts in `index.html`**

제거:
```html
<script type="module" src="js/editor/file-editor.js"></script>
<script type="module" src="js/editor/markdown-preview.js"></script>
<script type="module" src="js/ui/scroll-float.js"></script>
<script type="module" src="js/ui/mobile.js"></script>
<script type="module" src="js/core/main.js"></script>
```

추가 (같은 위치):
```html
<script type="module" src="js/core/main.ts"></script>
```

- [ ] **Step 2: Expand `main.ts` imports**

`main.ts` 상단에 추가 — 기존 별도 `<script>`로 로딩되던 모듈들:
```ts
// 기존 별도 script로 로딩되던 모듈 — 이제 main에서 import
import '../ui/scroll-float'
import '../ui/mobile'
import '../editor/file-editor'
import '../editor/markdown-preview'
```

Note: `file-editor`와 `markdown-preview`는 `window` 글로벌 노출이 제거되었으므로, `file-viewer.ts`에서 직접 import로 사용. `main.ts`의 import는 이 모듈들의 side-effect 초기화가 필요한 경우에만. `scroll-float`과 `mobile`은 자체 초기화 코드(이벤트 리스너 등)가 있으므로 import 필요.

실제로 `file-editor`와 `markdown-preview`는 side-effect가 없을 수 있음 (window 글로벌 제거 후). `file-viewer.ts`에서 직접 import하므로 `main.ts`에서는 불필요할 수 있음. 확인 후 불필요하면 제거.

- [ ] **Step 3: Verify — Vite dev server 기동 테스트**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.worktrees/vite-ts
npx vite --config vite.config.ts
```

Expected: Vite가 `client/` 루트에서 시작, `index.html`을 파싱하여 `js/core/main.ts`를 엔트리로 인식. 컴파일 에러가 있으면 브라우저 콘솔에 표시.

- [ ] **Step 4: Commit**

```bash
git add client/index.html client/js/core/main.ts
git commit -m "refactor: index.html 단일 엔트리포인트 + main.ts 모듈 통합"
```

---

## Task 7: Express Server Changes

**Files:**
- Modify: `server/index.ts:128` — client static 서빙을 NODE_ENV 분기

- [ ] **Step 1: Update Express static serving**

`server/index.ts:128` 변경:

변경 전:
```ts
app.use(express.static(path.join(PROJECT_ROOT, 'client')));
```

변경 후:
```ts
// Production: serve built client files; Development: Vite handles client
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(PROJECT_ROOT, 'dist/client')));
} else {
  // In dev, Vite serves client files. Express only handles API/WS.
  // Keep client static for any non-Vite direct access (fallback)
  app.use(express.static(path.join(PROJECT_ROOT, 'client')));
}
```

Note: vendor static routes는 Task 3에서 이미 제거됨.

- [ ] **Step 2: Commit**

```bash
git add server/index.ts
git commit -m "feat: Express 정적 파일 서빙 production/dev 분기"
```

---

## Task 8: Compile Check & Fix TS Errors

**Files:**
- Modify: 33개 `.ts` 파일 중 TS 에러가 나는 파일들

- [ ] **Step 1: Run TypeScript check**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.worktrees/vite-ts
npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -100
```

Expected: `strict: false`이므로 대부분 통과하지만, 일부 에러 예상:
- `document.getElementById()` 반환값의 null 체이닝 (`state.ts:34`의 `dropOverlay.querySelectorAll`)
- xterm/highlight.js 글로벌 참조가 남아있을 수 있음
- `codemirror-bundle` import 경로가 아직 남아있을 수 있음

- [ ] **Step 2: Fix TS errors one by one**

일반적인 수정 패턴:
- `document.getElementById('x')` → `document.getElementById('x')!` 또는 `as HTMLElement`
- 남은 글로벌 참조 → npm import로 교체
- 기타 타입 에러 → 최소한의 타입 캐스팅

- [ ] **Step 3: Run TypeScript check again**

```bash
npx tsc --noEmit -p client/tsconfig.json
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add -A client/js/
git commit -m "fix: TypeScript 컴파일 에러 수정 (strict: false)"
```

---

## Task 9: Full Dev Server Smoke Test

- [ ] **Step 1: Start both servers**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.worktrees/vite-ts
npm run dev
```

Expected: Vite (5173) + Express (3000) 모두 시작.

- [ ] **Step 2: Verify in browser**

브라우저에서 `http://localhost:5173` 접속:
- [ ] 터미널 UI 로드됨
- [ ] 새 세션 생성 가능 (WebSocket 프록시 동작)
- [ ] 터미널 입출력 동작
- [ ] 사이드바 (Source Control, Search, Explorer, Plan) 동작
- [ ] Settings 모달 열림
- [ ] Git Graph 열림
- [ ] 파일 에디터(CodeMirror) 동작
- [ ] 마크다운 프리뷰 동작

- [ ] **Step 3: Fix any runtime errors**

브라우저 콘솔에서 에러 확인 및 수정.

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix: dev server smoke test에서 발견된 런타임 에러 수정"
```

---

## Task 10: Production Build Verification

- [ ] **Step 1: Run production build**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal/.worktrees/vite-ts
npm run build
```

Expected: `dist/client/`에 빌드된 파일 생성, `dist/server/`에 서버 코드 컴파일.

- [ ] **Step 2: Verify build output**

```bash
ls dist/client/
```

Expected: `index.html`, `assets/` (JS/CSS 번들), `icons/`, `fonts/`, `favicon.svg` 등 static assets 포함.

Static assets가 누락되면 `vite.config.ts`에서 `publicDir` 설정 조정 또는 `client/public/` 디렉토리로 이동.

- [ ] **Step 3: Test production server**

```bash
NODE_ENV=production node dist/server/index.js
```

브라우저에서 `http://localhost:3000` 접속, 기본 동작 확인.

- [ ] **Step 4: Commit final adjustments**

```bash
git add -A
git commit -m "fix: 프로덕션 빌드 검증 및 static asset 설정"
```
