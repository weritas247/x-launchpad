# Explorer Context Menu Enhancement

## Overview

Explorer의 우클릭 컨텍스트 메뉴를 컴포넌트화하고, 폴더에서 터미널/AI 도구 세션 열기, 경로 복사, 파일/폴더 복제 기능을 추가한다.

## Goals

1. 재사용 가능한 `ContextMenu` 클래스 구현 (동적 메뉴 생성)
2. 폴더 컨텍스트 메뉴: "Open Terminal Here" + AI 도구 직접 실행 (Claude, OpenCode, Gemini, Codex)
3. 파일/폴더 공통: Copy Path (클립보드에 절대 경로 복사), Duplicate (사본 생성)
4. 기존 항목 유지: New File, New Folder, Rename, Delete

## Architecture

### 1. ContextMenu Component (`client/js/context-menu.js`)

동적으로 DOM을 생성하는 재사용 가능한 컨텍스트 메뉴 클래스.

```js
// API
const menu = new ContextMenu(items, handler);
menu.show(event, context);
menu.hide();
```

**Item Definition:**

```js
{
  label: '📄 New File',    // 표시 텍스트
  action: 'new-file',      // handler에 전달되는 식별자
  danger: false,            // true면 .danger 스타일 적용
  when: (ctx) => true,      // context 기반 조건부 표시
}
// 또는 separator
'---'
```

**핵심 동작:**
- `show(event, context)`: DOM 생성 → `when` 조건으로 항목 필터링 → 위치 지정 → 표시
- viewport 경계 체크: 메뉴가 화면 밖으로 나가면 위치 보정
- 문서 클릭 시 자동 닫힘
- 기존 CSS 클래스 재사용: `.ctx-menu`, `.ctx-item`, `.ctx-sep`, `.ctx-item.danger`

### 2. Explorer 메뉴 항목 구성

**폴더 우클릭:**

| 항목 | action | when |
|------|--------|------|
| 📄 New File | `new-file` | always |
| 📁 New Folder | `new-folder` | always |
| --- | separator | --- |
| ▶ Open Terminal Here | `open-terminal` | `type === 'directory'` |
| ▶ Open with Claude | `open-claude` | `type === 'directory'` |
| ▶ Open with OpenCode | `open-opencode` | `type === 'directory'` |
| ▶ Open with Gemini | `open-gemini` | `type === 'directory'` |
| ▶ Open with Codex | `open-codex` | `type === 'directory'` |
| --- | separator | --- |
| 📋 Copy Path | `copy-path` | always |
| 📑 Duplicate | `duplicate` | always |
| --- | separator | --- |
| ✎ Rename | `rename` | always |
| ✕ Delete | `delete` (danger) | always |

**파일 우클릭:** 동일하지만 `when` 조건에 의해 Open Terminal/AI 도구 항목 숨김.

### 3. 서버 변경사항

#### 3a. `session_create` — `cmd` 필드 추가

기존 `session_create` 메시지에 `cmd` 옵션 필드 추가:

```
Client → { type: 'session_create', name: 'Claude', cwd: '/path/to/folder', cmd: 'claude' }
```

서버 처리:
- PTY spawn with `cwd`
- `cmd`가 존재하면 PTY ready 후 `pty.write(cmd + '\r')` 실행
- 세션의 `cmd` 필드에 저장 (복원 시 재실행용)

#### 3b. `file_duplicate` 메시지 타입 추가

```
Client → { type: 'file_duplicate', sessionId, filePath }
Server → 복제 로직 → { type: 'file_op_ack', sessionId, op: 'duplicate', ok, error }
```

#### 3c. `git-service.ts` — `duplicateFile()` 함수 추가

```typescript
export function duplicateFile(cwd: string, filePath: string): { ok: boolean; error?: string }
```

- 파일: `name.ext` → `name copy.ext`, 충돌 시 `name copy 2.ext`, `name copy 3.ext`...
- 폴더: `dir` → `dir copy`, 충돌 시 `dir copy 2`... (재귀 복사)

### 4. 데이터 플로우

#### 세션 열기 플로우
```
Explorer 폴더 우클릭 → "Open with Claude" 클릭
  → wsSend({ type: 'session_create', name: 'Claude', cwd: absPath, cmd: 'claude' })
  → Server: PTY spawn({ cwd }) → pty.write('claude\r')
  → Client: session_created → 터미널 탭 생성 및 attach
```

#### 경로 복사 플로우
```
우클릭 → "Copy Path" 클릭
  → sessionMeta.get(activeSessionId).cwd + '/' + entry.path
  → navigator.clipboard.writeText(absPath)
```

#### 파일 복제 플로우
```
우클릭 → "Duplicate" 클릭
  → wsSend({ type: 'file_duplicate', sessionId, filePath: entry.path })
  → Server: duplicateFile(cwd, filePath)
  → Client: file_op_ack → requestFileTree() 갱신
```

### 5. 기존 코드 변경 요약

| 파일 | 변경 |
|------|------|
| `client/js/context-menu.js` | **신규** — ContextMenu 클래스 |
| `client/js/explorer.js` | 기존 정적 메뉴 → ContextMenu 인스턴스 사용, 새 핸들러 추가 |
| `client/index.html` | `explorer-ctx-menu` div 제거 (동적 생성으로 대체), `context-menu.js` 스크립트 추가 |
| `server/index.ts` | `session_create`에 `cmd` 처리 추가, `file_duplicate` 메시지 핸들러 추가 |
| `server/git-service.ts` | `duplicateFile()` 함수 추가 |
| `client/styles.css` | 변경 없음 (기존 `.ctx-menu` 스타일 재사용) |

### 6. 에러 처리

| 상황 | 처리 |
|------|------|
| 세션 없음 (`!S.activeSessionId`) | 메뉴 항목 비활성화 또는 조기 리턴 |
| `cmd` 미설치 (claude 등) | 터미널에 command not found 표시 (쉘 기본 동작) |
| 복제 시 이름 충돌 | 서버에서 번호 증가 (`copy 2`, `copy 3`...) |
| clipboard API 미지원 | 실패 시 무시 (로컬 앱 환경) |
| 메뉴 화면 밖 | viewport 경계 체크 후 위치 보정 |

### 7. 마이그레이션

기존 Explorer 컨텍스트 메뉴 동작(New File, New Folder, Rename, Delete)은 새 ContextMenu 클래스를 통해 동일하게 동작하도록 마이그레이션. 기존 `explorer-ctx-menu` HTML은 제거.

기존 Session 컨텍스트 메뉴(`ctx-menu`)는 이번 스코프에서 변경하지 않음. 추후 필요 시 ContextMenu 클래스로 마이그레이션 가능.
