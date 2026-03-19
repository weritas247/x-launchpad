# Plans Supabase 저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플랜 데이터를 localStorage에서 Supabase로 이전하여 로그인한 유저만 플랜 기능을 사용할 수 있게 한다.

**Architecture:** 서버에 `/api/plans` REST API를 추가하고, 클라이언트 `plan-panel.js`의 localStorage 로직을 API 호출로 교체한다. JWT 인증 미들웨어를 통해 유저별 데이터 격리를 보장한다.

**Tech Stack:** Supabase (PostgreSQL), Express REST API, JWT auth, Fetch API

---

## File Structure

- **Modify:** `server/supabase.ts` — plans CRUD 함수 추가
- **Modify:** `server/index.ts` — `/api/plans` REST 엔드포인트 추가
- **Modify:** `client/js/plan-panel.js` — localStorage → API 호출로 전면 교체
- **Modify:** `client/index.html` — 미로그인 시 플랜 버튼 숨김 처리 (JS에서)

---

### Task 1: Supabase plans CRUD 함수 추가

**Files:**
- Modify: `server/supabase.ts`

- [ ] **Step 1: `server/supabase.ts`에 PlanRow 인터페이스와 CRUD 함수 추가**

```typescript
export interface PlanRow {
  id: string;
  user_id: number;
  title: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
}

export async function getPlans(userId: number): Promise<PlanRow[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data || []) as PlanRow[];
}

export async function createPlan(userId: number, plan: { id: string; title: string; content: string; category: string }): Promise<PlanRow> {
  const { data, error } = await supabase
    .from('plans')
    .insert({ id: plan.id, user_id: userId, title: plan.title, content: plan.content, category: plan.category })
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export async function updatePlan(userId: number, planId: string, updates: { title?: string; content?: string; category?: string }): Promise<PlanRow> {
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

export async function deletePlan(userId: number, planId: string): Promise<void> {
  const { error } = await supabase
    .from('plans')
    .delete()
    .eq('id', planId)
    .eq('user_id', userId);
  if (error) throw error;
}
```

- [ ] **Step 2: 커밋**

```bash
git add server/supabase.ts
git commit -m "feat: add plans CRUD functions to supabase module"
```

---

### Task 2: 서버 REST API 엔드포인트 추가

**Files:**
- Modify: `server/index.ts` — `/api/plans` 엔드포인트 4개 추가

- [ ] **Step 1: `/api/plans` 엔드포인트 추가**

`server/index.ts`의 `app.get('/api/settings/default', ...)` 이후에 추가:

```typescript
// ─── PLANS API ───────────────────────────────────────────────────
app.get('/api/plans', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    const plans = await userDb.getPlans(payload.userId);
    res.json({ ok: true, plans });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/plans', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { id, title, content, category } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
  try {
    const plan = await userDb.createPlan(payload.userId, {
      id, title: title || '', content: content || '', category: category || 'other',
    });
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.put('/api/plans/:id', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const { title, content, category } = req.body || {};
  try {
    const plan = await userDb.updatePlan(payload.userId, req.params.id, { title, content, category });
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete('/api/plans/:id', async (req, res) => {
  const token = extractToken(req);
  const payload = getTokenPayload(token);
  if (!payload) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  try {
    await userDb.deletePlan(payload.userId, req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});
```

- [ ] **Step 2: 커밋**

```bash
git add server/index.ts
git commit -m "feat: add /api/plans REST endpoints with JWT auth"
```

---

### Task 3: 클라이언트 plan-panel.js를 API 기반으로 전면 교체

**Files:**
- Modify: `client/js/plan-panel.js`

- [ ] **Step 1: plan-panel.js 전면 재작성**

핵심 변경:
- `localStorage` 읽기/쓰기 → `apiFetch()` 호출
- `loadPlans()` → `async`, `GET /api/plans`
- `savePlans()` 제거 → 개별 API 호출 (create/update/delete)
- `scheduleSave()` → debounce 후 `PUT /api/plans/:id`
- `createPlan()` → `POST /api/plans`
- `deletePlan()` → `DELETE /api/plans/:id`
- 미로그인 시 모달 열기 차단

```javascript
// ─── PLAN MODAL: Evernote-style plan editor ─────────────────
import { escHtml } from './state.js';
import { apiFetch, getAuthToken } from './websocket.js';

const CATEGORIES = { feature: '기능', bug: '버그', other: '기타' };

// DOM refs
const overlay = document.getElementById('plan-overlay');
const listEl = document.getElementById('plan-list-items');
const editorArea = document.getElementById('plan-editor-area');
const editorEmpty = document.getElementById('plan-editor-empty');
const titleInput = document.getElementById('plan-editor-title');
const contentInput = document.getElementById('plan-editor-content');
const dateEl = document.getElementById('plan-editor-date');
const countEl = document.getElementById('sb-plan-count');
const catSelect = document.getElementById('plan-cat-select');
const catTabsEl = document.getElementById('plan-category-tabs');

let plans = [];
let activeId = null;
let activeCategory = 'all';
let saveTimer = null;

// ─── API ─────────────────────────────────────────────
async function loadPlans() {
  try {
    const res = await apiFetch('/api/plans');
    const data = await res.json();
    if (data.ok) {
      plans = data.plans.map(p => ({
        id: p.id,
        title: p.title || '',
        content: p.content || '',
        category: p.category || 'other',
        created: new Date(p.created_at).getTime(),
        updated: new Date(p.updated_at).getTime(),
      }));
    } else {
      plans = [];
    }
  } catch {
    plans = [];
  }
  updateCount();
}

async function apiCreatePlan(plan) {
  try {
    await apiFetch('/api/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: plan.id, title: plan.title, content: plan.content, category: plan.category }),
    });
  } catch (e) {
    console.error('[plan] create failed:', e);
  }
}

async function apiUpdatePlan(plan) {
  try {
    await apiFetch(`/api/plans/${plan.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: plan.title, content: plan.content, category: plan.category }),
    });
  } catch (e) {
    console.error('[plan] update failed:', e);
  }
}

async function apiDeletePlan(id) {
  try {
    await apiFetch(`/api/plans/${id}`, { method: 'DELETE' });
  } catch (e) {
    console.error('[plan] delete failed:', e);
  }
}

function updateCount() {
  if (countEl) countEl.textContent = plans.length;
  const allEl = document.getElementById('plan-count-all');
  const featEl = document.getElementById('plan-count-feature');
  const bugEl = document.getElementById('plan-count-bug');
  const otherEl = document.getElementById('plan-count-other');
  if (allEl) allEl.textContent = plans.length;
  if (featEl) featEl.textContent = plans.filter(p => p.category === 'feature').length;
  if (bugEl) bugEl.textContent = plans.filter(p => p.category === 'bug').length;
  if (otherEl) otherEl.textContent = plans.filter(p => p.category === 'other').length;
}

// ─── Filtered list ──────────────────────────────────
function filteredPlans() {
  if (activeCategory === 'all') return plans;
  return plans.filter(p => p.category === activeCategory);
}

// ─── CRUD ───────────────────────────────────────────
function createPlan() {
  const cat = activeCategory === 'all' ? 'feature' : activeCategory;
  const plan = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '',
    content: '',
    category: cat,
    created: Date.now(),
    updated: Date.now(),
  };
  plans.unshift(plan);
  updateCount();
  renderList();
  selectPlan(plan.id);
  titleInput.focus();
  apiCreatePlan(plan);
}

function deletePlan(id) {
  const filtered = filteredPlans();
  const idx = filtered.findIndex(p => p.id === id);
  plans = plans.filter(p => p.id !== id);
  updateCount();
  if (activeId === id) {
    const newFiltered = filteredPlans();
    if (newFiltered.length > 0) {
      const next = newFiltered[Math.min(idx, newFiltered.length - 1)];
      selectPlan(next.id);
    } else {
      activeId = null;
      showEmptyState();
    }
  }
  renderList();
  apiDeletePlan(id);
}

function selectPlan(id) {
  activeId = id;
  const plan = plans.find(p => p.id === id);
  if (!plan) { showEmptyState(); return; }

  editorEmpty.style.display = 'none';
  editorArea.style.display = 'flex';
  titleInput.value = plan.title;
  contentInput.value = plan.content;
  catSelect.value = plan.category || 'other';
  dateEl.textContent = formatDate(plan.updated);

  listEl.querySelectorAll('.plan-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

function showEmptyState() {
  editorArea.style.display = 'none';
  editorEmpty.style.display = 'flex';
}

// ─── Auto-save on input ─────────────────────────────
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 300);
}

function flushSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!activeId) return;
  const plan = plans.find(p => p.id === activeId);
  if (!plan) return;
  plan.title = titleInput.value;
  plan.content = contentInput.value;
  plan.category = catSelect.value;
  plan.updated = Date.now();
  updateCount();
  renderList();
  dateEl.textContent = formatDate(plan.updated);
  apiUpdatePlan(plan);
}

// ─── Category tabs ──────────────────────────────────
function switchCategory(cat) {
  activeCategory = cat;
  catTabsEl.querySelectorAll('.plan-cat-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.cat === cat);
  });
  renderList();
  const filtered = filteredPlans();
  if (activeId && filtered.find(p => p.id === activeId)) {
    selectPlan(activeId);
  } else if (filtered.length > 0) {
    selectPlan(filtered[0].id);
  } else {
    activeId = null;
    showEmptyState();
  }
}

// ─── Rendering ──────────────────────────────────────
function renderList() {
  if (!listEl) return;
  const filtered = filteredPlans();
  listEl.innerHTML = filtered.map(p => {
    const title = escHtml(p.title || 'Untitled');
    const preview = escHtml((p.content || '').slice(0, 80).replace(/\n/g, ' '));
    const date = formatDate(p.updated);
    const active = p.id === activeId ? ' active' : '';
    const catLabel = CATEGORIES[p.category] || '기타';
    return `<div class="plan-item${active}" data-id="${p.id}">
      <span class="plan-item-cat" data-cat="${p.category || 'other'}">${catLabel}</span>
      <div class="plan-item-title">${title}</div>
      <div class="plan-item-preview">${preview || 'No content'}</div>
      <div class="plan-item-date">${date}</div>
    </div>`;
  }).join('');
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

// ─── Auth check ─────────────────────────────────────
function isLoggedIn() {
  return !!getAuthToken();
}

// ─── Modal open/close ───────────────────────────────
export async function openPlanModal() {
  if (!isLoggedIn()) return;
  await loadPlans();
  if (activeId && !plans.find(p => p.id === activeId)) activeId = null;
  renderList();
  const filtered = filteredPlans();
  if (activeId && filtered.find(p => p.id === activeId)) {
    selectPlan(activeId);
  } else if (filtered.length > 0) {
    selectPlan(filtered[0].id);
  } else {
    showEmptyState();
  }
  overlay.classList.add('open');
}

export function closePlanModal() {
  flushSave();
  overlay.classList.remove('open');
}

export function isPlanModalOpen() {
  return overlay.classList.contains('open');
}

// ─── Init ───────────────────────────────────────────
export function initPlanPanel() {
  // Hide plan button if not logged in
  const sbPlan = document.getElementById('sb-plan');
  if (!isLoggedIn()) {
    if (sbPlan) sbPlan.style.display = 'none';
    return;
  }

  // Load count on init
  loadPlans().then(() => updateCount());

  // Statusbar click
  sbPlan?.addEventListener('click', openPlanModal);

  // Close button
  document.getElementById('plan-modal-close')?.addEventListener('click', closePlanModal);

  // Overlay click to close
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) closePlanModal();
  });

  // Category tab clicks
  catTabsEl?.addEventListener('click', e => {
    const tab = e.target.closest('.plan-cat-tab');
    if (tab) { flushSave(); switchCategory(tab.dataset.cat); }
  });

  // New plan
  document.getElementById('plan-btn-new')?.addEventListener('click', createPlan);

  // Delete plan
  document.getElementById('plan-btn-delete')?.addEventListener('click', () => {
    if (activeId) deletePlan(activeId);
  });

  // List click delegation
  listEl?.addEventListener('click', e => {
    const item = e.target.closest('.plan-item');
    if (item) { flushSave(); selectPlan(item.dataset.id); }
  });

  // Enter in title → focus content (keyup for IME/한글 compatibility)
  titleInput?.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) e.preventDefault();
  });
  titleInput?.addEventListener('keyup', e => {
    if (e.key === 'Enter' || e.keyCode === 13) contentInput.focus();
  });

  // Category change in editor
  catSelect?.addEventListener('change', () => {
    scheduleSave();
  });

  // Auto-save on input
  titleInput?.addEventListener('input', scheduleSave);
  contentInput?.addEventListener('input', scheduleSave);
}

// Backward compatibility exports (no-ops now)
export function handlePlanFileData() {}
export function onPlanSessionChange() {}
```

- [ ] **Step 2: 커밋**

```bash
git add client/js/plan-panel.js
git commit -m "feat: replace plan localStorage with Supabase API calls"
```

---

### Task 4: Supabase에 plans 테이블 생성

**Files:**
- 없음 (Supabase 대시보드 또는 SQL)

- [ ] **Step 1: Supabase SQL Editor에서 테이블 생성**

```sql
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_plans_user_id ON plans(user_id);
```

- [ ] **Step 2: 확인**

테이블 생성 후 서버 재시작, 로그인 상태에서 플랜 생성/수정/삭제 동작 확인.

---

### Task 5: 활동 바 플랜 버튼 미로그인 시 숨김

**Files:**
- Modify: `client/js/plan-panel.js` (이미 Task 3에서 sb-plan 숨김 처리됨)
- Modify: `client/js/activity-bar.js` (필요 시)

- [ ] **Step 1: activity-bar의 plan 버튼도 미로그인 시 숨김**

`plan-panel.js`의 `initPlanPanel()`에서 이미 `sb-plan`을 숨기고 있으므로, activity-bar의 plan 버튼도 함께 숨긴다:

```javascript
// initPlanPanel() 내, isLoggedIn() 체크 블록에 추가:
const activityPlanBtn = document.querySelector('.activity-btn[data-panel="plan"]');
if (activityPlanBtn) activityPlanBtn.style.display = 'none';
const bnavPlanBtn = document.querySelector('.bnav-btn[data-panel="plan"]');
if (bnavPlanBtn) bnavPlanBtn.style.display = 'none';
```

- [ ] **Step 2: 커밋**

```bash
git add client/js/plan-panel.js
git commit -m "feat: hide plan buttons when not logged in"
```

---

### Task 6: 서버 빌드 및 통합 테스트

- [ ] **Step 1: TypeScript 빌드 확인**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal && npx tsc --noEmit
```

- [ ] **Step 2: 서버 시작 후 수동 테스트**

```bash
npm run dev
```

로그인 → 플랜 생성 → 수정 → 삭제 → 새로고침해도 데이터 유지 확인.
미로그인 상태에서 플랜 버튼 안 보이는지 확인.

- [ ] **Step 3: 최종 커밋**

```bash
git add -A
git commit -m "feat: plans supabase integration complete"
```
