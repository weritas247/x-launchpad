# 칸반 Headless AI 실행 기능 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 칸반 카드에서 `claude -p` headless 모드로 AI를 백그라운드 실행하고, 결과를 카드에 append하는 기능 구현

**Architecture:** 서버에서 `child_process.spawn`으로 `claude -p`를 실행하고 stdout을 수집. 클라이언트는 headless 체크박스 UI + WebSocket 이벤트로 상태 추적. 기존 AI 할당 흐름(`assignAiToplan`)에서 `use_headless` 플래그로 분기.

**Tech Stack:** Node.js child_process, Express REST, WebSocket, Supabase, Vanilla JS

**Spec:** `docs/superpowers/specs/2026-03-20-kanban-headless-ai-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/supabase.ts` | PlanRow에 `use_headless` 추가, getPlan 함수, updatePlan에 `use_headless` 포함 |
| Create | `server/handlers/headless.ts` | headless 작업 spawn, 추적, 취소, WebSocket 이벤트 |
| Modify | `server/routes/plans.ts` | headless 시작/취소 REST endpoints 추가 |
| Modify | `server/index.ts:700-702` | WebSocket 연결 시 headless_sync 전송 |
| Modify | `client/js/sidebar/plan-panel.js` | headless 체크박스, AI 할당 분기, 이벤트 핸들러 |
| Modify | `client/js/core/main.js` | headless WebSocket 이벤트 핸들러 |
| Modify | `client/styles.css` | headless 체크박스 및 취소 버튼 스타일 |

---

### Task 1: DB & 서버 데이터 모델 + getPlan

**Files:**
- Modify: `server/supabase.ts:75-86` (PlanRow interface)
- Modify: `server/supabase.ts:88-96` (getPlans 아래에 getPlan 추가)
- Modify: `server/supabase.ts:118-131` (updatePlan)

- [ ] **Step 1: PlanRow 인터페이스에 `use_headless` 추가**

`server/supabase.ts:75-86` — PlanRow에 필드 추가:
```typescript
export interface PlanRow {
  id: string;
  user_id: number;
  title: string;
  content: string;
  category: string;
  status: string;
  ai_done: boolean;
  use_worktree: boolean;
  use_headless: boolean;  // 추가
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: getPlan 단건 조회 함수 추가**

`server/supabase.ts` — `getPlans` 함수(88-96) 바로 아래에 추가:
```typescript
export async function getPlan(userId: number, planId: string): Promise<PlanRow | null> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data as PlanRow | null;
}
```

- [ ] **Step 3: updatePlan 시그니처에 `use_headless` 추가**

`server/supabase.ts:121` (getPlans/getPlan 추가로 인해 줄번호 이동됨) — updates 파라미터에 추가:
```typescript
export async function updatePlan(
  userId: number,
  planId: string,
  updates: { title?: string; content?: string; category?: string; status?: string; use_worktree?: boolean; use_headless?: boolean }
): Promise<PlanRow> {
```

- [ ] **Step 4: plans.ts PUT 핸들러에 `use_headless` 추가**

`server/routes/plans.ts:63` — destructuring에 추가:
```typescript
const { title, content, category, status, use_worktree, use_headless } = req.body || {};
```

`server/routes/plans.ts:65-71` — updatePlan 호출에 추가:
```typescript
const plan = await userDb.updatePlan(payload.userId, req.params.id, {
  title,
  content,
  category,
  status,
  use_worktree,
  use_headless,
});
```

- [ ] **Step 5: Supabase에 컬럼 추가**

Supabase 대시보드 또는 SQL 에디터에서 실행:
```sql
ALTER TABLE plans ADD COLUMN IF NOT EXISTS use_headless boolean DEFAULT false;
```

- [ ] **Step 6: 커밋**

```bash
git add server/supabase.ts server/routes/plans.ts
git commit -m "feat: plans 테이블에 use_headless 컬럼, getPlan 함수, 서버 모델 추가"
```

---

### Task 2: Headless 핸들러 (서버)

**Files:**
- Create: `server/handlers/headless.ts`

**주의:** 이 태스크는 Task 1의 `getPlan` 함수에 의존합니다.

- [ ] **Step 1: headless.ts 생성 — 전체 파일**

`server/handlers/headless.ts` 생성:
```typescript
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import * as userDb from '../supabase';

const TIMEOUT_MS = 10 * 60 * 1000; // 10분
const MAX_STDOUT = 1024 * 1024;     // 1MB
const MAX_CONCURRENT_PER_USER = 3;

interface HeadlessJob {
  planId: string;
  userId: number;
  sessionId: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  status: 'running' | 'done' | 'failed';
  timer: ReturnType<typeof setTimeout>;
}

export const headlessJobs = new Map<string, HeadlessJob>();

function broadcast(wss: WebSocketServer, msg: object) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

export async function startHeadless(
  wss: WebSocketServer,
  userId: number,
  planId: string,
  prompt: string,
  options: { useWorktree?: boolean; category?: string; cwd?: string }
): Promise<{ sessionId: string }> {
  // 동시 실행 제한
  const userJobs = [...headlessJobs.values()].filter(
    (j) => j.userId === userId && j.status === 'running'
  );
  if (userJobs.length >= MAX_CONCURRENT_PER_USER) {
    throw new Error('Too many concurrent headless jobs');
  }

  const sessionId = randomUUID();
  const args = ['-p', '--session-id', sessionId, '--output-format', 'json', '--dangerously-skip-permissions'];

  // 워크트리 조합
  if (options.useWorktree) {
    const prefix = options.category === 'bug' ? 'fix' : 'feat';
    const randomWord = Math.random().toString(36).slice(2, 8);
    args.push('-w', `${prefix}/claude-${randomWord}`);
  }

  const proc = spawn('claude', args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, X_LAUNCHPAD_PLAN_ID: planId },
  });

  // stdin으로 prompt 전달 (에러 핸들링 포함)
  proc.stdin.on('error', (err) => {
    console.error('[headless] stdin error:', err.message);
  });
  proc.stdin.write(prompt);
  proc.stdin.end();

  const job: HeadlessJob = {
    planId,
    userId,
    sessionId,
    process: proc,
    stdout: '',
    stderr: '',
    status: 'running',
    timer: setTimeout(() => {
      if (job.status === 'running') {
        proc.kill();
        job.status = 'failed';
        broadcast(wss, { type: 'headless_failed', planId, sessionId, error: 'Timeout (10m)' });
        headlessJobs.delete(sessionId);
      }
    }, TIMEOUT_MS),
  };
  headlessJobs.set(sessionId, job);

  // stdout 수집
  proc.stdout.on('data', (chunk: Buffer) => {
    job.stdout += chunk.toString();
    if (job.stdout.length > MAX_STDOUT) {
      proc.kill();
      job.status = 'failed';
      broadcast(wss, { type: 'headless_failed', planId, sessionId, error: 'Output too large (>1MB)' });
      clearTimeout(job.timer);
      headlessJobs.delete(sessionId);
    }
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    job.stderr += chunk.toString();
  });

  // 프로세스 종료 처리
  proc.on('close', async (code) => {
    clearTimeout(job.timer);
    if (job.status !== 'running') return; // 이미 처리됨 (timeout/kill/cancel)

    if (code === 0) {
      job.status = 'done';
      // JSON 파싱 → 텍스트 추출
      let resultText = job.stdout;
      try {
        const parsed = JSON.parse(job.stdout);
        resultText = parsed.result || parsed.content || parsed.text || job.stdout;
      } catch {
        // JSON 파싱 실패 시 raw stdout 사용
      }

      // 카드 content에 append
      try {
        const plan = await userDb.getPlan(userId, planId);
        if (plan) {
          const newContent = (plan.content || '') + '\n\n---\n**AI 결과 (headless):**\n' + resultText;
          await userDb.updatePlan(userId, planId, { content: newContent });
          await userDb.updatePlanStatus(userId, planId, 'done');
        }
      } catch (err) {
        console.error('[headless] failed to update plan:', err);
      }

      broadcast(wss, { type: 'headless_done', planId, sessionId, result: resultText });
    } else {
      job.status = 'failed';
      broadcast(wss, { type: 'headless_failed', planId, sessionId, error: job.stderr || `Exit code ${code}` });
    }
    headlessJobs.delete(sessionId);
  });

  // 시작 이벤트
  broadcast(wss, { type: 'headless_started', planId, sessionId });

  return { sessionId };
}

export function cancelHeadless(sessionId: string): boolean {
  const job = headlessJobs.get(sessionId);
  if (!job || job.status !== 'running') return false;
  job.process.kill();
  job.status = 'failed';
  clearTimeout(job.timer);
  headlessJobs.delete(sessionId);
  return true;
}

export function getRunningJobs(userId: number) {
  return [...headlessJobs.values()]
    .filter((j) => j.userId === userId && j.status === 'running')
    .map((j) => ({ planId: j.planId, sessionId: j.sessionId }));
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/handlers/headless.ts
git commit -m "feat: headless AI 핸들러 - spawn, 취소, 동기화"
```

---

### Task 3: REST Endpoints 추가

**Files:**
- Modify: `server/routes/plans.ts`

- [ ] **Step 1: headless import 추가**

`server/routes/plans.ts` 상단 import에 추가:
```typescript
import { startHeadless, cancelHeadless } from '../handlers/headless';
```

- [ ] **Step 2: POST /:id/headless 및 DELETE /:id/headless/:sessionId endpoint 추가**

`server/routes/plans.ts` — Plan Images 라우트(line 147) 앞에 추가:
```typescript
  // ─── Headless AI ─────────────────────────────────────────────────

  router.post('/:id/headless', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const planId = req.params.id;
    const { prompt, useWorktree, category, cwd } = req.body || {};
    if (!prompt) return res.status(400).json({ ok: false, error: 'Missing prompt' });
    try {
      const result = await startHeadless(wss, payload.userId, planId, prompt, {
        useWorktree,
        category,
        cwd,
      });
      res.json({ ok: true, sessionId: result.sessionId });
    } catch (e: any) {
      const status = e.message === 'Too many concurrent headless jobs' ? 429 : 500;
      res.status(status).json({ ok: false, error: String(e) });
    }
  });

  router.delete('/:id/headless/:sessionId', async (req, res) => {
    const payload = requireAuth(req, res);
    if (!payload) return;
    const ok = cancelHeadless(req.params.sessionId);
    if (ok) {
      const msg = JSON.stringify({
        type: 'headless_failed',
        planId: req.params.id,
        sessionId: req.params.sessionId,
        error: 'Cancelled by user',
      });
      wss.clients.forEach((c) => {
        if (c.readyState === WebSocket.OPEN) c.send(msg);
      });
    }
    res.json({ ok });
  });
```

- [ ] **Step 3: 커밋**

```bash
git add server/routes/plans.ts
git commit -m "feat: headless 시작/취소 REST endpoints"
```

---

### Task 4: WebSocket 재접속 시 headless_sync 전송

**Files:**
- Modify: `server/index.ts:700-702`

- [ ] **Step 1: headless import 추가**

`server/index.ts` 상단 import에 추가:
```typescript
import { getRunningJobs } from './handlers/headless';
```

- [ ] **Step 2: WebSocket connection 핸들러에 headless_sync 전송 추가**

`server/index.ts:702` — `wsSend(ws, JSON.stringify({ type: 'settings', settings: currentSettings }));` 바로 아래에 추가:

```typescript
  // Send running headless jobs for reconnect sync
  if (isAuthEnabled()) {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';
    const tokenPayload = getTokenPayload(token);
    if (tokenPayload) {
      const jobs = getRunningJobs(tokenPayload.userId);
      if (jobs.length > 0) {
        wsSend(ws, JSON.stringify({ type: 'headless_sync', jobs }));
      }
    }
  }
```

- [ ] **Step 3: 커밋**

```bash
git add server/index.ts
git commit -m "feat: WebSocket 재접속 시 headless_sync 전송"
```

---

### Task 5: 클라이언트 UI — Headless 체크박스

**Files:**
- Modify: `client/js/sidebar/plan-panel.js:59-69` (loadPlans 매핑)
- Modify: `client/js/sidebar/plan-panel.js:140-150` (createPlan 초기화)
- Modify: `client/js/sidebar/plan-panel.js:358-365` (카드 렌더링)
- Modify: `client/js/sidebar/plan-panel.js:791-804` (AI badge 클릭 캡처)
- Modify: `client/js/sidebar/plan-panel.js:806-823` (체크박스 이벤트)
- Modify: `client/js/sidebar/plan-panel.js:830` (클릭 skip)
- Modify: `client/styles.css:8119` (스타일)

- [ ] **Step 1: loadPlans에 `use_headless` 매핑 추가**

`client/js/sidebar/plan-panel.js:66` — `use_worktree` 아래에 추가:
```javascript
        use_headless: p.use_headless || false,
```

전체 매핑 (59-69):
```javascript
      plans = data.plans.map((p) => ({
        id: p.id,
        title: p.title || '',
        content: p.content || '',
        category: p.category || 'other',
        status: p.status || 'todo',
        ai_done: p.ai_done || false,
        use_worktree: p.use_worktree || false,
        use_headless: p.use_headless || false,
        created: new Date(p.created_at).getTime(),
        updated: new Date(p.updated_at).getTime(),
      }));
```

- [ ] **Step 2: createPlan에 `use_headless` 초기값 추가**

`client/js/sidebar/plan-panel.js:147` — `use_worktree: false,` 아래에 추가:
```javascript
    use_headless: false,
```

- [ ] **Step 3: 카드 footer에 headless 체크박스 추가**

`client/js/sidebar/plan-panel.js:358` — `wtChecked` 선언 아래에 추가:
```javascript
        const hlChecked = p.use_headless ? ' checked' : '';
```

`client/js/sidebar/plan-panel.js:365` — 워크트리 label 뒤에 headless label 추가. 기존 줄:
```javascript
            <label class="plan-board-card-wt" title="워크트리 모드 (-w)"><input type="checkbox" class="plan-wt-check" data-id="${p.id}"${wtChecked}><span class="plan-wt-icon">🌿</span></label>
```
교체:
```javascript
            <label class="plan-board-card-wt" title="워크트리 모드 (-w)"><input type="checkbox" class="plan-wt-check" data-id="${p.id}"${wtChecked}><span class="plan-wt-icon">🌿</span></label>
            <label class="plan-board-card-hl" title="헤드리스 모드 (-p)"><input type="checkbox" class="plan-headless-check" data-id="${p.id}"${hlChecked}><span class="plan-headless-icon">⚡</span></label>
```

- [ ] **Step 4: headless 체크박스 이벤트 리스너 추가**

`client/js/sidebar/plan-panel.js` — 워크트리 체크박스 이벤트(807-823) 바로 아래에 추가:
```javascript
  // Headless checkbox toggle
  boardEl?.addEventListener('change', async (e) => {
    const cb = e.target.closest('.plan-headless-check');
    if (!cb) return;
    const planId = cb.dataset.id;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    plan.use_headless = cb.checked;
    try {
      await apiFetch(`/api/plans/${planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: plan.title, content: plan.content, category: plan.category, use_headless: plan.use_headless }),
      });
    } catch (err) {
      console.error('[plan] headless toggle failed:', err);
    }
  });
```

- [ ] **Step 5: 카드 클릭 시 headless 체크박스 skip 추가**

`client/js/sidebar/plan-panel.js:830` — 기존:
```javascript
    if (e.target.closest('.plan-board-card-wt') || e.target.closest('.plan-wt-check')) return;
```
교체:
```javascript
    if (e.target.closest('.plan-board-card-wt') || e.target.closest('.plan-wt-check') || e.target.closest('.plan-board-card-hl') || e.target.closest('.plan-headless-check')) return;
```

**참고:** line 832의 AI session badge skip (`if (e.target.closest('.plan-board-card-ai-session')) return;`)은 그대로 유지.

- [ ] **Step 6: CSS 스타일 추가**

`client/styles.css` — `.plan-wt-icon` 스타일(8116-8119) 아래에 추가:
```css
.plan-board-card-hl {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    cursor: pointer;
    opacity: 0.5;
    transition: opacity 0.15s;
    user-select: none;
}
.plan-board-card-hl:has(.plan-headless-check:checked) {
    opacity: 1;
}
.plan-headless-check {
    width: 12px;
    height: 12px;
    margin: 0;
    cursor: pointer;
    accent-color: #ff9800;
}
.plan-headless-icon {
    font-size: 10px;
    line-height: 1;
}
```

- [ ] **Step 7: 커밋**

```bash
git add client/js/sidebar/plan-panel.js client/styles.css
git commit -m "feat: 칸반 카드 headless 체크박스(⚡) UI 및 loadPlans 매핑"
```

---

### Task 6: 클라이언트 — AI 할당 분기 및 이벤트 핸들러

**Files:**
- Modify: `client/js/sidebar/plan-panel.js:940` (headlessJobs Map)
- Modify: `client/js/sidebar/plan-panel.js:944-988` (assignAiToplan)
- Modify: `client/js/sidebar/plan-panel.js:1038` (onAiPromptSent 아래 — 이벤트 핸들러 추가)
- Modify: `client/js/sidebar/plan-panel.js:1047-1073` (getActiveAiTasks)
- Modify: `client/js/sidebar/plan-panel.js:1089-1113` (renderAiDashboard)
- Modify: `client/js/sidebar/plan-panel.js:1131-1146` (aiDashBody 이벤트)
- Modify: `client/js/sidebar/plan-panel.js:792-804` (AI badge 클릭 — 캡처 페이즈)

- [ ] **Step 1: headless 작업 추적용 Map 추가**

`client/js/sidebar/plan-panel.js` — `pendingAiSessions` 선언(940) 아래에 추가:
```javascript
// Map: sessionId → { planId, ai, status } — headless 작업 추적
const headlessJobs = new Map();
```

- [ ] **Step 2: `assignAiToplan`에 headless 분기 추가**

`client/js/sidebar/plan-panel.js:965-987` — 기존 코드(cwd 추출부터 `_pendingAiAssign` 설정까지)를 다음으로 교체:

```javascript
  // Get current cwd from active session
  const meta = S.activeSessionId ? sessionMeta.get(S.activeSessionId) : null;
  const cwd = meta?.cwd || undefined;

  if (plan.use_headless && aiType === 'claude') {
    // Headless mode: POST to server, no terminal session
    try {
      const res = await apiFetch(`/api/plans/${planId}/headless`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          useWorktree: plan.use_worktree,
          category: plan.category,
          cwd,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      // headless_started WebSocket event will handle UI updates
    } catch (err) {
      console.error('[plan] headless start failed:', err);
    }
    return;
  }

  // Interactive mode (existing flow)
  const reg = AI_REGISTRY[aiType] || {};
  let cmd = reg.cmd || aiType;
  if (plan.use_worktree && aiType === 'claude') {
    const prefix = plan.category === 'bug' ? 'fix' : 'feat';
    const randomWord = Math.random().toString(36).slice(2, 8);
    cmd += ` -w ${prefix}/claude-${randomWord}`;
  }
  wsSend({
    type: 'session_create',
    name: `${aiType}:${title.slice(0, 20)}`,
    cmd,
    cwd,
    planId,
  });
  _pendingAiAssign = { planId, aiType, prompt };
```

- [ ] **Step 3: headless WebSocket 이벤트 핸들러 export 함수 추가**

`client/js/sidebar/plan-panel.js` — `onAiPromptSent` 함수(1012-1038) 아래에 추가:

```javascript
// Called from main.js when headless_started arrives
export function onHeadlessStarted({ planId, sessionId }) {
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return;

  // ai_sessions에 추가 (mode: headless)
  if (!plan.ai_sessions) plan.ai_sessions = [];
  plan.ai_sessions.push({ sessionId, ai: 'claude', mode: 'headless' });

  // headless 추적
  headlessJobs.set(sessionId, { planId, ai: 'claude', status: 'running' });

  // DOING으로 이동
  if (plan.status !== 'doing') {
    plan.status = 'doing';
    apiFetch(`/api/plans/${planId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'doing' }),
    }).catch((err) => console.error('[plan] status change failed:', err));
  }

  renderBoard();
  updateCount();
  updateAiTasksBadge();
}

// Called from main.js when headless_done arrives
export function onHeadlessDone({ planId, sessionId, result }) {
  headlessJobs.delete(sessionId);

  const plan = plans.find((p) => p.id === planId);
  if (plan) {
    plan.ai_done = true;
    plan.status = 'done';
    // content append (서버에서도 저장하지만 로컬 상태도 업데이트)
    plan.content = (plan.content || '') + '\n\n---\n**AI 결과 (headless):**\n' + result;
    if (currentView === 'board') renderBoard();
    else renderList();
  }

  updateCount();
  updateAiTasksBadge();
  // 기존 showPlanToast 패턴과 동일한 토스트 (plan-panel.js:598-625 참조)
  if (toastContainer) {
    const toast = document.createElement('div');
    toast.className = 'plan-toast';
    toast.innerHTML = `
      <div class="plan-toast-title">${escHtml(plan?.title || 'Untitled')}</div>
      <div class="plan-toast-status">⚡ Headless AI 완료</div>
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
}

// Called from main.js when headless_failed arrives
export function onHeadlessFailed({ planId, sessionId, error }) {
  headlessJobs.delete(sessionId);

  renderBoard();
  updateCount();
  updateAiTasksBadge();
  if (toastContainer) {
    const toast = document.createElement('div');
    toast.className = 'plan-toast';
    toast.innerHTML = `
      <div class="plan-toast-title">Headless AI 실패</div>
      <div class="plan-toast-status">❌ ${escHtml(error)}</div>
    `;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }
}

// Called from main.js on reconnect — sync running headless jobs
export function onHeadlessSync(jobs) {
  headlessJobs.clear();
  for (const j of jobs) {
    headlessJobs.set(j.sessionId, { planId: j.planId, ai: 'claude', status: 'running' });
  }
  updateAiTasksBadge();
}
```

- [ ] **Step 4: `getActiveAiTasks`에 headless 작업 포함**

`client/js/sidebar/plan-panel.js` — `getActiveAiTasks` 함수 내, `pendingAiSessions` 루프(1062-1071) 아래에 추가:

```javascript
  // Include running headless jobs
  for (const [sessionId, info] of headlessJobs) {
    tasks.push({
      planId: info.planId,
      planTitle: plans.find((p) => p.id === info.planId)?.title || 'Untitled',
      planStatus: 'doing',
      sessionId,
      ai: info.ai,
      mode: 'headless',
    });
  }
```

- [ ] **Step 5: AI Tasks 모달 렌더링에 headless 구분 표시**

`client/js/sidebar/plan-panel.js` — `renderAiDashboard` 함수 내(1089-1113). 기존 `statusCls`/`statusText` 계산을 교체:

기존:
```javascript
      const statusCls = t.pending ? ' pending' : '';
      const statusText = t.pending
        ? '대기중…'
        : t.planStatus === 'done'
          ? '✅ 완료'
          : t.planStatus === 'doing'
            ? '작업중'
            : t.planStatus || '—';
```
교체:
```javascript
      const isHeadless = t.mode === 'headless';
      const statusCls = t.pending ? ' pending' : isHeadless ? ' headless' : '';
      const statusText = t.pending
        ? '대기중…'
        : isHeadless
          ? '⚡ 실행중'
          : t.planStatus === 'done'
            ? '✅ 완료'
            : t.planStatus === 'doing'
              ? '작업중'
              : t.planStatus || '—';
```

같은 함수 내, 이동 버튼 부분을 교체. 기존:
```javascript
      ${sid ? `<button class="ai-dash-card-go" data-sid="${escHtml(sid)}">이동 →</button>` : ''}
```
교체:
```javascript
      ${isHeadless
        ? `<button class="ai-dash-card-cancel" data-plan-id="${escHtml(t.planId)}" data-sid="${escHtml(sid)}">취소</button>`
        : sid ? `<button class="ai-dash-card-go" data-sid="${escHtml(sid)}">이동 →</button>` : ''}
```

- [ ] **Step 6: AI Tasks 모달 취소 버튼 이벤트**

`client/js/sidebar/plan-panel.js` — `aiDashBody` 이벤트 리스너(1131). 기존 `goBtn` 체크 앞에 추가:

```javascript
  const cancelBtn = e.target.closest('.ai-dash-card-cancel');
  if (cancelBtn) {
    const planId = cancelBtn.dataset.planId;
    const sid = cancelBtn.dataset.sid;
    apiFetch(`/api/plans/${planId}/headless/${sid}`, { method: 'DELETE' })
      .catch((err) => console.error('[plan] headless cancel failed:', err));
    return;
  }
```

- [ ] **Step 7: AI 세션 뱃지 클릭 시 headless 분기 (캡처 페이즈 리스너)**

`client/js/sidebar/plan-panel.js:792-804` — 기존 캡처 페이즈 리스너를 수정:

기존:
```javascript
  boardEl?.addEventListener(
    'click',
    (e) => {
      const badge = e.target.closest('.plan-board-card-ai-session');
      if (badge) {
        e.stopPropagation();
        const sid = badge.dataset.sessionId;
        if (sid) activateSession(sid);
        return;
      }
    },
    true
  );
```
교체:
```javascript
  boardEl?.addEventListener(
    'click',
    (e) => {
      const badge = e.target.closest('.plan-board-card-ai-session');
      if (badge) {
        e.stopPropagation();
        const sid = badge.dataset.sessionId;
        // headless 세션은 탭 전환 안 함
        if (sid && headlessJobs.has(sid)) return;
        if (sid) activateSession(sid);
        return;
      }
    },
    true
  );
```

- [ ] **Step 8: 커밋**

```bash
git add client/js/sidebar/plan-panel.js
git commit -m "feat: headless AI 할당 분기, 이벤트 핸들러, AI Tasks 모달"
```

---

### Task 7: main.js WebSocket 이벤트 핸들러

**Files:**
- Modify: `client/js/core/main.js` (import + WebSocket 핸들러)

- [ ] **Step 1: import에 headless 함수 추가**

`client/js/core/main.js` — 기존 plan-panel import에 headless 함수 추가. 기존에 `onAiSessionCreated`, `onAiSessionReady`, `onAiPromptSent` 등을 import하는 라인을 찾아서 추가:

```javascript
import { onHeadlessStarted, onHeadlessDone, onHeadlessFailed, onHeadlessSync } from '../sidebar/plan-panel.js';
```

(기존 plan-panel import가 하나의 import 문이면 거기에 병합)

- [ ] **Step 2: WebSocket 메시지 핸들러에 headless 이벤트 추가**

`client/js/core/main.js` — `msg.type === 'ai_prompt_sent'` 핸들러(line 191-192) 바로 아래에 추가:

```javascript
  } else if (msg.type === 'headless_started') {
    onHeadlessStarted(msg);
  } else if (msg.type === 'headless_done') {
    onHeadlessDone(msg);
  } else if (msg.type === 'headless_failed') {
    onHeadlessFailed(msg);
  } else if (msg.type === 'headless_sync') {
    onHeadlessSync(msg.jobs);
```

- [ ] **Step 3: 커밋**

```bash
git add client/js/core/main.js
git commit -m "feat: main.js headless WebSocket 이벤트 라우팅"
```

---

### Task 8: AI Tasks 모달 취소 버튼 스타일

**Files:**
- Modify: `client/styles.css`

- [ ] **Step 1: 취소 버튼 및 headless 상태 스타일 추가**

`client/styles.css` — `.plan-headless-icon` 스타일(Task 5에서 추가한 것) 아래에 추가:
```css
.ai-dash-card-cancel {
    background: #ff5252;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    opacity: 0.8;
    transition: opacity 0.15s;
}
.ai-dash-card-cancel:hover {
    opacity: 1;
}
.ai-dash-card-status.headless {
    color: #ff9800;
}
```

- [ ] **Step 2: 커밋**

```bash
git add client/styles.css
git commit -m "feat: headless 취소 버튼 및 상태 스타일"
```

---

### Task 9: 수동 통합 테스트

- [ ] **Step 1: 서버 시작**

```bash
npm run dev
```

- [ ] **Step 2: 칸반에서 카드 생성 → ⚡ 체크박스 체크 → AI 할당 (Claude)**

확인사항:
- ⚡ 체크박스가 🌿 옆에 표시되는지
- 체크 상태가 서버에 저장되는지 (새로고침 후 유지)
- AI 할당 시 터미널 세션 대신 headless 요청이 가는지

- [ ] **Step 3: AI Tasks 모달에서 headless 작업 확인**

확인사항:
- ⚡ 실행중 상태 표시
- 세션 ID 표시
- 취소 버튼 동작

- [ ] **Step 4: 완료 후 카드 확인**

확인사항:
- 카드 content에 AI 결과가 append 되었는지
- 카드 상태가 DONE으로 이동했는지
- AI 세션 뱃지에 세션 ID 표시
- headless 세션 뱃지 클릭 시 탭 전환 안 됨
