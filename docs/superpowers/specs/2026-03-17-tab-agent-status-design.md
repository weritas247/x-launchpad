# Tab Agent Status Indicator

## Overview

각 탭에 에이전트/셸의 현재 상태를 실시간으로 표시하는 기능. 기존 `tab-indicator` dot의 색상/애니메이션과 한국어 상태 텍스트로 "생각 중", "입력 대기", "파일 편집 중" 등의 상태를 나타낸다.

## Approach

하이브리드 방식: 서버의 기존 AI 감지(프로세스 폴링) + 클라이언트 출력 패턴 매칭 조합.

- 서버 변경 없음. 기존 `session_info` 메시지의 `ai` 필드 활용.
- 클라이언트에서 터미널 출력을 분석하여 상세 상태 감지.
- 기존 `notifications.js`의 `stripAnsi()` 함수를 공유 유틸로 추출하여 중복 제거.

## Relationship with notifications.js

`notifications.js`는 토스트/OS 알림을 담당하고, 새 `tab-status.js`는 탭 UI 상태 업데이트를 담당한다. 두 모듈은 독립적으로 동작하지만 공통 유틸리티를 공유한다:

- `stripAnsi()`: `state.js`로 이동하여 양쪽에서 import
- 각 모듈은 자체 버퍼/타이머 유지 (목적이 다르므로 — 알림은 1200ms 디바운스, 탭 상태는 800ms)
- 탭 상태는 알림보다 빨리 업데이트되는 것이 의도적임 (시각적 피드백이 알림보다 먼저 보이는 것이 자연스러움)

## State Model

### AI Agent (Claude, Gemini 등) — 5단계

| State | 텍스트 | Dot Color | Detection |
|-------|--------|-----------|-----------|
| `idle` | 대기 | `var(--ok)` | 셸 프롬프트 / AI 미감지 |
| `thinking` | 생각 중... | `var(--warn)` (pulse) | 스피너 (braille), "Puzzling..." |
| `tool` | 파일 편집 중 / 명령 실행 중 | `var(--accent2)` | 도구명 패턴 (엄격한 컨텍스트 매칭) |
| `question` | 입력 대기 | `var(--danger)` (pulse) | 버퍼 마지막 줄 프롬프트 패턴 |
| `done` | 완료 | `var(--ok)` | ✓, "Done" 패턴. 3초 후 idle 전환 |

### Shell (일반 셸) — 3단계

| State | 텍스트 | Dot Color | Detection |
|-------|--------|-----------|-----------|
| `idle` | 대기 | `var(--ok)` | 셸 프롬프트 |
| `working` | 작업 중... | `var(--warn)` (pulse) | 출력 흐름 + 프롬프트 없음 |
| `question` | 입력 대기 | `var(--danger)` (pulse) | 프롬프트 패턴 |

## Tab HTML Structure

기존 `tab-indicator`를 재활용한다. 새 dot 엘리먼트를 추가하지 않는다.

Before:
```html
<div class="tab">
  <div class="tab-indicator"></div>
  <span class="tab-name">Claude  ~/Dev</span>
  <button class="tab-close-btn">✕</button>
</div>
```

After:
```html
<div class="tab" data-status="thinking">
  <div class="tab-indicator"></div>
  <span class="tab-name">Claude  ~/Dev</span>
  <span class="tab-status-text">생각 중...</span>
  <button class="tab-close-btn">✕</button>
</div>
```

- `data-status` attribute가 CSS 스타일링을 제어.
- 기존 `tab-indicator`의 background/box-shadow/animation을 `data-status`에 따라 오버라이드.
- `tab-status-text`: 한국어 상태 텍스트 (active 또는 split-active 탭에서만 표시).

## Detection Patterns

### Claude Code — 엄격한 컨텍스트 매칭

```javascript
const CLAUDE_PATTERNS = [
  // thinking: 스피너 문자는 ANSI strip 후에도 남는 유니코드
  { re: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Puzzling\.\.\.|Thinking\.\.\./,
    status: 'thinking', text: '생각 중...' },

  // tool: 줄 시작 부근에 볼드/컬러 포맷 후 도구명이 오는 패턴
  // Claude Code는 도구명을 "⚡ Read(path)" 또는 "● Edit(file)" 형태로 출력
  { re: /^[\s•⚡●◐▸]*(?:Read|Edit|Write|Glob|Grep|NotebookEdit)\b/m,
    status: 'tool', text: '파일 편집 중' },
  { re: /^[\s•⚡●◐▸]*(?:Bash|WebFetch|WebSearch|Task)\b/m,
    status: 'tool', text: '명령 실행 중' },

  // question: 버퍼의 **마지막 줄**이 ">" 또는 "❯"로 끝나는 경우만
  // (중간 줄의 >는 무시 — diff, HTML, 인용문 등의 오탐 방지)
  { re: /^[❯>]\s*$/m, status: 'question', text: '입력 대기',
    lastLineOnly: true },

  // done
  { re: /✓|✔|Task complete|Done\./i,
    status: 'done', text: '완료' },
];
```

`lastLineOnly: true` 플래그가 있으면 버퍼의 마지막 줄에서만 매칭한다.

### General AI

```javascript
const GENERAL_AI_PATTERNS = [
  { re: /^[❯>]\s*$/m, status: 'question', text: '입력 대기', lastLineOnly: true },
  { re: /✓|✔|Done|Completed|Finished/i, status: 'done', text: '완료' },
];
```

### Shell

```javascript
const SHELL_PATTERNS = [
  { re: /[\$❯›»#%]\s*$/, status: 'idle', text: '대기', lastLineOnly: true },
];
```

## State Transition Rules

```
출력 수신 → reconnect 억제 중? → 무시
         → sessionMeta.ai 확인
  ├─ AI detected (e.g. "claude") → AI 패턴 매칭:
  │    ├─ spinner/puzzling match → thinking
  │    ├─ file tool match → tool("파일 편집 중")
  │    ├─ command tool match → tool("명령 실행 중")
  │    ├─ prompt match (last line) → question
  │    ├─ done match → done → setTimeout(3s, idle)
  │    └─ no match but output flowing → thinking (default for AI)
  └─ No AI → Shell 패턴 매칭:
       ├─ shell prompt match (last line) → idle
       └─ output flowing, no prompt → working

done → idle 자동 전환: 3초 후
AI 감지 변경 시: 상태 리셋 + 버퍼 flush → idle
```

## Implementation Plan

### Shared Utility: `stripAnsi()` 이동

`notifications.js`에 있는 `stripAnsi()` 함수를 `state.js`로 이동하고 export한다.
`notifications.js`와 `tab-status.js` 양쪽에서 import하여 사용.

### New File: `client/js/tab-status.js`

ES module. `main.js`에서 import하여 사용 (별도 script 태그 불필요).

Exports:
- `tabStatusCheck(sessionId, chunk)` — output 수신시 호출
- `tabStatusOnAiChange(sessionId, ai)` — AI 감지 변경시 호출
- `resetTabStatus(sessionId)` — 세션 종료시 정리
- `suppressTabStatus(sessionId, durationMs)` — 재연결 시 일시 억제

Internal state (모듈 내부, state.js에 두지 않음 — 캡슐화):
- `statusBuffers: Map<string, string>` — 세션별 출력 버퍼 (최근 2KB)
- `statusTimers: Map<string, number>` — 디바운스 타이머 (800ms)
- `doneTimers: Map<string, number>` — done→idle 자동 전환 타이머 (3s)
- `suppressUntil: Map<string, number>` — 억제 타임스탬프

### Modified Files

**`client/js/state.js`**
- `stripAnsi()` 함수 추가 (notifications.js에서 이동)
- `export const tabStatusState = new Map()` 추가 (UI 업데이트에 필요한 현재 상태만)

**`client/js/notifications.js`**
- `stripAnsi()` 제거하고 `state.js`에서 import

**`client/js/main.js`**
- Import `tabStatusCheck`, `tabStatusOnAiChange`, `suppressTabStatus` from `tab-status.js`
- `output` 핸들러에 `tabStatusCheck(msg.sessionId, msg.data)` 추가
- `session_info` 핸들러에 `tabStatusOnAiChange(msg.sessionId, msg.ai)` 추가
- 재연결 시 `suppressTabStatus(sessionId, 2000)` 호출

**`client/js/terminal.js`**
- `createTab()`: `tab-status-text` span 추가, `data-status="idle"` 설정
- `updateSessionInfo()`: `tab-name`의 textContent 설정 시 기존 로직 유지
  - `querySelector('.tab-name')`는 여전히 작동 (새 엘리먼트는 별도 span)
  - 상태 텍스트는 `tab-status.js`가 관리하므로 `updateSessionInfo()`는 건드리지 않음
- `closeSession()`: `resetTabStatus(sessionId)` 호출
- `renameSession()`: 기존 로직 유지 (`tab-name` span만 업데이트)

**`client/styles.css`**
- `tab-indicator` 기본 스타일에 transition 추가
- `[data-status]` 셀렉터로 indicator 색상/애니메이션 오버라이드
- `tab-status-text` 스타일
- active 및 split-active 탭에서 텍스트 표시
- `.tab` max-width: active 탭은 240px, 비활성은 160px 유지

## CSS Details

```css
/* 기존 tab-indicator에 transition 추가 */
.tab-indicator {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.3s, box-shadow 0.3s;
  /* 기본값은 기존과 동일: background: var(--ok); box-shadow: 0 0 4px var(--ok); */
}

/* 상태별 indicator 오버라이드 */
[data-status="idle"] .tab-indicator {
  background: var(--ok);
  box-shadow: 0 0 4px var(--ok);
  opacity: 0.6;
  animation: none;
}
[data-status="thinking"] .tab-indicator,
[data-status="working"] .tab-indicator {
  background: var(--warn, #ffb300);
  box-shadow: 0 0 4px var(--warn, #ffb300);
  animation: blink 1.5s ease-in-out infinite; /* 기존 @keyframes blink 재활용 */
}
[data-status="tool"] .tab-indicator {
  background: var(--accent2);
  box-shadow: 0 0 4px var(--accent2);
  animation: none;
}
[data-status="question"] .tab-indicator {
  background: var(--danger);
  box-shadow: 0 0 4px var(--danger);
  animation: blink 1s ease-in-out infinite;
}
[data-status="done"] .tab-indicator {
  background: var(--ok);
  box-shadow: 0 0 6px var(--ok);
  animation: none;
}

/* 상태 텍스트 */
.tab-status-text {
  font-size: 0.7em;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
  color: var(--text-dim);
}

/* 비활성 탭에서는 상태 텍스트 숨김 */
.tab-status-text { display: none; }
.tab.active .tab-status-text,
.tab.split-active .tab-status-text { display: inline; }

/* 활성 탭은 더 넓게 허용 */
.tab.active, .tab.split-active { max-width: 240px; }
```

기존 `@keyframes blink` (styles.css line 69)를 재활용한다. 새 keyframes 정의 불필요.

## Data Flow

```
Server PTY output
  → WebSocket "output" message
  → main.js handleMessage()
  ├→ tabStatusCheck(sessionId, chunk)
  │   → suppressUntil 확인 → 억제 중이면 무시
  │   → stripAnsi (state.js에서 import)
  │   → buffer last 2KB
  │   → debounce 800ms
  │   → sessionMeta.ai 확인 → 적절한 패턴셋 선택
  │   → lastLineOnly 패턴은 마지막 줄만 검사
  │   → updateTabUI(sessionId, newStatus, newText)
  │     → tabEl.dataset.status = newStatus
  │     → tabStatusTextEl.textContent = newText
  │     → tabStatusState.set(sessionId, newStatus)
  └→ aiNotifyCheck(sessionId, chunk)  [기존 — 변경 없음]
```

## Edge Cases

- **Tab 전환 시**: 상태 유지 (탭 전환이 상태에 영향 없음)
- **세션 재연결 시**: `suppressTabStatus(id, 2000)` 호출로 2초간 상태 감지 억제. 리플레이 출력에 의한 혼란 방지. 2초 후 정상 감지 재개.
- **AI 감지 변경 시**: `tabStatusOnAiChange()` → 상태 idle로 리셋 + 버퍼 flush + suppressUntil 해제
- **done 상태**: 3초 후 자동 idle 전환 (`doneTimers` Map으로 관리)
- **빠른 상태 변경**: 디바운스 800ms로 플리커 방지
- **Split pane**: `.tab.split-active`에도 상태 텍스트 표시
- **Tab 크기**: 활성 탭은 max-width 240px, 비활성은 160px 유지. 비활성 탭은 텍스트 숨기므로 공간 부족 없음.
- **`updateSessionInfo()` 호출**: `tab-name` span의 textContent만 변경하므로 `tab-status-text` span에 영향 없음. 두 엘리먼트는 독립적 sibling.
- **`renameSession()` 호출**: 마찬가지로 `tab-name`만 업데이트. 상태 텍스트 무관.

## Accessibility

- `tab-indicator`에 `aria-label` 속성을 상태 변경 시 업데이트 (예: `aria-label="생각 중"`)
- `tab-status-text`는 이미 가시적 텍스트이므로 추가 aria 불필요
