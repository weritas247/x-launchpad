# Tab Agent Status Indicator

## Overview

각 탭에 에이전트/셸의 현재 상태를 실시간으로 표시하는 기능. 색상 점(dot)과 한국어 상태 텍스트로 "생각 중", "입력 대기", "파일 편집 중" 등의 상태를 나타낸다.

## Approach

하이브리드 방식: 서버의 기존 AI 감지(프로세스 폴링) + 클라이언트 출력 패턴 매칭 조합.

- 서버 변경 없음. 기존 `session_info` 메시지의 `ai` 필드 활용.
- 클라이언트에서 터미널 출력을 분석하여 상세 상태 감지.

## State Model

### AI Agent (Claude, Gemini 등) — 5단계

| State | 텍스트 | Dot Color | Detection |
|-------|--------|-----------|-----------|
| `idle` | 대기 | green (`--ok`) | 셸 프롬프트 / AI 미감지 |
| `thinking` | 생각 중... | yellow (`#ffb300`, pulse) | 스피너 (braille), "Puzzling..." |
| `tool` | 파일 편집 중 / 명령 실행 중 | orange (`#ff6b35`) | "Read", "Edit", "Bash" 등 도구명 |
| `question` | 입력 대기 | red (`--danger`, pulse) | `> ` 프롬프트 패턴 |
| `done` | 완료 | green (`--ok`) | ✓, "Done" 패턴. 3초 후 idle 전환 |

### Shell (일반 셸) — 3단계

| State | 텍스트 | Dot Color | Detection |
|-------|--------|-----------|-----------|
| `idle` | 대기 | green | `$❯›»#` 프롬프트 |
| `working` | 작업 중... | yellow (pulse) | 출력 흐름 + 프롬프트 없음 |
| `question` | 입력 대기 | red (pulse) | 프롬프트 패턴 |

## Tab HTML Structure

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
  <span class="tab-status-dot"></span>
  <span class="tab-name">Claude  ~/Dev</span>
  <span class="tab-status-text">생각 중...</span>
  <button class="tab-close-btn">✕</button>
</div>
```

- `data-status` attribute drives CSS styling.
- `tab-status-dot`: 6px colored circle with optional pulse animation.
- `tab-status-text`: short Korean text, hidden when tab is narrow (non-active).

## Detection Patterns

### Claude Code

```javascript
const CLAUDE_PATTERNS = [
  { re: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Puzzling|Thinking/i, status: 'thinking', text: '생각 중...' },
  { re: /(?:Read|Edit|Write|Glob|Grep)\s*[:(]/i, status: 'tool', text: '파일 편집 중' },
  { re: /(?:Bash|WebFetch|WebSearch|Task)\s*[:(]/i, status: 'tool', text: '명령 실행 중' },
  { re: />\s*$/m, status: 'question', text: '입력 대기' },
  { re: /✓|✔|Task complete|Done\./i, status: 'done', text: '완료' },
];
```

### General AI

```javascript
const GENERAL_AI_PATTERNS = [
  { re: />\s*$/m, status: 'question', text: '입력 대기' },
  { re: /✓|✔|Done|Completed|Finished/i, status: 'done', text: '완료' },
];
```

### Shell

```javascript
const SHELL_PATTERNS = [
  { re: /[\$❯›»#]\s*$/m, status: 'idle', text: '대기' },
];
```

## State Transition Rules

```
출력 수신 → sessionMeta.ai 확인
  ├─ AI detected (e.g. "claude") → AI 패턴 매칭:
  │    ├─ spinner/puzzling match → thinking
  │    ├─ file tool match → tool("파일 편집 중")
  │    ├─ command tool match → tool("명령 실행 중")
  │    ├─ prompt match → question
  │    ├─ done match → done → setTimeout(3s, idle)
  │    └─ no match but output flowing → thinking (default for AI)
  └─ No AI → Shell 패턴 매칭:
       ├─ shell prompt match → idle
       └─ output flowing, no prompt → working

done → idle 자동 전환: 3초 후
```

## Implementation Plan

### New File: `client/js/tab-status.js`

Module responsible for status detection and tab UI updates.

Exports:
- `tabStatusCheck(sessionId, chunk)` — called on every `output` message
- `tabStatusOnAiChange(sessionId, ai)` — called when AI detection changes
- `resetTabStatus(sessionId)` — cleanup on session close

Internal state:
- `statusBuffers: Map<string, string>` — per-session output buffer (last 2KB)
- `statusTimers: Map<string, number>` — debounce timers (800ms)
- `doneTimers: Map<string, number>` — done→idle auto-transition timers (3s)

### Modified Files

**`client/js/main.js`**
- Import `tabStatusCheck`, `tabStatusOnAiChange` from `tab-status.js`
- In `output` handler: add `tabStatusCheck(msg.sessionId, msg.data)` call
- In `session_info` handler: add `tabStatusOnAiChange(msg.sessionId, msg.ai)` call

**`client/js/terminal.js`**
- `createTab()`: add `tab-status-dot` and `tab-status-text` elements, set `data-status="idle"`
- `updateSessionInfo()`: preserve status text when updating tab name
- `closeSession()`: call `resetTabStatus(sessionId)`

**`client/js/state.js`**
- Add `export const tabStatusState = new Map()` for tracking per-session status

**`client/styles.css`**
- `.tab-status-dot`: 6px circle, flex-shrink: 0
- `[data-status="..."]` selectors for colors
- `@keyframes pulse` animation for thinking/question states
- `.tab-status-text`: small font, opacity, overflow hidden
- Responsive: hide text on non-active tabs

## CSS Details

```css
.tab-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background-color 0.3s;
}

[data-status="idle"] .tab-status-dot      { background: var(--ok); opacity: 0.6; }
[data-status="thinking"] .tab-status-dot  { background: #ffb300; animation: tab-pulse 1.5s ease-in-out infinite; }
[data-status="tool"] .tab-status-dot      { background: #ff6b35; }
[data-status="question"] .tab-status-dot  { background: var(--danger); animation: tab-pulse 1s ease-in-out infinite; }
[data-status="done"] .tab-status-dot      { background: var(--ok); }
[data-status="working"] .tab-status-dot   { background: #ffb300; animation: tab-pulse 1.5s ease-in-out infinite; }

.tab-status-text {
  font-size: 0.7em;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80px;
}

.tab:not(.active) .tab-status-text {
  display: none;
}

@keyframes tab-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

## Data Flow

```
Server PTY output
  → WebSocket "output" message
  → main.js handleMessage()
  → tabStatusCheck(sessionId, chunk)
  → stripAnsi → buffer last 2KB → debounce 800ms
  → pattern match against AI/Shell patterns
  → updateTabUI(sessionId, newStatus, newText)
  → set data-status attribute + update text element
```

## Edge Cases

- **Tab 전환 시**: 상태 유지 (탭 전환이 상태에 영향 없음)
- **세션 재연결 시**: idle로 초기화 후 출력에 따라 재감지
- **AI 감지 변경 시**: 상태 리셋 → 새 감지 모드로 전환
- **done 상태**: 3초 후 자동 idle 전환 (타이머)
- **빠른 상태 변경**: 디바운스 800ms로 플리커 방지
