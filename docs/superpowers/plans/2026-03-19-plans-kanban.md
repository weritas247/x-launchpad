# Plans 칸반 보드 + AI 작업 로그 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plans 모달에 5열 칸반 보드 뷰를 추가하고, Claude Code hook으로 AI 작업 결과를 자동 기록한다.

**Architecture:** DB에 status/ai_done 컬럼과 plan_logs 테이블 추가 → 서버 API 확장 → 클라이언트에 Board 뷰/토스트/컨텍스트메뉴 추가 → hook 스크립트 생성

**Tech Stack:** Supabase (PostgreSQL), Express, HTML5 Drag and Drop, WebSocket (기존 wss 활용)

**Spec:** `docs/superpowers/specs/2026-03-19-plans-kanban-design.md`

---

## File Structure

**수정:**
- `supabase/schema.sql` — status, ai_done 컬럼 + plan_logs 테이블
- `server/supabase.ts` — plan_logs CRUD, updatePlanStatus, appendPlanLog 함수
- `server/index.ts` — PATCH/GET/POST 엔드포인트 3개 + WebSocket broadcast
- `client/index.html` — Board 뷰 컨테이너, 뷰 토글 버튼, status 드롭다운, 로그 영역, 토스트 컨테이너, 컨텍스트메뉴 HTML
- `client/js/plan-panel.js` — Board 뷰 렌더링, 드래그앤드롭, 컨텍스트메뉴, 로그 표시, 토스트 처리

**생성:**
- `scripts/plan-commit-hook.sh` — 커밋 감지 hook
- `scripts/plan-done.sh` — AI 완료 수동 트리거

---

### Task 1: DB 스키마 확장 (status, ai_done, plan_logs)

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: schema.sql에 status/ai_done 컬럼 및 plan_logs 테이블 추가**

`supabase/schema.sql` 맨 끝에 추가:

```sql
-- plans 테이블 확장
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS ai_done BOOLEAN NOT NULL DEFAULT false;

-- ─── Plan Logs ──────────────────────────────────────────────────
create table if not exists public.plan_logs (
  id          bigserial       primary key,
  plan_id     text            not null references public.plans(id) on delete cascade,
  type        text            not null,
  content     text            not null default '',
  commit_hash text,
  created_at  timestamptz     not null default now()
);

create index if not exists idx_plan_logs_plan_id on public.plan_logs(plan_id);

alter table public.plan_logs disable row level security;
```

- [ ] **Step 2: 커밋**

```bash
git add supabase/schema.sql
git commit -m "feat: plans 테이블에 status/ai_done 추가, plan_logs 테이블 생성"
```

---

### Task 2: Supabase CRUD 함수 확장

**Files:**
- Modify: `server/supabase.ts`

- [ ] **Step 1: PlanRow에 status, ai_done 추가 및 새 함수 작성**

`server/supabase.ts`의 `PlanRow` 인터페이스에 필드 추가하고, 하단에 새 함수들 추가:

PlanRow 인터페이스 수정:
```typescript
export interface PlanRow {
  id: string;
  user_id: number;
  title: string;
  content: string;
  category: string;
  status: string;
  ai_done: boolean;
  created_at: string;
  updated_at: string;
}
```

기존 `createPlan` 함수 수정 — insert에 `status` 포함:
```typescript
export async function createPlan(userId: number, plan: { id: string; title: string; content: string; category: string; status?: string }): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .insert({ id: plan.id, user_id: userId, title: plan.title, content: plan.content, category: plan.category, status: plan.status || 'todo' })
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}
```

기존 `updatePlan` 함수 수정 — updates에 `status` 허용:
```typescript
export async function updatePlan(userId: number, planId: string, updates: { title?: string; content?: string; category?: string; status?: string }): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}
```

새 함수들 추가:
```typescript
export async function updatePlanStatus(userId: number, planId: string, status: string): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .update({ status, ai_done: false, updated_at: new Date().toISOString() })
    .eq('id', planId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export interface PlanLogRow {
  id: number;
  plan_id: string;
  type: string;
  content: string;
  commit_hash: string | null;
  created_at: string;
}

export async function getPlanLogs(userId: number, planId: string): Promise<PlanLogRow[]> {
  // Verify plan belongs to user first
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (planErr || !plan) throw planErr || new Error('Plan not found');

  const { data, error } = await supabase
    .from('plan_logs')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as PlanLogRow[];
}

export async function appendPlanLog(userId: number, log: { plan_id?: string; type: string; content: string; commit_hash?: string }): Promise<{ plan: PlanRow | null; log: PlanLogRow | null }> {
  let planId = log.plan_id;

  // Auto-detect: find most recent DOING plan for this user
  if (!planId) {
    const { data: doingPlans } = await supabase
      .from('plans')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'doing')
      .order('updated_at', { ascending: false })
      .limit(1);
    if (!doingPlans || doingPlans.length === 0) return { plan: null, log: null };
    planId = doingPlans[0].id;
  } else {
    // Verify plan belongs to user
    const { data: plan } = await supabase
      .from('plans')
      .select('id')
      .eq('id', planId)
      .eq('user_id', userId)
      .single();
    if (!plan) throw new Error('Plan not found');
  }

  // Insert log
  const { data: logRow, error: logErr } = await supabase
    .from('plan_logs')
    .insert({ plan_id: planId, type: log.type, content: log.content, commit_hash: log.commit_hash || null })
    .select()
    .single();
  if (logErr) throw logErr;

  // If summary, set ai_done = true
  let plan: PlanRow | null = null;
  if (log.type === 'summary') {
    const { data: updated } = await supabase
      .from('plans')
      .update({ ai_done: true })
      .eq('id', planId)
      .select()
      .single();
    plan = updated as PlanRow;
  } else {
    const { data: current } = await supabase
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single();
    plan = current as PlanRow;
  }

  return { plan, log: logRow as PlanLogRow };
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/supabase.ts
git commit -m "feat: Supabase plans CRUD에 status/ai_done/logs 함수 추가"
```

---

### Task 3: 서버 API 엔드포인트 추가

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: 3개의 신규 엔드포인트 추가**

`server/index.ts`의 기존 `DELETE /api/plans/:id` 엔드포인트 다음에 추가:

```typescript
app.patch('/api/plans/:id/status', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { status } = req.body || {};
  const validStatuses = ['todo', 'doing', 'done', 'on_hold', 'cancelled'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  }
  try {
    const plan = await userDb.updatePlanStatus(payload.userId, req.params.id, status);
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/plans/:id/logs', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const logs = await userDb.getPlanLogs(payload.userId, req.params.id);
    res.json({ ok: true, logs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/plans/log', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { plan_id, type, content, commit_hash } = req.body || {};
  if (!type || !['commit', 'summary'].includes(type)) {
    return res.status(400).json({ ok: false, error: 'Invalid type' });
  }
  try {
    const result = await userDb.appendPlanLog(payload.userId, { plan_id, type, content: content || '', commit_hash });
    // WebSocket broadcast for summary (toast trigger)
    if (type === 'summary' && result.plan) {
      const msg = JSON.stringify({
        type: 'plan_ai_done',
        planId: result.plan.id,
        planTitle: result.plan.title,
        planStatus: result.plan.status,
      });
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
    }
    res.json({ ok: true, plan: result.plan, log: result.log });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});
```

- [ ] **Step 2: 기존 POST/PUT에서 status 허용 확인**

기존 `POST /api/plans`의 body destructuring에 `status` 추가:
```typescript
const { id, title, content, category, status } = req.body || {};
```
createPlan 호출에 status 전달:
```typescript
const plan = await userDb.createPlan(payload.userId, {
  id, title: title || '', content: content || '', category: category || 'other', status: status || 'todo',
});
```

기존 `PUT /api/plans/:id`의 body destructuring에 `status` 추가:
```typescript
const { title, content, category, status } = req.body || {};
```
updatePlan 호출에 status 전달:
```typescript
const plan = await userDb.updatePlan(payload.userId, req.params.id, { title, content, category, status });
```

- [ ] **Step 3: 커밋**

```bash
git add server/index.ts
git commit -m "feat: /api/plans status/logs 엔드포인트 + WebSocket broadcast"
```

---

### Task 4: HTML — Board 뷰 컨테이너, 토글, 상태 드롭다운, 로그 영역, 토스트

**Files:**
- Modify: `client/index.html`

- [ ] **Step 1: plan-category-tabs에 뷰 토글 버튼 추가**

`client/index.html:427` 의 `plan-category-tabs` div 안, 기존 탭 버튼들 뒤에 뷰 토글 추가:

```html
<div class="plan-category-tabs" id="plan-category-tabs">
  <button class="plan-cat-tab active" data-cat="all">ALL<span class="plan-cat-count" id="plan-count-all">0</span></button>
  <button class="plan-cat-tab" data-cat="feature">기능<span class="plan-cat-count" id="plan-count-feature">0</span></button>
  <button class="plan-cat-tab" data-cat="bug">버그<span class="plan-cat-count" id="plan-count-bug">0</span></button>
  <button class="plan-cat-tab" data-cat="other">기타<span class="plan-cat-count" id="plan-count-other">0</span></button>
  <span class="plan-view-toggle" id="plan-view-toggle">
    <button class="plan-view-btn active" data-view="list" title="List view">📋</button>
    <button class="plan-view-btn" data-view="board" title="Board view">📊</button>
  </span>
</div>
```

- [ ] **Step 2: plan-body 안에 Board 뷰 컨테이너 추가**

기존 `plan-body` div 안, `plan-list-col` 앞에 board 컨테이너 추가:

```html
<div class="plan-body">
  <!-- BOARD VIEW (kanban) -->
  <div class="plan-board" id="plan-board" style="display:none">
    <div class="plan-board-col" data-status="todo">
      <div class="plan-board-col-header">TODO <span class="plan-board-count" id="plan-board-count-todo">0</span></div>
      <div class="plan-board-cards" id="plan-board-todo"></div>
    </div>
    <div class="plan-board-col" data-status="doing">
      <div class="plan-board-col-header">DOING <span class="plan-board-count" id="plan-board-count-doing">0</span></div>
      <div class="plan-board-cards" id="plan-board-doing"></div>
    </div>
    <div class="plan-board-col" data-status="done">
      <div class="plan-board-col-header">DONE <span class="plan-board-count" id="plan-board-count-done">0</span></div>
      <div class="plan-board-cards" id="plan-board-done"></div>
    </div>
    <div class="plan-board-col" data-status="on_hold">
      <div class="plan-board-col-header">ON HOLD <span class="plan-board-count" id="plan-board-count-on_hold">0</span></div>
      <div class="plan-board-cards" id="plan-board-on_hold"></div>
    </div>
    <div class="plan-board-col" data-status="cancelled">
      <div class="plan-board-col-header">CANCELLED <span class="plan-board-count" id="plan-board-count-cancelled">0</span></div>
      <div class="plan-board-cards" id="plan-board-cancelled"></div>
    </div>
  </div>
  <!-- LIST VIEW (existing) -->
  <div class="plan-list-col" id="plan-list-col">
    ...existing content...
  </div>
  <div class="plan-editor-col" id="plan-editor-col">
    ...existing content...
  </div>
</div>
```

- [ ] **Step 3: 에디터에 status 드롭다운 + 로그 영역 추가**

에디터 footer의 category select 옆에 status select 추가:
```html
<select class="plan-status-select" id="plan-status-select">
  <option value="todo">TODO</option>
  <option value="doing">DOING</option>
  <option value="done">DONE</option>
  <option value="on_hold">ON HOLD</option>
  <option value="cancelled">CANCELLED</option>
</select>
```

에디터 area 안, footer 뒤에 로그 섹션 추가:
```html
<div class="plan-logs" id="plan-logs">
  <div class="plan-logs-header">Activity Log</div>
  <div class="plan-logs-list" id="plan-logs-list"></div>
</div>
```

- [ ] **Step 4: 칸반 컨텍스트메뉴 HTML 추가**

`plan-overlay` 바로 뒤에:
```html
<div class="plan-ctx-menu" id="plan-ctx-menu" style="display:none">
  <div class="plan-ctx-item" data-action="edit">✏️ 편집</div>
  <div class="plan-ctx-sep"></div>
  <div class="plan-ctx-item" data-action="status" data-status="todo">📋 TODO</div>
  <div class="plan-ctx-item" data-action="status" data-status="doing">🔨 DOING</div>
  <div class="plan-ctx-item" data-action="status" data-status="done">✅ DONE</div>
  <div class="plan-ctx-item" data-action="status" data-status="on_hold">⏸ ON HOLD</div>
  <div class="plan-ctx-item" data-action="status" data-status="cancelled">❌ CANCELLED</div>
  <div class="plan-ctx-sep"></div>
  <div class="plan-ctx-item plan-ctx-danger" data-action="delete">🗑 삭제</div>
</div>
```

- [ ] **Step 5: 토스트 컨테이너 추가**

`</body>` 직전에:
```html
<div class="plan-toast-container" id="plan-toast-container"></div>
```

- [ ] **Step 6: 커밋**

```bash
git add client/index.html
git commit -m "feat: Plans 모달에 Board 뷰, 컨텍스트메뉴, 토스트 HTML 추가"
```

---

### Task 5: CSS — 칸반 보드, 컨텍스트메뉴, 토스트 스타일

**Files:**
- Modify: `client/index.html` (인라인 `<style>` 또는 기존 CSS 파일)

참고: 이 프로젝트의 CSS가 어디 있는지 확인 필요. `client/index.html` 내 `<style>` 태그 또는 별도 CSS 파일에 추가한다.

- [ ] **Step 1: Board 뷰, 카드, 드래그, 컨텍스트메뉴, 토스트 CSS 추가**

```css
/* ─── Plan View Toggle ─── */
.plan-view-toggle { margin-left: auto; display: flex; gap: 2px; }
.plan-view-btn { background: none; border: 1px solid #333; color: #888; padding: 2px 8px; cursor: pointer; font-size: 12px; border-radius: 3px; }
.plan-view-btn.active { color: var(--accent, #0f0); border-color: var(--accent, #0f0); }

/* ─── Plan Board (Kanban) ─── */
.plan-board { display: flex; gap: 8px; flex: 1; overflow-x: auto; padding: 8px; min-height: 0; }
.plan-board-col { flex: 1; min-width: 160px; display: flex; flex-direction: column; background: rgba(255,255,255,0.03); border-radius: 6px; padding: 6px; }
.plan-board-col-header { text-align: center; font-size: 11px; font-weight: 600; color: #888; text-transform: uppercase; padding: 6px 0; letter-spacing: 0.5px; }
.plan-board-col-header .plan-board-count { background: rgba(255,255,255,0.1); padding: 1px 6px; border-radius: 8px; font-size: 10px; margin-left: 4px; }
.plan-board-cards { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; min-height: 60px; padding: 2px; }
.plan-board-col.drag-over { background: rgba(var(--accent-rgb, 0,255,0), 0.08); outline: 1px dashed var(--accent, #0f0); }

/* ─── Kanban Card ─── */
.plan-board-card { background: rgba(255,255,255,0.06); border-radius: 4px; padding: 8px; cursor: grab; border-left: 3px solid #555; position: relative; }
.plan-board-card:hover { background: rgba(255,255,255,0.1); }
.plan-board-card.dragging { opacity: 0.4; }
.plan-board-card[data-cat="feature"] { border-left-color: #4caf50; }
.plan-board-card[data-cat="bug"] { border-left-color: #ff9800; }
.plan-board-card[data-cat="other"] { border-left-color: #2196f3; }
.plan-board-card-title { font-size: 12px; color: #ddd; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan-board-card-preview { font-size: 10px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.plan-board-card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.plan-board-card-date { font-size: 9px; color: #555; }
.plan-board-card-cat { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(255,255,255,0.08); color: #888; }
.plan-board-card-ai-badge { font-size: 9px; background: #4caf50; color: #000; padding: 1px 4px; border-radius: 3px; margin-left: 4px; animation: pulse-glow 1.5s infinite; }
@keyframes pulse-glow { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }

/* ─── Plan Context Menu ─── */
.plan-ctx-menu { position: fixed; background: #1a1a2e; border: 1px solid #333; border-radius: 6px; padding: 4px 0; min-width: 160px; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
.plan-ctx-item { padding: 6px 12px; font-size: 12px; color: #ccc; cursor: pointer; }
.plan-ctx-item:hover { background: rgba(255,255,255,0.08); }
.plan-ctx-danger { color: #f44; }
.plan-ctx-sep { border-top: 1px solid #333; margin: 2px 0; }

/* ─── Plan Logs ─── */
.plan-logs { border-top: 1px solid #333; margin-top: 8px; max-height: 200px; overflow-y: auto; }
.plan-logs-header { font-size: 11px; color: #888; padding: 6px 0 4px; font-weight: 600; }
.plan-logs-list { display: flex; flex-direction: column; gap: 2px; }
.plan-log-item { display: flex; gap: 6px; align-items: flex-start; padding: 4px 0; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.04); }
.plan-log-icon { flex-shrink: 0; }
.plan-log-content { flex: 1; color: #aaa; }
.plan-log-hash { font-family: monospace; font-size: 10px; color: #666; }
.plan-log-time { font-size: 9px; color: #555; flex-shrink: 0; }

/* ─── Plan Toast ─── */
.plan-toast-container { position: fixed; top: 16px; right: 16px; z-index: 10002; display: flex; flex-direction: column; gap: 8px; pointer-events: none; }
.plan-toast { background: #1a1a2e; border: 1px solid var(--accent, #0f0); border-radius: 6px; padding: 10px 16px; color: #ddd; font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); pointer-events: auto; cursor: pointer; animation: toast-in 0.3s ease-out; max-width: 300px; }
.plan-toast.fade-out { animation: toast-out 0.3s ease-in forwards; }
.plan-toast-title { font-weight: 600; margin-bottom: 2px; }
.plan-toast-status { font-size: 10px; color: #888; }
@keyframes toast-in { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toast-out { from { opacity: 1; } to { opacity: 0; transform: translateX(40px); } }

/* ─── List view status badge ─── */
.plan-item-status { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: rgba(255,255,255,0.08); color: #888; margin-left: 4px; text-transform: uppercase; }

/* ─── Status select ─── */
.plan-status-select { background: #1a1a2e; color: #ccc; border: 1px solid #333; border-radius: 4px; padding: 2px 6px; font-size: 11px; }
```

- [ ] **Step 2: 커밋**

```bash
git add client/index.html
git commit -m "style: 칸반 보드, 컨텍스트메뉴, 토스트 CSS 추가"
```

---

### Task 6: plan-panel.js — Board 뷰 렌더링 + 뷰 토글

**Files:**
- Modify: `client/js/plan-panel.js`

- [ ] **Step 1: 뷰 상태 변수 및 DOM refs 추가**

파일 상단 변수 선언 영역에 추가:

```javascript
const boardEl = document.getElementById('plan-board');
const listColEl = document.getElementById('plan-list-col');
const editorColEl = document.getElementById('plan-editor-col');
const viewToggleEl = document.getElementById('plan-view-toggle');
const statusSelect = document.getElementById('plan-status-select');
const logsListEl = document.getElementById('plan-logs-list');
const toastContainer = document.getElementById('plan-toast-container');

let currentView = localStorage.getItem('plan-view') || 'list'; // 'list' | 'board'
```

- [ ] **Step 2: 뷰 토글 함수 추가**

```javascript
function switchView(view) {
  currentView = view;
  localStorage.setItem('plan-view', view);
  viewToggleEl?.querySelectorAll('.plan-view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'board') {
    if (boardEl) boardEl.style.display = 'flex';
    if (listColEl) listColEl.style.display = 'none';
    if (editorColEl) editorColEl.style.display = 'none';
    renderBoard();
  } else {
    if (boardEl) boardEl.style.display = 'none';
    if (listColEl) listColEl.style.display = '';
    if (editorColEl) editorColEl.style.display = '';
    renderList();
  }
}
```

- [ ] **Step 3: Board 렌더링 함수 추가**

```javascript
const STATUSES = ['todo', 'doing', 'done', 'on_hold', 'cancelled'];
const STATUS_LABELS = { todo: 'TODO', doing: 'DOING', done: 'DONE', on_hold: 'ON HOLD', cancelled: 'CANCELLED' };

function renderBoard() {
  const filtered = filteredPlans();
  for (const status of STATUSES) {
    const col = document.getElementById(`plan-board-${status}`);
    const countEl = document.getElementById(`plan-board-count-${status}`);
    if (!col) continue;
    const cards = filtered.filter(p => (p.status || 'todo') === status);
    if (countEl) countEl.textContent = cards.length;
    col.innerHTML = cards.map(p => {
      const title = escHtml(p.title || 'Untitled');
      const preview = escHtml((p.content || '').slice(0, 60).replace(/\n/g, ' '));
      const date = formatDate(p.updated);
      const catLabel = CATEGORIES[p.category] || '기타';
      const aiBadge = p.ai_done ? '<span class="plan-board-card-ai-badge">✅ AI</span>' : '';
      return `<div class="plan-board-card" draggable="true" data-id="${p.id}" data-cat="${p.category || 'other'}">
        <div class="plan-board-card-title">${title}</div>
        <div class="plan-board-card-preview">${preview || 'No content'}</div>
        <div class="plan-board-card-footer">
          <span class="plan-board-card-cat">${catLabel}</span>
          <span>${aiBadge}</span>
          <span class="plan-board-card-date">${date}</span>
        </div>
      </div>`;
    }).join('');
  }
}
```

- [ ] **Step 4: loadPlans에 status/ai_done 매핑 추가**

`loadPlans()` 내 plans 매핑에 추가:
```javascript
plans = data.plans.map(p => ({
  id: p.id,
  title: p.title || '',
  content: p.content || '',
  category: p.category || 'other',
  status: p.status || 'todo',
  ai_done: p.ai_done || false,
  created: new Date(p.created_at).getTime(),
  updated: new Date(p.updated_at).getTime(),
}));
```

- [ ] **Step 5: initPlanPanel에 뷰 토글 이벤트 등록 + 초기 뷰 적용**

```javascript
// View toggle
viewToggleEl?.addEventListener('click', e => {
  const btn = e.target.closest('.plan-view-btn');
  if (btn) switchView(btn.dataset.view);
});

// 초기 뷰 적용 (initPlanPanel 끝에서)
switchView(currentView);
```

- [ ] **Step 6: openPlanModal에서 현재 뷰에 맞게 렌더**

`openPlanModal()`에서 `renderList()` 호출 부분을:
```javascript
if (currentView === 'board') renderBoard();
else renderList();
```

- [ ] **Step 7: 커밋**

```bash
git add client/js/plan-panel.js
git commit -m "feat: Board 뷰 렌더링 + List/Board 뷰 토글"
```

---

### Task 7: plan-panel.js — 드래그앤드롭

**Files:**
- Modify: `client/js/plan-panel.js`

- [ ] **Step 1: 드래그앤드롭 이벤트 함수 추가**

```javascript
function initBoardDragDrop() {
  // Drag start on cards
  boardEl?.addEventListener('dragstart', e => {
    const card = e.target.closest('.plan-board-card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  boardEl?.addEventListener('dragend', e => {
    const card = e.target.closest('.plan-board-card');
    if (card) card.classList.remove('dragging');
    boardEl.querySelectorAll('.plan-board-col').forEach(col => col.classList.remove('drag-over'));
  });

  // Drop targets: columns
  boardEl?.querySelectorAll('.plan-board-col').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });

    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over');
    });

    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const planId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (!planId || !newStatus) return;
      const plan = plans.find(p => p.id === planId);
      if (!plan || plan.status === newStatus) return;

      // Optimistic update
      plan.status = newStatus;
      plan.ai_done = false;
      renderBoard();

      try {
        await apiFetch(`/api/plans/${planId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch (err) {
        console.error('[plan] status update failed:', err);
        await loadPlans();
        renderBoard();
      }
    });
  });
}
```

- [ ] **Step 2: initPlanPanel에서 initBoardDragDrop() 호출**

```javascript
initBoardDragDrop();
```

- [ ] **Step 3: 커밋**

```bash
git add client/js/plan-panel.js
git commit -m "feat: 칸반 카드 드래그앤드롭으로 상태 변경"
```

---

### Task 8: plan-panel.js — 컨텍스트메뉴

**Files:**
- Modify: `client/js/plan-panel.js`

- [ ] **Step 1: 컨텍스트메뉴 함수 추가**

```javascript
const ctxMenuEl = document.getElementById('plan-ctx-menu');
let ctxTargetPlanId = null;

function showPlanCtxMenu(x, y, planId) {
  ctxTargetPlanId = planId;
  if (!ctxMenuEl) return;
  ctxMenuEl.style.display = 'block';
  ctxMenuEl.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  ctxMenuEl.style.top = Math.min(y, window.innerHeight - 250) + 'px';
}

function hidePlanCtxMenu() {
  if (ctxMenuEl) ctxMenuEl.style.display = 'none';
  ctxTargetPlanId = null;
}

// Board card right-click
boardEl?.addEventListener('contextmenu', e => {
  const card = e.target.closest('.plan-board-card');
  if (!card) return;
  e.preventDefault();
  showPlanCtxMenu(e.clientX, e.clientY, card.dataset.id);
});

// Context menu action
ctxMenuEl?.addEventListener('click', async e => {
  const item = e.target.closest('.plan-ctx-item');
  if (!item || !ctxTargetPlanId) return;
  const action = item.dataset.action;

  if (action === 'edit') {
    selectPlan(ctxTargetPlanId);
    if (currentView === 'board') {
      // Show editor overlay in board view
      if (editorColEl) editorColEl.style.display = '';
    }
  } else if (action === 'status') {
    const newStatus = item.dataset.status;
    const plan = plans.find(p => p.id === ctxTargetPlanId);
    if (plan && plan.status !== newStatus) {
      plan.status = newStatus;
      plan.ai_done = false;
      renderBoard();
      updateCount();
      try {
        await apiFetch(`/api/plans/${ctxTargetPlanId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
      } catch (err) {
        console.error('[plan] status change failed:', err);
      }
    }
  } else if (action === 'delete') {
    deletePlan(ctxTargetPlanId);
  }
  hidePlanCtxMenu();
});

// Close ctx menu on click elsewhere
document.addEventListener('click', () => hidePlanCtxMenu());
```

- [ ] **Step 2: Board 카드 클릭 시 에디터 열기**

```javascript
boardEl?.addEventListener('click', e => {
  const card = e.target.closest('.plan-board-card');
  if (!card) return;
  flushSave();
  selectPlan(card.dataset.id);
  // Show editor panel alongside board
  if (editorColEl) editorColEl.style.display = '';
  loadPlanLogs(card.dataset.id);
});
```

- [ ] **Step 3: 커밋**

```bash
git add client/js/plan-panel.js
git commit -m "feat: 칸반 우클릭 컨텍스트메뉴 + 카드 클릭 에디터"
```

---

### Task 9: plan-panel.js — 로그 표시 + status 드롭다운

**Files:**
- Modify: `client/js/plan-panel.js`

- [ ] **Step 1: 로그 로드/렌더 함수 추가**

```javascript
async function loadPlanLogs(planId) {
  if (!logsListEl) return;
  try {
    const res = await apiFetch(`/api/plans/${planId}/logs`);
    const data = await res.json();
    if (!data.ok) { logsListEl.innerHTML = ''; return; }
    logsListEl.innerHTML = data.logs.map(log => {
      const icon = log.type === 'commit' ? '🔨' : '📝';
      const hash = log.commit_hash ? `<span class="plan-log-hash">${escHtml(log.commit_hash.slice(0, 7))}</span>` : '';
      const time = formatDate(new Date(log.created_at).getTime());
      return `<div class="plan-log-item">
        <span class="plan-log-icon">${icon}</span>
        <span class="plan-log-content">${escHtml(log.content)} ${hash}</span>
        <span class="plan-log-time">${time}</span>
      </div>`;
    }).join('');
  } catch {
    logsListEl.innerHTML = '';
  }
}
```

- [ ] **Step 2: selectPlan에서 status 드롭다운 + 로그 로드**

`selectPlan()` 함수에서 `catSelect.value = ...` 뒤에 추가:
```javascript
if (statusSelect) statusSelect.value = plan.status || 'todo';
loadPlanLogs(id);
```

- [ ] **Step 3: status 드롭다운 변경 이벤트**

`initPlanPanel()`에 추가:
```javascript
statusSelect?.addEventListener('change', async () => {
  if (!activeId) return;
  const plan = plans.find(p => p.id === activeId);
  if (!plan) return;
  const newStatus = statusSelect.value;
  plan.status = newStatus;
  plan.ai_done = false;
  updateCount();
  if (currentView === 'board') renderBoard();
  else renderList();
  try {
    await apiFetch(`/api/plans/${activeId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
  } catch (err) {
    console.error('[plan] status change failed:', err);
  }
});
```

- [ ] **Step 4: List 뷰 renderList에 status 뱃지 추가**

`renderList()`의 카드 HTML에 status 뱃지 추가:
```javascript
const statusLabel = STATUS_LABELS[p.status || 'todo'] || 'TODO';
// 기존 plan-item-cat 뒤에 추가:
`<span class="plan-item-status">${statusLabel}</span>`
```

- [ ] **Step 5: 커밋**

```bash
git add client/js/plan-panel.js
git commit -m "feat: 플랜 로그 표시, status 드롭다운, List 뷰 status 뱃지"
```

---

### Task 10: plan-panel.js — 토스트 알림 + WebSocket 수신

**Files:**
- Modify: `client/js/plan-panel.js`
- Modify: `client/js/main.js` (WebSocket 메시지 라우팅)

- [ ] **Step 1: 토스트 함수 추가 (plan-panel.js)**

```javascript
export function showPlanToast(planId, title, status) {
  if (!toastContainer) return;
  const statusLabel = STATUS_LABELS[status] || status;
  const toast = document.createElement('div');
  toast.className = 'plan-toast';
  toast.innerHTML = `
    <div class="plan-toast-title">${escHtml(title || 'Untitled')}</div>
    <div class="plan-toast-status">${statusLabel} ✅ AI 완료</div>
  `;
  toast.addEventListener('click', () => {
    openPlanModal().then(() => selectPlan(planId));
    toast.remove();
  });
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}
```

- [ ] **Step 2: main.js에서 plan_ai_done 메시지 라우팅**

`client/js/main.js`의 `handleMessage` 함수에 추가:
```javascript
} else if (msg.type === 'plan_ai_done') {
  showPlanToast(msg.planId, msg.planTitle, msg.planStatus);
}
```

main.js 상단 import에 `showPlanToast` 추가:
```javascript
import { initPlanPanel, handlePlanFileData, onPlanSessionChange, openPlanModal, closePlanModal, isPlanModalOpen, showPlanToast } from './plan-panel.js';
```

- [ ] **Step 3: 커밋**

```bash
git add client/js/plan-panel.js client/js/main.js
git commit -m "feat: AI 완료 토스트 알림 + WebSocket 수신"
```

---

### Task 11: Hook 스크립트 생성

**Files:**
- Create: `scripts/plan-commit-hook.sh`
- Create: `scripts/plan-done.sh`

- [ ] **Step 1: plan-commit-hook.sh 생성**

```bash
#!/bin/bash
# Claude Code PostToolUse hook: detect git commit and log to plan
# $TOOL_INPUT contains the executed command
echo "$TOOL_INPUT" | grep -q 'git commit' || exit 0

COMMIT_INFO=$(git log -1 --format='%H|||%s' 2>/dev/null) || exit 0
HASH=$(echo "$COMMIT_INFO" | cut -d'|' -f1)
# Use awk to get everything after '|||'
MSG=$(echo "$COMMIT_INFO" | sed 's/^[^|]*|||//')

TOKEN="${SUPER_TERMINAL_TOKEN}"
[ -z "$TOKEN" ] && exit 0

# Escape JSON special chars in commit message
MSG_ESCAPED=$(printf '%s' "$MSG" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

curl -s -X POST "${SUPER_TERMINAL_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"commit\",\"content\":$MSG_ESCAPED,\"commit_hash\":\"$HASH\"}" \
  >/dev/null 2>&1 &
```

- [ ] **Step 2: plan-done.sh 생성**

```bash
#!/bin/bash
# Manually trigger AI completion summary for the current DOING plan
SUMMARY="$*"
[ -z "$SUMMARY" ] && echo "Usage: plan-done <summary text>" && exit 1

TOKEN="${SUPER_TERMINAL_TOKEN}"
[ -z "$TOKEN" ] && echo "Error: SUPER_TERMINAL_TOKEN not set" && exit 1

SUMMARY_ESCAPED=$(printf '%s' "$SUMMARY" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')

curl -s -X POST "${SUPER_TERMINAL_URL:-http://localhost:3000}/api/plans/log" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"summary\",\"content\":$SUMMARY_ESCAPED}"

echo "✅ Plan summary logged"
```

- [ ] **Step 3: 실행 권한 부여**

```bash
chmod +x scripts/plan-commit-hook.sh scripts/plan-done.sh
```

- [ ] **Step 4: 커밋**

```bash
git add scripts/plan-commit-hook.sh scripts/plan-done.sh
git commit -m "feat: Claude Code hook 스크립트 - 커밋 로그 + AI 완료"
```

---

### Task 12: 빌드 확인 및 통합 테스트

- [ ] **Step 1: TypeScript 빌드 확인**

```bash
npx tsc --noEmit
```

- [ ] **Step 2: Supabase에 스키마 적용**

Supabase 대시보드 SQL Editor에서 schema.sql의 새 부분 실행:
- plans 테이블에 status, ai_done 컬럼 추가
- plan_logs 테이블 생성

- [ ] **Step 3: 수동 통합 테스트**

1. 서버 시작: `npm run dev`
2. 로그인 → Plans 모달 열기
3. Board 뷰 토글 확인
4. 새 플랜 생성 → 카드가 TODO 열에 표시
5. 카드 드래그 → DOING 열로 이동 확인
6. 우클릭 → 컨텍스트메뉴 표시 및 상태 변경 확인
7. 카드 클릭 → 에디터 + 로그 영역 표시
8. `scripts/plan-done.sh "테스트 요약"` → 토스트 표시 + AI 뱃지 확인
9. List 뷰로 전환 → status 뱃지 표시 확인

- [ ] **Step 4: 최종 커밋**

```bash
git add -A
git commit -m "feat: Plans 칸반 보드 + AI 작업 로그 통합 완료"
```
