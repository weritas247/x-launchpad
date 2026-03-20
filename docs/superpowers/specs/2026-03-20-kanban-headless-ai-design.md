# 칸반 Headless AI 실행 기능

**날짜:** 2026-03-20

## 개요

칸반 카드에서 AI 할당 시 `claude -p` (headless/pipe 모드)로 백그라운드 실행하는 기능. 워크트리 체크박스(🌿) 옆에 headless 체크박스(⚡)를 추가하고, 체크된 상태에서 AI를 할당하면 터미널 세션 없이 서버에서 `child_process.spawn`으로 실행한다.

## 데이터 모델

- `plans` 테이블에 `use_headless: boolean` 컬럼 추가 (기본값 false)
- 서버 메모리: `headlessJobs: Map<string, { planId, process, stdout, status }>` — 실행 중인 headless 작업 추적
- 클라이언트 Plan 객체에 `use_headless: boolean` 필드 추가

## UI

### 카드 footer
```
[🌿 체크박스] [⚡ 체크박스]  ...  [🤖 abc123] [날짜]
```
- 워크트리(🌿) 오른쪽에 headless(⚡) 체크박스 추가
- 동일한 스타일: opacity 0.5 → 체크 시 1.0, 12x12px
- 툴팁: "헤드리스 모드 (-p)"

### AI 세션 뱃지
- interactive/headless 동일하게 카드에 세션 뱃지 표시 (아이콘 + session ID 마지막 6자리)
- 기존 `ai_sessions` 배열에 추가

### AI Tasks 모달
- headless 작업도 세션 ID와 함께 표시
- ⚡ 아이콘으로 headless 구분
- 상태: 실행 중 / 완료 / 실패

## 서버 로직

### 새 핸들러: `server/handlers/headless.ts`

**Endpoint:** `POST /api/plans/:id/headless`

**실행 흐름:**
1. 클라이언트가 AI 할당 → `use_headless` 체크되어 있으면 이 endpoint 호출
2. 서버가 UUID 생성, 기존 `assignAiToplan` 프롬프트 구성 로직으로 prompt 생성
3. `child_process.spawn('claude', ['-p', '--session-id', uuid, '--output-format', 'json', '--dangerously-skip-permissions', prompt])` 실행
4. `headlessJobs` Map에 등록
5. WebSocket으로 클라이언트에 `headless_started` 이벤트 전송 (planId, sessionId)
6. stdout 수집, 프로세스 종료 시:
   - AI 응답을 카드 content에 append (`PUT /api/plans/:id`)
   - `ai_sessions`에 sessionId 추가
   - `ai_done = true` 설정
   - WebSocket으로 `headless_done` 이벤트 전송 (planId, sessionId, result)

### 워크트리 조합
- `use_worktree + use_headless` → `-p -w {branch}` 둘 다 적용

## 클라이언트 로직

### plan-panel.js 변경
1. **체크박스 렌더링:** 카드 footer에 `plan-headless-check` 체크박스 + ⚡ 아이콘 (워크트리 체크박스 바로 옆)
2. **체크박스 이벤트:** `use_headless` 토글 → `PUT /api/plans/:id`로 저장
3. **AI 할당 분기 (`assignAiToplan`):**
   - `plan.use_headless === true` → `POST /api/plans/:id/headless` 호출 (세션 생성 안 함)
   - `plan.use_headless === false` → 기존 `session_create` 흐름
4. **WebSocket 이벤트 수신:**
   - `headless_started` → AI Tasks 모달에 추가, 카드에 세션 뱃지 추가
   - `headless_done` → AI Tasks 모달 상태 업데이트, 카드 content append, 토스트 알림

### main.js 변경
- `headless_started`, `headless_done` WebSocket 메시지 핸들러 추가
- `plan-panel.js`의 해당 함수 호출

### styles.css 변경
- `.plan-headless-check`: 워크트리 체크박스와 동일 스타일
- `.plan-headless-icon`: ⚡ 아이콘, 10px
