# Command Palette Design Spec

## 개요

VS Code 스타일의 커맨드 팔레트를 x-launchpad에 추가한다. 두 가지 모드를 지원한다:

- **Cmd+P**: 파일/세션 빠른 전환
- **Cmd+Shift+P**: 전체 커맨드 실행

## 요구사항

### 기능
- 퍼지 검색 (자체 구현, 문자 순서 매칭 + 스코어링)
- 각 커맨드 옆에 할당된 단축키 표시
- 최근 사용 기록 (localStorage, 최근 10개)
- 카테고리 분류 (Session, Terminal, UI, Git, File, Plan, Theme)
- Cmd+P로 열린 세션/파일 탭 빠른 전환
- 테마 변경 시 hover/↑↓로 실시간 미리보기

### UI
- VS Code 클래식 스타일: 상단 중앙 드롭다운
- 기존 테마 CSS 변수 + 팔레트 전용 CSS 변수 (--palette-bg, --palette-border 등)
- 키보드 조작: ↑↓ 이동, Enter 실행, Esc 닫기
- 반투명 배경 오버레이
- 퍼지 매칭된 문자 볼드 표시
- 결과 카운트 하단 표시

### 커맨드 범위
- 클라이언트 액션 (기존 15개 키바인딩 액션 전부)
- 서버 커맨드 (Git 작업, 파일 작업) — wsSend()로 WebSocket 메시지 전송

## 아키텍처

### 접근법: 커맨드 레지스트리 중앙화

새 `command-registry.ts` 모듈에 모든 커맨드를 등록한다. 기존 `keyboard.ts`의 `registerAction()`을 래핑하여 메타데이터(카테고리, 설명, 아이콘)를 추가한다.

### 커맨드 인터페이스

```typescript
interface Command {
  id: string;              // 'session:new', 'git:push'
  label: string;           // '새 세션', 'Git: Push'
  category: string;        // 'Session', 'Git', 'File', 'Terminal', 'UI', 'Plan', 'Theme'
  shortcut?: string;       // 키바인딩에서 자동 연결
  icon?: string;           // 카테고리 아이콘
  execute: () => void | Promise<void>;
  when?: () => boolean;    // 컨텍스트 조건 (예: 세션 활성일 때만)
}
```

### 레지스트리 API

```typescript
registerCommand(cmd: Command): void        // 레지스트리에 등록
getCommands(): Command[]                    // 전체 목록 (when 필터 적용)
executeCommand(id: string): void            // ID로 실행
getRecentCommands(): string[]               // 최근 사용 ID 목록
addRecentCommand(id: string): void          // 최근 사용에 추가
```

### 파일 구조

```
client/js/
  core/
    command-registry.ts   # 새로 생성 - 커맨드 등록/조회/실행
    keyboard.ts           # 수정 - registerAction()이 command-registry 래핑
    constants.ts          # 수정 - KB_DEFS에 openPalette, openCommandPalette 추가
    main.ts               # 수정 - 팔레트 액션 등록, Esc 우선순위 체인 업데이트
  ui/
    command-palette.ts    # 새로 생성 - 팔레트 UI
index.html                # 수정 - 팔레트 오버레이 HTML 추가
```

### keyboard.ts 마이그레이션

기존 `keyboard.ts`의 내부 `actionMap`을 command-registry로 이전한다:

1. `registerAction(name, callback)` → 내부적으로 `registerCommand()`를 호출하여 레지스트리에 등록
2. `tryKeybinding(e)` → `matchCombo()`로 액션 이름을 찾은 뒤, `executeCommand(id)`로 실행 (기존 `actionMap.get(action)()` 대신)
3. 기존 `actionMap` private Map은 제거하고 command-registry가 단일 소스가 됨

### 키바인딩 시스템 통합

Cmd+P / Cmd+Shift+P를 하드코딩하지 않는다. 기존 키바인딩 시스템을 그대로 활용:

1. `constants.ts`의 `KB_DEFS`에 추가:
   - `{ key: 'openPalette', label: 'Quick Open' }` — 기본값 `Meta+p`
   - `{ key: 'openCommandPalette', label: 'Command Palette' }` — 기본값 `Meta+Shift+p`
2. `S.settings.keybindings`에 저장 → 설정 UI에서 사용자가 리매핑 가능
3. `main.ts`에서 `registerAction('openPalette', ...)`, `registerAction('openCommandPalette', ...)` 등록

### 데이터 흐름

1. 앱 초기화 → 각 모듈이 `registerCommand()` 호출
2. Cmd+P / Cmd+Shift+P → `tryKeybinding()` → `openPalette(mode)`
3. 팔레트 열림 → `getCommands()` + 최근 사용 기록 조합
4. 입력 → 퍼지 검색 → 결과 렌더링
5. Enter / 클릭 → `executeCommand(id)` → 팔레트 닫힘 → 최근 기록 업데이트

### 팔레트 모드

| 모드 | 트리거 | 입력 접두사 | 데이터 소스 |
|------|--------|------------|------------|
| 커맨드 | Cmd+Shift+P | `>` | command-registry 전체 |
| 파일/세션 전환 | Cmd+P | 없음 | sessionMeta + 열린 파일 탭 |
| 테마 선택 | 서브리스트 진입 | 없음 | THEMES 배열 |

Cmd+P에서 `>`를 입력하면 커맨드 모드로 전환된다. `>` 문자를 삭제하면 파일/세션 전환 모드로 복귀한다.

### Esc 키 우선순위 체인

`main.ts`의 Esc 핸들러에 팔레트를 최상위 우선순위로 추가:

1. **Command Palette** (최우선) → `closePalette()` + `e.stopPropagation()`
2. Session Picker → `hideSessionPicker()`
3. Plan Modal → `closePlanModal()`
4. Settings → `closeSettings()`
5. Git Graph → `closeGitGraph()`

팔레트 내부에서 Esc를 처리하므로 다른 오버레이로 이벤트가 전파되지 않는다.

### 초기 커맨드 목록

| 카테고리 | 커맨드 | 타입 |
|---------|--------|------|
| Session | New Session, Close Tab, Rename Session, Next Tab, Prev Tab | 클라이언트 |
| Terminal | Clear Terminal, Toggle Input Panel | 클라이언트 |
| UI | Toggle Sidebar, Fullscreen, Open Settings, Focus Search, Focus Explorer, Focus Source Control | 클라이언트 |
| Git | Status, Commit, Push, Pull, Git Graph | 서버(wsSend) + 클라이언트 |
| File | New File, New Folder, Reveal in Finder | 서버(wsSend) |
| Plan | Plan Notes | 클라이언트 |
| Theme | Change Theme → 서브리스트 (6개 테마) | 클라이언트 |

### 서버 커맨드 WebSocket 메시지 타입

팔레트에서 서버 커맨드 실행 시 기존 모듈의 함수를 재사용한다:

- **Git: Status** → `source-control.ts`의 `refreshGitStatus()` 호출
- **Git: Commit** → `source-control.ts`의 커밋 UI 열기 (사이드바 전환 + 포커스)
- **Git: Push** → `wsSend({ type: 'git_push' })`
- **Git: Pull** → `wsSend({ type: 'git_pull' })`
- **File: New File** → `explorer.ts`의 `createNewFile()` 호출
- **File: New Folder** → `explorer.ts`의 `createNewFolder()` 호출
- **File: Reveal in Finder** → `apiFetch('/api/reveal-in-finder', { path: cwd })`

### 테마 통합

기존 CSS 변수에 더해 팔레트 전용 변수를 각 테마에 추가:

```css
--palette-bg
--palette-border
--palette-input-bg
--palette-hover
--palette-separator
--palette-category
```

### 퍼지 검색 알고리즘

자체 구현. 문자 순서 매칭 + 스코어링:
- 연속 매칭 보너스
- 단어 시작 매칭 보너스
- 대소문자 일치 보너스
- 매칭된 문자 위치를 반환하여 볼드 하이라이트에 사용

### HTML 구조

기존 모달 패턴을 따른다:

```html
<div id="command-palette-overlay">
  <div id="command-palette-modal">
    <input id="command-palette-input" type="text" placeholder="명령 입력..." />
    <div id="command-palette-list"></div>
    <div id="command-palette-footer"></div>
  </div>
</div>
```

### 키보드 인터랙션

- `↑` / `↓`: 항목 이동
- `Enter`: 선택 항목 실행
- `Esc`: 팔레트 닫기 (테마 서브리스트에서는 원래 테마 복원 후 닫기)
- `Cmd+P` (팔레트 열린 상태): 닫기 (토글)
- 입력 시 자동 필터링, 첫 번째 항목 자동 선택

팔레트의 키보드 이벤트는 `e.stopPropagation()`으로 상위 전파를 차단한다.

### 최근 사용 기록

- `localStorage` key: `x-launchpad-recent-commands`
- 최대 10개 저장
- 팔레트 열릴 때 "최근 사용" 섹션으로 상단에 표시 (단, `when()` 필터가 false인 커맨드는 제외)
- 실행할 때마다 갱신

### 테마 미리보기

- "Change Theme" 커맨드 선택 시 서브리스트로 진입
- 진입 시 `_savedTheme = S.currentTheme`으로 현재 테마 캡처
- ↑↓ 또는 hover 시 `applyTheme(theme, { preview: true })`로 임시 적용 (preview 플래그가 true일 때 `updateSwatches()` 호출 생략)
- Enter: 확정 → `applyTheme(theme)` + 설정 저장
- Esc: `applyTheme(_savedTheme)` → 원래 테마 복원

### 단축키 표시

커맨드 목록 렌더링 시, 각 커맨드의 `id`를 `S.settings.keybindings`에서 조회하여 할당된 단축키 콤보를 표시한다. 표시 포맷은 `keyboard.ts`의 `buildCombo()` 역변환을 사용하여 `⌘`, `⇧`, `⌥`, `⌃` 기호로 변환한다.

`shortcut` 필드는 등록 시 수동 지정이 아니라, 렌더링 시 `S.settings.keybindings[command.id]`를 동적으로 조회하는 방식이다. 사용자가 키바인딩을 변경하면 팔레트에도 즉시 반영된다.
