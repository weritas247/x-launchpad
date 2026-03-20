# 칸반 Headless AI 실행 기능

**날짜:** 2026-03-20

## 개요

칸반 카드에서 AI 할당 시 `claude -p` (headless/pipe 모드)로 백그라운드 실행하는 기능. 워크트리 체크박스(🌿) 옆에 headless 체크박스(⚡)를 추가하고, 체크된 상태에서 AI를 할당하면 터미널 세션 없이 서버에서 `child_process.spawn`으로 실행한다.

## 데이터 모델

- `plans` 테이블에 `use_headless: boolean` 컬럼 추가 (기본값 false)
  - 마이그레이션: `ALTER TABLE plans ADD COLUMN use_headless boolean DEFAULT false;`
- 서버 메모리: `headlessJobs: Map<string, { planId, process, stdout, stderr, status }>` — 실행 중인 headless 작업 추적
- 클라이언트 Plan 객체에 `use_headless: boolean` 필드 추가
- `ai_sessions` 배열 항목에 `mode: 'interactive' | 'headless'` 필드 추가 — 클라이언트가 세션 유형을 구분

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
- headless 세션 뱃지 클릭 시 터미널 탭 전환 안 함 (interactive만 탭 전환)
- 기존 `ai_sessions` 배열에 `{ sessionId, ai, mode: 'headless' }` 형태로 추가

### AI Tasks 모달
- headless 작업도 세션 ID와 함께 표시
- ⚡ 아이콘으로 headless 구분
- 상태: 실행 중 / 완료 / 실패
- 취소 버튼: 실행 중인 headless 작업을 중단

## 서버 로직

### 새 핸들러: `server/handlers/headless.ts`

**Endpoint:** `POST /api/plans/:id/headless` (requireAuth 적용)

**실행 흐름:**
1. 클라이언트가 AI 할당 → `use_headless` 체크되어 있으면 이 endpoint 호출
2. requireAuth로 인증 확인, plan의 user_id가 요청 유저와 일치하는지 검증
3. 서버가 UUID 생성, 기존 `assignAiToplan` 프롬프트 구성 로직으로 prompt 생성
4. `child_process.spawn('claude', ['-p', '--session-id', uuid, '--output-format', 'json', '--dangerously-skip-permissions'])` 실행
   - **prompt는 stdin으로 전달:** `process.stdin.write(prompt)` → `process.stdin.end()`
   - `--dangerously-skip-permissions`: 기존 interactive 모드와 동일한 정책. headless에서도 사용자가 명시적으로 AI를 할당하는 행위이므로 허용.
5. `headlessJobs` Map에 등록
6. WebSocket으로 클라이언트에 `headless_started` 이벤트 전송 (planId, sessionId)
7. stdout + stderr 수집, 프로세스 종료 시:
   - **성공 (exit 0):** JSON 응답 파싱 → 텍스트 추출 → 카드 content에 append, `ai_done = true`, WebSocket `headless_done` 이벤트 전송
   - **실패 (exit != 0):** `ai_done`은 false 유지, WebSocket `headless_failed` 이벤트 전송 (planId, sessionId, stderr)

### 제한사항
- **타임아웃:** 10분 (기본값). 초과 시 `process.kill()` 후 `headless_failed` 전송
- **stdout 버퍼 상한:** 1MB. 초과 시 프로세스 kill
- **동시 실행 제한:** 유저당 최대 3개. 초과 시 429 응답

### 취소 endpoint
**`DELETE /api/plans/:id/headless/:sessionId`** (requireAuth 적용)
- `headlessJobs`에서 해당 프로세스를 `process.kill()` 후 제거
- WebSocket으로 `headless_failed` 이벤트 전송 (reason: 'cancelled')

### 서버 재시작 복구
- 서버 시작 시 orphaned claude 프로세스 감지/kill은 하지 않음 (headless 작업은 단발성이므로 자연 종료 대기)
- `headlessJobs` Map은 휘발성 — 재시작 후 진행 중이던 작업은 상태 불명으로 처리
- 클라이언트 재접속 시 서버가 현재 `headlessJobs`의 running 목록을 `headless_sync` 이벤트로 전송

### 워크트리 조합
- `use_worktree + use_headless` → `-p -w {branch}` 둘 다 적용
- 브랜치 네이밍 로직을 서버에서 수행: `prefix = category === 'bug' ? 'fix' : 'feat'`, `branch = ${prefix}/claude-${randomWord}`

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
   - `headless_failed` → AI Tasks 모달 상태 "실패" 표시, 에러 토스트
   - `headless_sync` → 재접속 시 running 작업 목록 동기화
5. **세션 뱃지 클릭 분기:** `mode === 'headless'`이면 탭 전환 안 함

### main.js 변경
- `headless_started`, `headless_done`, `headless_failed`, `headless_sync` WebSocket 메시지 핸들러 추가
- `plan-panel.js`의 해당 함수 호출

### styles.css 변경
- `.plan-headless-check`: 워크트리 체크박스와 동일 스타일
- `.plan-headless-icon`: ⚡ 아이콘, 10px
