# Plans 칸반 보드 + AI 작업 로그 Design Spec

## Goal

Plans 모달에 칸반 보드 뷰를 추가하고, Claude Code hook으로 AI 작업 결과를 자동 기록하여 플랜별 작업 이력을 추적한다.

## Architecture

기존 Plans 모달의 List 뷰를 유지하면서 Board 뷰를 추가한다 (List/Board 토글). Board 뷰는 5열 칸반으로 플랜 상태를 시각화한다. Claude Code hook이 커밋/작업완료 시 서버 API를 호출해 로그를 append하고, 완료 시 토스트 알림을 표시한다.

---

## 1. Data Model

### 1.1 plans 테이블 변경

`status` 컬럼 추가:

```sql
ALTER TABLE plans ADD COLUMN status TEXT NOT NULL DEFAULT 'todo';
```

유효 값: `todo` | `doing` | `done` | `on_hold` | `cancelled`

기존 데이터는 전부 `todo`로 마이그레이션된다 (DEFAULT로 처리).

### 1.2 plan_logs 테이블 신설

```sql
CREATE TABLE plan_logs (
  id          BIGSERIAL    PRIMARY KEY,
  plan_id     TEXT         NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  type        TEXT         NOT NULL,  -- 'commit' | 'summary'
  content     TEXT         NOT NULL DEFAULT '',
  commit_hash TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_plan_logs_plan_id ON plan_logs(plan_id);
```

- `type: 'commit'` — 커밋 시 자동 기록. commit_hash + 커밋 메시지
- `type: 'summary'` — AI 작업 완료 시 작업 요약

---

## 2. Server API

### 2.1 기존 API 변경

- `GET /api/plans` — 응답에 `status` 필드 포함 (이미 `SELECT *`이므로 자동)
- `POST /api/plans` — body에 `status` 허용 (기본값 `todo`)
- `PUT /api/plans/:id` — body에 `status` 허용

### 2.2 신규 API

**`PATCH /api/plans/:id/status`**
- Body: `{ status: 'todo' | 'doing' | 'done' | 'on_hold' | 'cancelled' }`
- 칸반 드래그앤드롭 및 컨텍스트메뉴에서 사용
- JWT 인증 필수

**`GET /api/plans/:id/logs`**
- 해당 플랜의 로그 목록 반환 (created_at ASC)
- JWT 인증 필수

**`POST /api/plans/log`**
- Body: `{ plan_id?: string, type: 'commit' | 'summary', content: string, commit_hash?: string }`
- `plan_id` 생략 시: 해당 유저의 `status = 'doing'`인 플랜 중 가장 최근 `updated_at` 것에 자동 append
- DOING 플랜이 여러 개일 때: 가장 최근 `updated_at` 하나만 대상. 의도하지 않은 플랜에 기록될 수 있으므로, DOING은 한 번에 하나만 유지하는 것을 권장 (강제하지는 않음)
- DOING 플랜이 없으면 무시 (에러 아님, 200 OK 반환)
- `type: 'summary'`일 때 해당 플랜 카드에 `ai_done` 뱃지 플래그 설정
- JWT 인증 필수

### 2.3 plans 테이블에 ai_done 플래그

```sql
ALTER TABLE plans ADD COLUMN ai_done BOOLEAN NOT NULL DEFAULT false;
```

- AI 완료 summary 로그 append 시 `ai_done = true`로 설정
- 유저가 상태 변경하면 `ai_done = false`로 즉시 리셋 (PATCH /api/plans/:id/status에서 처리, UI도 즉시 뱃지 제거)

---

## 3. Client UI

### 3.1 뷰 토글

- 상단 카테고리 탭 (ALL/기능/버그/기타) 우측에 List/Board 토글 버튼 추가
- `📋 List` / `📊 Board` 형태
- 선택한 뷰는 localStorage에 기억 (유저 선호)

### 3.2 Board 뷰 — 5열 칸반

열 순서: **TODO → DOING → DONE → ON HOLD → CANCELLED**

각 열:
- 헤더: 상태명 + 카드 수 뱃지
- 카드 목록: 세로 스크롤
- 카테고리 탭 필터가 적용됨 (ALL이면 전체, 기능이면 기능만)

각 카드:
- 카테고리 뱃지 (기능/버그/기타)
- 제목
- 내용 미리보기 (1줄)
- 날짜
- AI 완료 뱃지 (`ai_done = true`일 때 표시)

### 3.3 카드 조작

**드래그앤드롭:**
- HTML5 Drag and Drop API 사용
- 카드를 다른 열로 드래그하면 `PATCH /api/plans/:id/status` 호출
- 드래그 중 대상 열 하이라이트

**우클릭 컨텍스트메뉴:**
- 상태 변경: TODO / DOING / DONE / ON HOLD / CANCELLED
- 삭제
- 편집 (에디터 열기)

### 3.4 에디터

- Board 뷰에서 카드 클릭 시 기존 에디터 영역을 오버레이로 표시
- 에디터 하단에 **로그 목록** 섹션 추가
  - `GET /api/plans/:id/logs`로 로드
  - 각 로그: 타입 아이콘 (🔨 commit / 📝 summary) + 내용 + commit hash (있으면 monospace) + 시간
  - 시간순 정렬 (오래된 것 위)

### 3.5 List 뷰

- 기존 그대로 유지
- 리스트 아이템에 `status` 뱃지 추가 (TODO/DOING 등 작은 태그)
- 에디터에 status 드롭다운 추가 (category 드롭다운 옆)

---

## 4. Toast 알림

### 4.1 AI 완료 토스트

- 우측 상단에 표시
- 스택 가능 (여러 개 쌓임)
- 내용: 플랜 제목 + 상태 (예: "칸반 구현 — DOING ✅ AI 완료")
- 자동 소멸: 5초 후 fade out
- 클릭 시 해당 플랜 에디터 열기

### 4.2 트리거

- `POST /api/plans/log` (type: summary) 호출 시 서버가 **기존 Control WebSocket** (`wss`)으로 알림 broadcast
- 메시지 형식: `{ type: 'plan_ai_done', planId, planTitle, planStatus }`
- 클라이언트가 `plan_ai_done` 메시지를 수신하면 토스트 표시
- 이 앱은 이미 Control WebSocket 인프라를 갖추고 있으므로 (session_list, git_status 등) 별도 WebSocket 설정 불필요

---

## 5. Claude Code Hook

### 5.1 커밋 hook

Claude Code의 `PostToolUse` hook으로 Bash 실행 후 git commit 여부를 감지한다.

**감지 방식:** hook 스크립트가 `$TOOL_INPUT`(실행된 명령어)에서 `git commit` 문자열을 grep한다. 매칭되면 `git log -1 --format='%H|||%s'`로 최근 커밋 정보를 추출하고, API를 호출한다.

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Bash",
      "command": "scripts/plan-commit-hook.sh"
    }]
  }
}
```

`scripts/plan-commit-hook.sh`:
```bash
#!/bin/bash
# $TOOL_INPUT contains the executed command
echo "$TOOL_INPUT" | grep -q 'git commit' || exit 0
COMMIT_INFO=$(git log -1 --format='%H|||%s' 2>/dev/null) || exit 0
HASH=$(echo "$COMMIT_INFO" | cut -d'|||' -f1)
MSG=$(echo "$COMMIT_INFO" | cut -d'|||' -f2-)
TOKEN="${SUPER_TERMINAL_TOKEN}"
[ -z "$TOKEN" ] && exit 0
curl -s -X POST "${SUPER_TERMINAL_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"commit\",\"content\":\"$MSG\",\"commit_hash\":\"$HASH\"}"
```

JWT 토큰은 `SUPER_TERMINAL_TOKEN` 환경변수에서 읽는다.

### 5.2 완료 hook

Claude Code의 `PostToolUse` hook에서 **유저가 수동으로 트리거**한다. 예: 터미널에서 `plan-done "작업 요약 내용"` 스크립트 실행.

`scripts/plan-done.sh`:
```bash
#!/bin/bash
SUMMARY="$1"
TOKEN="${SUPER_TERMINAL_TOKEN}"
[ -z "$TOKEN" ] && echo "SUPER_TERMINAL_TOKEN not set" && exit 1
curl -s -X POST "${SUPER_TERMINAL_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"summary\",\"content\":\"$SUMMARY\"}"
```

또는 Claude가 작업 완료 시 직접 이 스크립트를 호출하도록 프롬프트에 명시할 수 있다.

서버는 summary 로그 append 시 `ai_done = true` 설정 + WebSocket 토스트 broadcast.

---

## 6. 범위 외 (YAGNI)

- 칸반 열 커스터마이즈 (고정 5열)
- 칸반 카드 내 체크리스트/서브태스크
- 멀티유저 실시간 동기화
- 칸반 카드 라벨/태그 (카테고리로 충분)
- 칸반 WIP 제한
