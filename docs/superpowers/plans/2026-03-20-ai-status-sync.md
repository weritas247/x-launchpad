# AI 상태바 싱크 수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI가 칸반 태스크를 작업 중일 때 AI 활성화 모달(대시보드)에 해당 작업이 표시되도록 세션-플랜 연결을 서버에 저장하고 클라이언트 재연결 시 복원

**Architecture:** 서버 Session 객체에 `planId` 필드를 추가하고, `session_list`와 `session_info` 메시지에 `ai`·`planId`를 포함시킨다. 클라이언트는 세션 목록 수신 시 `plan.ai_sessions`를 세션 데이터로부터 재구축한다. DB에도 `plan_id` 컬럼을 추가해 서버 재시작 시에도 연결이 유지된다.

**Tech Stack:** TypeScript (server), Vanilla JS (client), better-sqlite3 (DB)

---

## Root Cause

`plan.ai_sessions`는 클라이언트 메모리에만 존재하고 서버/DB에 전혀 저장되지 않음. 페이지 새로고침이나 WS 재연결 시 이 데이터가 소실되어 AI 대시보드가 비어 보임.

구체적으로:
1. 서버 `Session` 객체에 `planId` 필드 없음
2. `session_list` 브로드캐스트에 `ai`/`planId` 미포함
3. DB `sessions` 테이블에 `plan_id` 컬럼 없음
4. 클라이언트 reconnect 시 세션→플랜 매핑을 복원하는 로직 없음

---

### Task 1: 서버 Session에 planId 추가 및 session_list에 ai·planId 포함

**Files:**
- Modify: `server/handlers/types.ts:30` — Session 인터페이스에 `planId` 필드 추가
- Modify: `server/handlers/session.ts:17-31` — session_create에서 planId 저장
- Modify: `server/index.ts:343-354` — createSession에서 planId 초기화
- Modify: `server/index.ts:292-297` — createSession 시그니처에 planId 파라미터 추가
- Modify: `server/index.ts:551-556` — broadcastSessionList에 ai, planId 포함
- Modify: `server/index.ts:677-682` — WS 연결 시 session_list에도 동일 적용

- [ ] **Step 1: Session 인터페이스에 planId 추가**

`server/handlers/types.ts` — Session 인터페이스에 추가:
```typescript
planId?: string;  // 연결된 plan ID (칸반 AI 할당용)
```

- [ ] **Step 2: createSession 시그니처 및 초기화에 planId 추가**

`server/index.ts` — createSession 함수 시그니처를 수정:
```typescript
function createSession(
  id: string,
  name: string,
  restoreCwd?: string,
  restoreCmd?: string,
  extraEnv?: Record<string, string>,
  planId?: string
): Session {
```

Session 객체 생성 시 `planId` 추가:
```typescript
const session: Session = {
  id,
  name,
  pty: ptyProcess,
  createdAt: Date.now(),
  cwd: cwd0,
  ai: null,
  aiPid: null,
  cmd: restoreCmd,
  planId: planId || undefined,
  scrollback: '',
  tmuxName: useTmux ? tmuxName : undefined,
};
```

- [ ] **Step 3: session_create 핸들러에서 planId 전달**

`server/handlers/session.ts` — createSession 호출에 planId 전달:
```typescript
session_create(ctx, parsed) {
    const id = `session-${Date.now()}`;
    const nameFormat = ctx.currentSettings.shell.sessionNameFormat || 'shell-{n}';
    const name =
      (parsed.name as string) || nameFormat.replace('{n}', String(ctx.sessions.size + 1));
    const planId = parsed.planId as string | undefined;
    const extraEnv = planId ? { X_LAUNCHPAD_PLAN_ID: planId } : undefined;
    const sess = ctx.createSession(id, name, parsed.cwd as string | undefined, undefined, extraEnv, planId);
    // ... 나머지 동일
```

WsContext.createSession 시그니처도 업데이트:
```typescript
createSession: (
  id: string,
  name: string,
  restoreCwd?: string,
  restoreCmd?: string,
  extraEnv?: Record<string, string>,
  planId?: string
) => Session;
```

- [ ] **Step 4: session_list에 ai, planId 포함**

`server/index.ts` — broadcastSessionList 내 map과 WS 연결 시 list map 모두 수정:
```typescript
const list = Array.from(sessions.values()).map((s) => ({
  id: s.id,
  name: s.name,
  createdAt: s.createdAt,
  cwd: s.cwd,
  ai: s.ai,
  planId: s.planId,
}));
```

두 곳 모두 동일하게 수정 (broadcastSessionList 내 line ~551, WS connection 시 line ~677)

- [ ] **Step 5: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npm run build`
Expected: 컴파일 성공

- [ ] **Step 6: Commit**

```bash
git add server/handlers/types.ts server/handlers/session.ts server/index.ts
git commit -m "fix: session_list에 ai·planId 포함하여 AI 상태 싱크 기반 마련"
```

---

### Task 2: DB에 plan_id 컬럼 추가 및 세션 영속화

**Files:**
- Modify: `server/db.ts:20-27` — sessions 테이블에 plan_id 컬럼 추가
- Modify: `server/db.ts:76-77` — SQL 구문에 plan_id 포함
- Modify: `server/db.ts:82-88` — SessionRow에 plan_id 추가
- Modify: `server/db.ts:94-101` — upsertSession에 plan_id 파라미터 추가
- Modify: `server/db.ts:108-118` — saveSessions에 plan_id 포함
- Modify: `server/index.ts:533-540` — persistSessions에서 planId 저장
- Modify: `server/index.ts:578-616` — restoreSessions에서 planId 복원·전달

- [ ] **Step 1: DB 스키마에 plan_id 컬럼 추가**

`server/db.ts` — `CREATE TABLE sessions` 정의에 `plan_id` 추가 (신규 설치 대응):
```typescript
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    cwd TEXT DEFAULT '',
    cmd TEXT DEFAULT '',
    plan_id TEXT DEFAULT '',
    updated_at INTEGER DEFAULT (strftime('%s','now'))
  );
```

그리고 스키마 정의 뒤에 기존 DB 마이그레이션 추가:
```typescript
// Migration: add plan_id column if missing (기존 DB 업그레이드)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN plan_id TEXT DEFAULT ''`);
} catch {}
```

- [ ] **Step 2: SessionRow, upsertSession, saveSessions에 plan_id 추가**

`server/db.ts`:

SessionRow:
```typescript
export interface SessionRow {
  id: string;
  name: string;
  created_at: number;
  cwd: string;
  cmd: string;
  plan_id: string;
}
```

stmtUpsertSession:
```typescript
const stmtUpsertSession = db.prepare(
  "INSERT OR REPLACE INTO sessions (id, name, created_at, cwd, cmd, plan_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))"
);
```

upsertSession:
```typescript
export function upsertSession(
  id: string,
  name: string,
  createdAt: number,
  cwd: string,
  cmd?: string,
  planId?: string
): void {
  stmtUpsertSession.run(id, name, createdAt, cwd, cmd || '', planId || '');
}
```

saveSessions:
```typescript
export function saveSessions(
  sessions: Array<{ id: string; name: string; createdAt: number; cwd: string; cmd?: string; planId?: string }>
): void {
  const transaction = db.transaction(() => {
    stmtClearSessions.run();
    for (const s of sessions) {
      stmtUpsertSession.run(s.id, s.name, s.createdAt, s.cwd, s.cmd || '', s.planId || '');
    }
  });
  transaction();
}
```

- [ ] **Step 3: persistSessions에서 planId 저장**

`server/index.ts` — persistSessions:
```typescript
function persistSessions() {
  const data = Array.from(sessions.values()).map((s) => ({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    cwd: s.cwd,
    cmd: s.cmd,
    planId: s.planId,
  }));
  // ... 나머지 동일
```

- [ ] **Step 4: restoreSessions에서 planId 복원**

`server/index.ts` — restoreSessions 내:

saved 타입에 planId 추가:
```typescript
let saved: Array<{ id: string; name: string; createdAt: number; cwd: string; cmd?: string; planId?: string }>;
```

DB에서 읽을 때:
```typescript
saved = dbSessions.map((r) => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  cwd: r.cwd,
  cmd: r.cmd || undefined,
  planId: r.plan_id || undefined,
}));
```

createSession 호출에 planId 전달:
```typescript
// tmux alive 케이스:
const sess = createSession(s.id, s.name, s.cwd, undefined, undefined, s.planId);

// 일반 케이스:
const sess = createSession(s.id, s.name, s.cwd, cmd, undefined, s.planId);
```

- [ ] **Step 5: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npm run build`
Expected: 컴파일 성공

- [ ] **Step 6: Commit**

```bash
git add server/db.ts server/index.ts
git commit -m "fix: DB에 plan_id 영속화하여 서버 재시작 시에도 AI-플랜 연결 유지"
```

---

### Task 3: 클라이언트 — 세션 목록에서 plan.ai_sessions 복원

**Files:**
- Modify: `client/js/sidebar/plan-panel.js:956-981` — getActiveAiTasks에 세션 기반 복원 로직 추가
- Modify: `client/js/sidebar/plan-panel.js:920-946` — onAiPromptSent에서 중복 방지
- Modify: `client/js/sidebar/plan-panel.js` — syncAiSessionsFromList 함수 신규 추가 및 export
- Modify: `client/js/core/main.js:122-130` — session_list 수신 시 AI 싱크 호출
- Modify: `client/js/terminal/terminal.js:155-167` — syncSessionList에서 ai/planId 메타데이터 저장

- [ ] **Step 1: syncSessionList에서 ai/planId 메타데이터 저장**

`client/js/terminal/terminal.js` — sessionMeta에 ai와 planId도 저장:
```javascript
sessions.forEach((s) => {
  if (!sessionMeta.has(s.id)) {
    sessionMeta.set(s.id, { name: s.name, createdAt: s.createdAt, ai: s.ai, planId: s.planId });
    attachTerminal(s.id, s.name);
    newIds.push(s.id);
  } else {
    // 기존 세션 메타 업데이트 (ai/planId가 나중에 설정될 수 있으므로)
    const meta = sessionMeta.get(s.id);
    if (s.ai) meta.ai = s.ai;
    if (s.planId) meta.planId = s.planId;
  }
});
```

- [ ] **Step 2: plan-panel에 syncAiSessionsFromList 함수 추가**

`client/js/sidebar/plan-panel.js` — 새 export 함수:
```javascript
/**
 * session_list 데이터로부터 plan.ai_sessions를 재구축한다.
 * 서버가 보내는 세션 목록에 ai와 planId가 포함되어야 동작.
 */
export function syncAiSessionsFromList(sessions) {
  let changed = false;
  for (const s of sessions) {
    if (!s.ai || !s.planId) continue;
    const plan = plans.find((p) => p.id === s.planId);
    if (!plan) continue;
    if (!plan.ai_sessions) plan.ai_sessions = [];
    // 이미 등록된 세션이면 스킵
    if (plan.ai_sessions.some((as) => as.sessionId === s.id)) continue;
    plan.ai_sessions.push({ sessionId: s.id, ai: s.ai });
    changed = true;
  }
  if (!changed) return;
  renderBoard();
  updateAiTasksBadge();
}
```

- [ ] **Step 3: onAiPromptSent에 중복 방지**

`client/js/sidebar/plan-panel.js:930-931` — 이미 있으면 스킵:
```javascript
if (!plan.ai_sessions) plan.ai_sessions = [];
if (!plan.ai_sessions.some((s) => s.sessionId === sessionId)) {
  plan.ai_sessions.push({ sessionId, ai: aiType });
}
```

- [ ] **Step 4: main.js에서 session_list 수신 시 syncAiSessionsFromList 호출**

`client/js/core/main.js`:

import 추가:
```javascript
import { syncAiSessionsFromList } from '../sidebar/plan-panel.js';
```

session_list 핸들러에 추가 (syncSessionList 호출 후):
```javascript
if (msg.type === 'session_list') {
  syncSessionList(msg.sessions, S.wsJustReconnected);
  syncAiSessionsFromList(msg.sessions);  // AI 세션 ↔ 플랜 연결 복원
  // ... 나머지 기존 코드 동일
```

- [ ] **Step 5: 수동 테스트**

1. AI를 칸반 태스크에 할당
2. 페이지 새로고침
3. AI 상태바 클릭 → 대시보드에 작업 중인 AI 세션 표시 확인
4. 칸반 보드에서 해당 카드에 AI 세션 뱃지 표시 확인

- [ ] **Step 6: Commit**

```bash
git add client/js/sidebar/plan-panel.js client/js/core/main.js client/js/terminal/terminal.js
git commit -m "fix: 페이지 새로고침 시 AI 상태바 대시보드에 활성 AI 작업 복원"
```

---

### Task 4: session_info에서도 planId 전달 (실시간 업데이트)

**Files:**
- Modify: `server/index.ts:513-518` — session_info 브로드캐스트에 planId 포함
- Modify: `server/handlers/session.ts:63-71` — session_attach의 session_info에 planId 포함
- Modify: `client/js/core/main.js:173-177` — session_info 수신 시 planId 처리

- [ ] **Step 1: 서버 CWD 폴링의 session_info에 planId 포함**

`server/index.ts` — session_info 메시지에 planId 추가:
```typescript
const msg = JSON.stringify({
  type: 'session_info',
  sessionId: id,
  cwd: newCwd,
  ai: newAi,
  planId: session.planId,
});
```

- [ ] **Step 2: session_attach의 session_info에 planId 포함**

`server/handlers/session.ts:63-71`:
```typescript
ctx.wsSend(
  ctx.ws,
  JSON.stringify({
    type: 'session_info',
    sessionId: id,
    cwd: sess.cwd,
    ai: sess.ai,
    planId: sess.planId,
  })
);
```

- [ ] **Step 3: 클라이언트 session_info 핸들러에서 planId 처리**

`client/js/core/main.js` — session_info 핸들러에서 planId도 전달:
```javascript
} else if (msg.type === 'session_info') {
    updateSessionInfo(msg.sessionId, msg.cwd, msg.ai);
    // sessionMeta에 planId도 저장
    const meta = sessionMeta.get(msg.sessionId);
    if (meta && msg.planId) meta.planId = msg.planId;
    tabStatusOnAiChange(msg.sessionId, msg.ai);
    onAiChangeUsage(msg.sessionId, msg.ai);
    if (msg.ai) onAiSessionReady(msg.sessionId, msg.ai);
    // AI + planId가 있으면 plan.ai_sessions에도 반영
    if (msg.ai && msg.planId) {
      syncAiSessionsFromList([{ id: msg.sessionId, ai: msg.ai, planId: msg.planId }]);
    }
    // ... 나머지 동일
```

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/redpug/Dev/x-launchpad && npm run build`
Expected: 컴파일 성공

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/handlers/session.ts client/js/core/main.js
git commit -m "fix: session_info에도 planId 포함하여 실시간 AI-플랜 싱크 보장"
```
