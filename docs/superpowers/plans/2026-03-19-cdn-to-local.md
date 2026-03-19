# CDN 의존성 로컬 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CDN 의존성(xterm.js, highlight.js, Google Fonts)을 로컬 서빙으로 전환하여 오프라인 동작 및 보안을 확보한다.

**Architecture:** npm 패키지로 xterm/highlight.js를 설치하고 Express에서 `/vendor/` 경로로 static serve한다. Google Fonts는 woff2 파일을 `client/fonts/`에 셀프호스팅한다.

**Tech Stack:** Express static middleware, npm (xterm, xterm-addon-fit, highlight.js), Google Fonts woff2

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `package.json` | xterm, xterm-addon-fit, highlight.js 의존성 추가 |
| Modify | `server/index.ts:121` | `/vendor/` static 경로 추가 |
| Create | `client/fonts/fonts.css` | @font-face 선언 (8개 모노스페이스 폰트) |
| Create | `client/fonts/*.woff2` | 폰트 파일들 |
| Modify | `client/index.html:8-18,1414-1416` | CDN → 로컬 경로 교체 |
| Modify | `client/login.html:8-11` | Google Fonts CDN → 로컬 교체 |

---

### Task 1: npm 패키지 설치

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 패키지 설치**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal
npm install xterm@5.3.0 xterm-addon-fit@0.8.0 highlight.js@11.9.0
```

- [ ] **Step 2: 설치 확인**

```bash
ls node_modules/xterm/css/xterm.css
ls node_modules/xterm/lib/xterm.js
ls node_modules/xterm-addon-fit/lib/xterm-addon-fit.js
ls node_modules/highlight.js/styles/vs2015.min.css
ls node_modules/highlight.js/lib/core.js
```

highlight.js npm 패키지 구조 주의: CDN 빌드(`highlight.min.js`)와 npm 빌드 경로가 다를 수 있다. 실제 경로를 확인한 후 Task 3에서 사용할 것.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add xterm, xterm-addon-fit, highlight.js as local dependencies"
```

---

### Task 2: Express vendor 경로 추가

**Files:**
- Modify: `server/index.ts:121`

- [ ] **Step 1: vendor static 경로 추가**

`server/index.ts`의 `app.use(authMiddleware)` 줄(121행) **바로 위에** vendor 경로를 추가한다. authMiddleware 뒤에 넣으면 인증이 필요해지므로 반드시 앞에 배치.

```typescript
// Vendor libraries (served without auth, before authMiddleware)
app.use('/vendor/xterm', express.static(path.join(PROJECT_ROOT, 'node_modules/xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.join(PROJECT_ROOT, 'node_modules/xterm-addon-fit')));
app.use('/vendor/highlightjs', express.static(path.join(PROJECT_ROOT, 'node_modules/highlight.js')));
```

주의: `authMiddleware` 위에 배치해야 한다. 로그인 페이지에서도 이 리소스가 필요할 수 있기 때문.

- [ ] **Step 2: 서버 시작 확인**

```bash
npm run dev
# 별도 터미널에서:
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/vendor/xterm/css/xterm.css
# Expected: 200
```

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: serve vendor libraries locally via /vendor/ routes"
```

---

### Task 3: Google Fonts 셀프호스팅

**Files:**
- Create: `client/fonts/fonts.css`
- Create: `client/fonts/*.woff2`

- [ ] **Step 1: 폰트 woff2 파일 다운로드**

google-webfonts-helper 또는 직접 Google Fonts API에서 woff2 URL을 추출하여 다운로드한다.

필요한 폰트 목록 (모두 Latin subset):
1. JetBrains Mono — wght 300,400,500,600,700
2. Share Tech Mono — wght 400
3. Fira Code — wght 300,400,500,600,700
4. IBM Plex Mono — wght 300,400,500,600,700
5. Source Code Pro — wght 300,400,500,600,700
6. Inconsolata — wght 300,400,500,600,700
7. Space Mono — wght 400,700
8. Roboto Mono — wght 300,400,500,600,700

```bash
mkdir -p client/fonts
# 각 폰트별 woff2 다운로드 (google-webfonts-helper 또는 직접)
# 파일명 컨벤션: {font-name}-{weight}.woff2
# 예: jetbrains-mono-300.woff2, jetbrains-mono-400.woff2, ...
```

- [ ] **Step 2: fonts.css 작성**

`client/fonts/fonts.css`에 모든 @font-face 선언을 작성한다.

```css
/* JetBrains Mono */
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 300;
  font-display: swap;
  src: url('jetbrains-mono-300.woff2') format('woff2');
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('jetbrains-mono-400.woff2') format('woff2');
}
/* ... 나머지 weight + 나머지 7개 폰트도 동일 패턴 */
```

- [ ] **Step 3: Commit**

```bash
git add client/fonts/
git commit -m "assets: add self-hosted Google Fonts woff2 files"
```

---

### Task 4: index.html CDN 참조를 로컬로 교체

**Files:**
- Modify: `client/index.html:8-18` (head의 CDN link/preconnect)
- Modify: `client/index.html:1414-1416` (body 하단 script 태그)

- [ ] **Step 1: head 섹션 교체**

삭제할 줄 (8-18행):
```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Share+Tech+Mono&family=Fira+Code:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Source+Code+Pro:wght@300;400;500;600;700&family=Inconsolata:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Roboto+Mono:wght@300;400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/vs2015.min.css"
    />
```

교체할 내용:
```html
    <link rel="stylesheet" href="fonts/fonts.css" />
    <link rel="stylesheet" href="/vendor/xterm/css/xterm.css" />
    <link rel="stylesheet" href="/vendor/highlightjs/styles/vs2015.min.css" />
```

- [ ] **Step 2: script 태그 교체**

삭제할 줄 (1414-1416행):
```html
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
    <script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
```

교체할 내용:
```html
    <script src="/vendor/xterm/lib/xterm.js"></script>
    <script src="/vendor/xterm-addon-fit/lib/xterm-addon-fit.js"></script>
    <script src="/vendor/highlightjs/lib/core.js"></script>
```

**주의:** highlight.js npm 패키지의 빌드 파일 경로를 Task 1 Step 2에서 확인한 실제 경로로 사용할 것. `highlight.min.js`(CDN 번들)과 `core.js`(npm)는 API가 다를 수 있다 — `hljs.highlightElement()`가 동작하는지 확인 필요.

- [ ] **Step 3: Commit**

```bash
git add client/index.html
git commit -m "refactor: replace CDN references with local vendor paths in index.html"
```

---

### Task 5: login.html CDN 참조를 로컬로 교체

**Files:**
- Modify: `client/login.html:8-11`

- [ ] **Step 1: Google Fonts CDN 교체**

삭제할 줄 (8-11행):
```html
    <link
      href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap"
      rel="stylesheet"
    />
```

교체할 내용:
```html
    <link rel="stylesheet" href="fonts/fonts.css" />
```

- [ ] **Step 2: Commit**

```bash
git add client/login.html
git commit -m "refactor: replace Google Fonts CDN with local fonts in login.html"
```

---

### Task 6: highlight.js 호환성 검증

**Files:**
- 검증 대상: `client/js/*.js` 에서 `hljs` 사용 부분

- [ ] **Step 1: hljs 사용 패턴 확인**

```bash
grep -rn "hljs\." client/js/
```

CDN 빌드(`highlight.min.js`)는 모든 언어가 포함된 번들이지만, npm의 `core.js`는 언어를 수동 등록해야 한다. 사용 패턴에 따라:
- `hljs.highlightElement()` 또는 `hljs.highlightAll()` → 언어 자동 감지 필요 → npm 번들(`highlight.min.js` 아닌 `highlight.js` 또는 CDN-style 빌드) 사용 필요
- 특정 언어만 사용 → `core.js` + 개별 언어 등록 가능

npm 패키지에 CDN 스타일 번들이 포함되어 있는지 확인:
```bash
ls node_modules/highlight.js/lib/highlight.js  # 번들 버전 존재 여부
find node_modules/highlight.js -name "*.js" -maxdepth 2
```

호환되지 않으면 npm `highlight.js` 대신 CDN 릴리즈의 `highlight.min.js`를 `client/vendor/`에 직접 복사하는 방안으로 전환한다.

- [ ] **Step 2: 브라우저에서 동작 확인**

서버를 시작하고 브라우저에서:
1. 터미널이 정상 렌더링되는지 (xterm.js)
2. 코드 하이라이팅이 동작하는지 (highlight.js)
3. 폰트가 정상 로드되는지 (DevTools → Network → fonts)
4. 설정에서 폰트 변경이 동작하는지

- [ ] **Step 3: 외부 CDN 참조가 남아있지 않은지 최종 확인**

```bash
grep -rn "cdn\.jsdelivr\|fonts\.googleapis\|fonts\.gstatic" client/
# Expected: 결과 없음
```

- [ ] **Step 4: Commit (필요 시)**

```bash
git add -A
git commit -m "fix: ensure highlight.js compatibility with local bundle"
```
