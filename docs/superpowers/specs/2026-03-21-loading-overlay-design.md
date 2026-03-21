# Loading Overlay Design Spec

**Date:** 2026-03-21
**Ticket:** XL-feat-0011

## Overview

사용자가 로딩/대기로 인해 앱이 멈춘 것으로 느낄 수 있는 지점에 프로젝트 로고를 포함한 로딩 오버레이를 삽입한다.

## 적용 대상

| # | 지점 | 오버레이 유형 | 트리거 (표시) | 트리거 (숨김) |
|---|------|-------------|-------------|-------------|
| 1 | 초기 앱 로드 | 풀스크린 | HTML 정적 (페이지 로드 시 즉시 보임) | 첫 `session_list` 메시지 수신 |
| 2 | 세션 전환/생성 | 세션 패인 | `activateSession()` 호출 | `session_attached` + data WS `onopen` |
| 3 | 세션 복원 | 세션 패인 | 초기 로드 시 복원 세션 감지 | `unbypassStream` 시점 (3초) |
| 12 | WebSocket 재연결 | 풀스크린 | `ws.onclose` (첫 연결 이후만) | `ws.onopen` |

## Architecture

### B안: 풀스크린 정적 + 세션 동적 분리

```
풀스크린 오버레이 (#app-loading-overlay)
├── HTML에 정적 배치 (페이지 로드 즉시 표시)
├── 초기 로드 완료 시 fade-out
└── WS 재연결 시 재사용

세션 오버레이 (.session-loading-overlay)
├── attachTerminal()에서 .term-pane에 동적 삽입
├── 세션 전환/복원 시 표시
└── 연결 완료 시 fade-out 후 DOM 제거
```

## Components

### 1. 풀스크린 로고 오버레이 (`#app-loading-overlay`)

**위치:** `index.html` — `<body>` 바로 아래, `#screen-dim` 앞

**HTML 구조:**
```html
<div id="app-loading-overlay">
  <div class="loading-logo">
    <svg viewBox="0 0 64 64" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="#1a1f2e"/>
      <polygon points="36,8 20,36 30,36 28,56 44,28 34,28" fill="#00e5cc"/>
    </svg>
  </div>
  <div class="loading-text">X-LAUNCHPAD</div>
  <div class="loading-dots"><span></span><span></span><span></span></div>
</div>
```

**스타일:**
- `position: fixed; inset: 0; z-index: 99999`
- 배경: `#0d1117` (앱 배경과 동일)
- 로고: 중앙 정렬, 펄스 애니메이션 (기존 `pulse-logo` 키프레임 재활용)
- 텍스트: `#00e5cc`, 14px, letter-spacing
- 로딩 도트: 3개 순차 바운스 애니메이션
- fade-out: `opacity 0.4s ease` → 완료 후 `display: none`

### 2. 세션 로딩 오버레이 (`.session-loading-overlay`)

**생성:** `loading-overlay.ts`에서 동적 생성, `.term-pane`에 삽입

**HTML 구조:**
```html
<div class="session-loading-overlay">
  <div class="loading-logo">
    <svg viewBox="0 0 64 64" width="40" height="40">
      <rect width="64" height="64" rx="14" fill="#1a1f2e"/>
      <polygon points="36,8 20,36 30,36 28,56 44,28 34,28" fill="#00e5cc"/>
    </svg>
  </div>
  <div class="loading-status">세션 연결 중...</div>
</div>
```

**스타일:**
- `position: absolute; inset: 0; z-index: 10`
- 배경: `rgba(13, 17, 23, 0.85)` (반투명)
- 로고: 40px, 펄스 애니메이션
- 상태 텍스트: `#8b949e`, 12px
- fade-out: `opacity 0.3s ease` → 완료 후 DOM에서 제거

### 3. 모듈: `client/js/ui/loading-overlay.ts`

```typescript
// ─── 공용 로고 SVG ───
const LOGO_SVG = `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a1f2e"/><polygon points="36,8 20,36 30,36 28,56 44,28 34,28" fill="#00e5cc"/></svg>`;

// ─── 풀스크린 API ───
export function showAppLoading(): void
  // #app-loading-overlay를 display: flex, opacity: 1로 전환

export function hideAppLoading(): void
  // opacity: 0 전환 → transitionend 후 display: none

// ─── 세션 API ───
export function showSessionLoading(paneEl: HTMLElement, message?: string): void
  // .session-loading-overlay를 paneEl에 삽입
  // message 기본값: "세션 연결 중..."

export function hideSessionLoading(paneEl: HTMLElement): void
  // opacity: 0 전환 → transitionend 후 DOM 제거
```

## File Changes

| 파일 | 변경 내용 |
|------|----------|
| `client/index.html` | `<body>` 아래에 `#app-loading-overlay` 정적 HTML 추가 |
| `client/styles.css` | 풀스크린/세션 오버레이 스타일 추가 |
| `client/js/ui/loading-overlay.ts` | 새 파일 — 오버레이 표시/숨김 API |
| `client/js/core/main.ts` | 첫 `session_list` 수신 시 `hideAppLoading()` 호출 |
| `client/js/core/websocket.ts` | `onclose`에서 `showAppLoading()`, `onopen`에서 `hideAppLoading()` (첫 연결 후만) |
| `client/js/terminal/terminal.ts` | `attachTerminal()` — 세션 오버레이 삽입; `syncSessionList()` — 복원 세션 오버레이 표시/숨김; 기존 `⟳ Restoring session...` 텍스트 제거 |

## Edge Cases

- **빠른 로드:** 오버레이가 깜빡이는 것 방지 — 최소 표시 시간 없음, fade-out만으로 충분
- **WS 재연결 중 세션 전환:** 풀스크린이 이미 표시 중이면 세션 오버레이 생략
- **다중 패인:** 각 `.term-pane`에 독립적인 세션 오버레이
- **세션 즉시 전환:** 이미 연결된 세션은 오버레이 불필요 — `terminalMap`에 존재 + data WS open 상태면 스킵
- **세션 오버레이 숨김 (#2):** `session_attached` AND `dataWs.onopen` 둘 다 필요. 5초 타임아웃 fallback으로 한쪽이 실패해도 오버레이가 영구 표시되지 않도록 방지
- **세션 복원 타이밍 (#3):** 3초 하드코딩 대신 `unbypassStream()` 호출 시점에 직접 연동하여 타이밍 불일치 방지
