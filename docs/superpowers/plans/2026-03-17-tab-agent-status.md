# Tab Agent Status Indicator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 각 탭에 에이전트/셸의 현재 상태를 실시간으로 dot 색상 + 한국어 텍스트로 표시한다.

**Architecture:** 기존 `tab-indicator` dot을 재활용하고 `tab-status-text` span을 추가. 새 `tab-status.js` 모듈이 터미널 출력 패턴 매칭으로 상태를 감지하고 탭 UI를 업데이트. `stripAnsi()`를 `state.js`로 이동하여 `notifications.js`와 공유.

**Tech Stack:** Vanilla JS (ES Modules), CSS custom properties, xterm.js

**Spec:** `docs/superpowers/specs/2026-03-17-tab-agent-status-design.md`

---

### File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Move utility | `client/js/state.js` | `stripAnsi()` 추가, `tabStatusState` Map 추가 |
| Modify | `client/js/notifications.js:25-30` | `stripAnsi()` 제거 → `state.js`에서 import |
| Create | `client/js/tab-status.js` | 상태 감지 엔진 + 탭 UI 업데이트 |
| Modify | `client/js/terminal.js:319-328` | `createTab()`에 `tab-status-text` 추가, `data-status` 설정 |
| Modify | `client/js/terminal.js:77-104` | `closeSession()`에 `resetTabStatus()` 호출 |
| Modify | `client/js/main.js:1-11` | import 추가 |
| Modify | `client/js/main.js:56-61` | `output` 핸들러에 `tabStatusCheck()` 추가 |
| Modify | `client/js/main.js:53-55` | `session_info` 핸들러에 `tabStatusOnAiChange()` 추가 |
| Modify | `client/js/main.js:24-27` | reconnect 시 suppress 호출 |
| Modify | `client/styles.css:150-153` | `tab-indicator` transition, `data-status` 스타일, `tab-status-text` 스타일 |

---

### Task 1: `stripAnsi()` 공유 유틸로 이동

**Files:**
- Modify: `client/js/state.js:44-46`
- Modify: `client/js/notifications.js:1,25-30`

- [ ] **Step 1: `state.js`에 `stripAnsi()` 추가**

`client/js/state.js` 파일 끝에 추가:

```javascript
export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[mGKHFABCDJsuhl]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/[\x00-\x09\x0b-\x1f]/g, '');
}
```

- [ ] **Step 2: `state.js`에 `tabStatusState` Map 추가**

`notifyState` 선언 아래에 추가:

```javascript
export const tabStatusState = new Map();
```

- [ ] **Step 3: `notifications.js`에서 `stripAnsi()` 제거하고 import**

`notifications.js`의 import 줄을 수정:
```javascript
import { S, sessionMeta, terminalMap, notifyBuffers, notifyTimers, notifyState, escHtml, stripAnsi } from './state.js';
```

`notifications.js`에서 로컬 `stripAnsi` 함수 정의 (lines 25-30) 삭제.

- [ ] **Step 4: 브라우저에서 기존 알림 동작 확인**

Run: `npm run dev` (서버가 이미 실행 중이면 브라우저 새로고침)
Expected: 기존 토스트/OS 알림이 정상 동작 (기능 변경 없음)

- [ ] **Step 5: Commit**

```bash
git add client/js/state.js client/js/notifications.js
git commit -m "refactor: stripAnsi()를 state.js로 이동하여 공유 유틸로 변환"
```

---

### Task 2: `tab-status.js` 모듈 생성

**Files:**
- Create: `client/js/tab-status.js`

- [ ] **Step 1: `tab-status.js` 파일 생성**

```javascript
import { sessionMeta, terminalMap, tabStatusState, stripAnsi } from './state.js';

// ─── Constants ───────────────────────────────────────
const STATUS_DEBOUNCE = 800;
const DONE_TO_IDLE_MS = 3000;
const BUFFER_MAX = 2048;

// ─── AI-specific patterns (Claude Code) ──────────────
const CLAUDE_PATTERNS = [
  { re: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Puzzling\.\.\.|Thinking\.\.\./,
    status: 'thinking', text: '생각 중...' },
  { re: /^[\s•⚡●◐▸]*(?:Read|Edit|Write|Glob|Grep|NotebookEdit)\b/m,
    status: 'tool', text: '파일 편집 중' },
  { re: /^[\s•⚡●◐▸]*(?:Bash|WebFetch|WebSearch|Task)\b/m,
    status: 'tool', text: '명령 실행 중' },
  { re: /^[❯>]\s*$/m, status: 'question', text: '입력 대기',
    lastLineOnly: true },
  { re: /✓|✔|Task complete|Done\./i,
    status: 'done', text: '완료' },
];

// ─── General AI patterns ─────────────────────────────
const GENERAL_AI_PATTERNS = [
  { re: /^[❯>]\s*$/m, status: 'question', text: '입력 대기', lastLineOnly: true },
  { re: /✓|✔|Done|Completed|Finished/i, status: 'done', text: '완료' },
];

// ─── Shell patterns ──────────────────────────────────
const SHELL_PATTERNS = [
  { re: /\[y\/N\]|\[Y\/n\]|password:|Password:|passphrase/i,
    status: 'question', text: '입력 대기', lastLineOnly: true },
  { re: /[\$❯›»#%]\s*$/, status: 'idle', text: '대기', lastLineOnly: true },
];

// ─── Internal state ──────────────────────────────────
const statusBuffers = new Map();
const statusTimers = new Map();
const doneTimers = new Map();
const suppressUntil = new Map();

// ─── Core API ────────────────────────────────────────

export function tabStatusCheck(sessionId, chunk) {
  const now = Date.now();
  const suppressed = suppressUntil.get(sessionId);
  if (suppressed && now < suppressed) return;

  const prev = statusBuffers.get(sessionId) || '';
  const next = (prev + chunk).slice(-BUFFER_MAX);
  statusBuffers.set(sessionId, next);

  clearTimeout(statusTimers.get(sessionId));
  statusTimers.set(sessionId, setTimeout(() => {
    const buf = stripAnsi(statusBuffers.get(sessionId) || '');
    if (!buf.trim()) return;

    const meta = sessionMeta.get(sessionId);
    const ai = meta?.ai || null;

    let matched = null;

    if (ai) {
      const patterns = (ai === 'claude') ? CLAUDE_PATTERNS : GENERAL_AI_PATTERNS;
      for (const p of patterns) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      // AI active but no pattern matched → default to thinking
      if (!matched) {
        matched = { status: 'thinking', text: '생각 중...' };
      }
    } else {
      // Shell mode
      for (const p of SHELL_PATTERNS) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      if (!matched) {
        matched = { status: 'working', text: '작업 중...' };
      }
    }

    updateTabUI(sessionId, matched.status, matched.text);
  }, STATUS_DEBOUNCE));
}

export function tabStatusOnAiChange(sessionId, ai) {
  statusBuffers.set(sessionId, '');
  clearTimeout(statusTimers.get(sessionId));
  clearTimeout(doneTimers.get(sessionId));
  suppressUntil.delete(sessionId);
  updateTabUI(sessionId, 'idle', '대기');
}

export function resetTabStatus(sessionId) {
  statusBuffers.delete(sessionId);
  clearTimeout(statusTimers.get(sessionId));
  statusTimers.delete(sessionId);
  clearTimeout(doneTimers.get(sessionId));
  doneTimers.delete(sessionId);
  suppressUntil.delete(sessionId);
  tabStatusState.delete(sessionId);
}

export function suppressTabStatus(sessionId, durationMs) {
  suppressUntil.set(sessionId, Date.now() + durationMs);
}

// ─── Internal helpers ────────────────────────────────

function getLastLine(buf) {
  const lines = buf.split('\n').filter(l => l.trim());
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function updateTabUI(sessionId, status, text) {
  const prev = tabStatusState.get(sessionId);
  if (prev === status) return;

  tabStatusState.set(sessionId, status);

  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  // Update tab data-status attribute
  entry.tabEl.dataset.status = status;

  // Update tab-indicator aria-label
  const indicator = entry.tabEl.querySelector('.tab-indicator');
  if (indicator) indicator.setAttribute('aria-label', text);

  // Update status text element
  const statusTextEl = entry.tabEl.querySelector('.tab-status-text');
  if (statusTextEl) statusTextEl.textContent = text;

  // Handle done → idle auto-transition
  clearTimeout(doneTimers.get(sessionId));
  if (status === 'done') {
    doneTimers.set(sessionId, setTimeout(() => {
      updateTabUI(sessionId, 'idle', '대기');
    }, DONE_TO_IDLE_MS));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/tab-status.js
git commit -m "feat: tab-status.js 모듈 생성 — 탭 상태 감지 엔진"
```

---

### Task 3: `terminal.js` 수정 — 탭 HTML 변경

> **Note:** Task 2에서 `tab-status.js`가 생성되어야 이 Task의 import가 동작합니다. Task 2와 3은 연속으로 실행하세요.

**Files:**
- Modify: `client/js/terminal.js:1` (import 추가)
- Modify: `client/js/terminal.js:319-328` (`createTab()`)
- Modify: `client/js/terminal.js:77-104` (`closeSession()`)

- [ ] **Step 1: `terminal.js`에 `resetTabStatus` import 추가**

import 줄 추가 (기존 import 아래):
```javascript
import { resetTabStatus } from './tab-status.js';
```

- [ ] **Step 2: `createTab()`에서 `tab-status-text` 추가 및 `data-status` 설정**

`createTab()` 함수의 `el.innerHTML` 부분 수정 (lines 324-328):

Before:
```javascript
  el.innerHTML = `
    <div class="tab-indicator"></div>
    <span class="tab-name">${escHtml(name)}</span>
    <button class="tab-close-btn">✕</button>
  `;
```

After:
```javascript
  el.dataset.status = 'idle';
  el.innerHTML = `
    <div class="tab-indicator" aria-label="대기"></div>
    <span class="tab-name">${escHtml(name)}</span>
    <span class="tab-status-text">대기</span>
    <button class="tab-close-btn">✕</button>
  `;
```

- [ ] **Step 3: `closeSession()`에 `resetTabStatus()` 호출 추가**

`closeSession()` 함수 내, `sessionMeta.delete(id)` 줄 (line 92) 앞에 추가:

```javascript
    resetTabStatus(id);
```

- [ ] **Step 4: Commit**

```bash
git add client/js/terminal.js
git commit -m "feat: createTab()에 tab-status-text 추가, closeSession()에 정리 로직"
```

---

### Task 4: `main.js` 수정 — 핸들러 연결

**Files:**
- Modify: `client/js/main.js:1-11` (import)
- Modify: `client/js/main.js:24-27` (reconnect suppress)
- Modify: `client/js/main.js:53-55` (session_info handler)
- Modify: `client/js/main.js:56-61` (output handler)

- [ ] **Step 1: `main.js`에 tab-status import 추가**

기존 import 블록 (line 9 이후)에 추가:

```javascript
import { tabStatusCheck, tabStatusOnAiChange, suppressTabStatus } from './tab-status.js';
```

- [ ] **Step 2: `session_list` 핸들러에 reconnect suppress 추가**

`handleMessage()` 내 `session_list` 분기 (lines 25-31)에서, `syncSessionList` 호출 후, `S.wsJustReconnected` 확인 전에 추가:

Before (lines 25-27):
```javascript
    syncSessionList(msg.sessions, S.wsJustReconnected);
    S.wsJustReconnected = false;
```

After:
```javascript
    syncSessionList(msg.sessions, S.wsJustReconnected);
    if (S.wsJustReconnected) {
      msg.sessions.forEach(s => suppressTabStatus(s.id, 2000));
    }
    S.wsJustReconnected = false;
```

- [ ] **Step 3: `session_info` 핸들러에 `tabStatusOnAiChange()` 추가**

`session_info` 분기 (lines 53-55)에서, `updateSessionInfo` 호출 후에 추가:

Before:
```javascript
  } else if (msg.type === 'session_info') {
    updateSessionInfo(msg.sessionId, msg.cwd, msg.ai);
    if (msg.sessionId === S.activeSessionId) requestBranch(msg.sessionId);
```

After:
```javascript
  } else if (msg.type === 'session_info') {
    updateSessionInfo(msg.sessionId, msg.cwd, msg.ai);
    tabStatusOnAiChange(msg.sessionId, msg.ai);
    if (msg.sessionId === S.activeSessionId) requestBranch(msg.sessionId);
```

- [ ] **Step 4: `output` 핸들러에 `tabStatusCheck()` 추가**

`output` 분기 (lines 56-61)에서, `aiNotifyCheck` 호출 후에 추가:

Before:
```javascript
  } else if (msg.type === 'output') {
    const entry = terminalMap.get(msg.sessionId);
    if (entry) {
      entry.term.write(msg.data);
      aiNotifyCheck(msg.sessionId, msg.data);
    }
```

After:
```javascript
  } else if (msg.type === 'output') {
    const entry = terminalMap.get(msg.sessionId);
    if (entry) {
      entry.term.write(msg.data);
      aiNotifyCheck(msg.sessionId, msg.data);
      tabStatusCheck(msg.sessionId, msg.data);
    }
```

- [ ] **Step 5: Commit**

```bash
git add client/js/main.js
git commit -m "feat: main.js에 tab-status 핸들러 연결"
```

---

### Task 5: CSS 스타일 추가

**Files:**
- Modify: `client/styles.css:150-153` (tab-indicator 수정)
- Modify: `client/styles.css:152` 이후 (새 규칙 추가)

- [ ] **Step 1: `tab-indicator`에 transition 추가**

`client/styles.css` line 153의 기존 `.tab-indicator` 규칙:

Before:
```css
.tab-indicator{width:5px;height:5px;border-radius:50%;background:var(--ok);box-shadow:0 0 4px var(--ok);flex-shrink:0}
```

After:
```css
.tab-indicator{width:5px;height:5px;border-radius:50%;background:var(--ok);box-shadow:0 0 4px var(--ok);flex-shrink:0;transition:background-color .3s,box-shadow .3s}
```

- [ ] **Step 2: `data-status` 기반 indicator 스타일 추가**

`.tab-indicator` 규칙 바로 뒤에 추가:

```css
[data-status="idle"] .tab-indicator{background:var(--ok);box-shadow:0 0 4px var(--ok);opacity:.6;animation:none}
[data-status="thinking"] .tab-indicator,[data-status="working"] .tab-indicator{background:var(--warn);box-shadow:0 0 4px var(--warn);opacity:1;animation:blink 1.5s ease-in-out infinite}
[data-status="tool"] .tab-indicator{background:var(--accent2);box-shadow:0 0 4px var(--accent2);opacity:1;animation:none}
[data-status="question"] .tab-indicator{background:var(--danger);box-shadow:0 0 4px var(--danger);opacity:1;animation:blink 1s ease-in-out infinite}
[data-status="done"] .tab-indicator{background:var(--ok);box-shadow:0 0 6px var(--ok);opacity:1;animation:none}
```

- [ ] **Step 3: `tab-status-text` 스타일 추가**

`data-status` 규칙 바로 뒤에 추가:

```css
.tab-status-text{font-size:.7em;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:80px;color:var(--text-dim);display:none}
.tab.active .tab-status-text,.tab.split-active .tab-status-text{display:inline}
```

- [ ] **Step 4: 활성 탭 max-width 확장**

기존 `.tab.active` 규칙 (line 152) 뒤에 추가:

```css
.tab.active,.tab.split-active{max-width:240px}
```

- [ ] **Step 5: Commit**

```bash
git add client/styles.css
git commit -m "feat: 탭 상태 인디케이터 CSS 스타일 추가"
```

---

### Task 6: 통합 검증

**Files:** 없음 (수동 테스트)

- [ ] **Step 1: 서버 시작 및 브라우저 열기**

Run: `npm run dev`
브라우저에서 접속.

- [ ] **Step 2: 일반 셸 상태 확인**

1. 새 Shell 세션 생성
2. 명령 없이 대기 → 탭 dot이 초록색, "대기" 텍스트 (active 탭에서)
3. `sleep 5` 실행 → dot이 노란색으로 변경, "작업 중..." 텍스트, 깜빡임 애니메이션
4. 명령 완료 → dot이 다시 초록색, "대기"

- [ ] **Step 3: Claude Code 상태 확인**

1. Claude 세션 생성 (또는 `claude` 명령 실행)
2. AI가 감지되면 상태 추적 시작 확인
3. Claude가 생각 중일 때 → 노란 dot, "생각 중..."
4. Claude가 도구 사용 시 → accent2 색상 dot, "파일 편집 중" 또는 "명령 실행 중"
5. Claude가 입력 대기 시 (> 프롬프트) → 빨간 dot, "입력 대기", 깜빡임
6. 작업 완료 시 (✓) → 초록 dot, "완료" → 3초 후 "대기"

- [ ] **Step 4: 비활성 탭 표시 확인**

1. 탭 2개 이상 생성
2. 비활성 탭에서 → dot 색상만 보이고 텍스트 숨김 확인
3. 활성 탭에서 → dot + 텍스트 모두 표시 확인

- [ ] **Step 5: Split pane 확인**

1. Split pane으로 분할
2. split-active 탭에서도 상태 텍스트 표시 확인

- [ ] **Step 6: 재연결 확인**

1. 서버 재시작
2. 재연결 시 2초간 상태 변경 억제 확인
3. 2초 후 정상 감지 재개 확인

- [ ] **Step 7: 기존 알림 동작 확인**

1. 비활성 탭에서 AI 활동 시 토스트 알림이 여전히 정상 동작하는지 확인
2. OS 알림도 정상 동작 확인

- [ ] **Step 8: 최종 커밋**

문제 발견 시 수정 후 커밋:
```bash
git add -A
git commit -m "fix: 탭 상태 인디케이터 통합 테스트 후 수정"
```
