// ─── PLAN MODAL: Evernote-style plan editor ─────────────────
import { escHtml, S, sessionMeta } from '../core/state.js';
import { apiFetch, getAuthToken, wsSend } from '../core/websocket.js';
import { AI_REGISTRY } from '../core/constants.js';
import { activateSession } from '../terminal/session.js';

const CATEGORIES = { feature: '기능', bug: '버그', other: '기타' };

// DOM refs
const overlay = document.getElementById('plan-overlay');
const listEl = document.getElementById('plan-list-items');
const editorArea = document.getElementById('plan-editor-area');
const editorEmpty = document.getElementById('plan-editor-empty');
const titleInput = document.getElementById('plan-editor-title');
const contentInput = document.getElementById('plan-editor-content');
const dateEl = document.getElementById('plan-editor-date');
const todoCountEl = document.getElementById('sb-plan-todo');
const doingCountEl = document.getElementById('sb-plan-doing');
const catSelect = document.getElementById('plan-cat-select');
const catTabsEl = document.getElementById('plan-category-tabs');

const boardEl = document.getElementById('plan-board');
const boardDivider = document.getElementById('plan-board-divider');
const listColEl = document.getElementById('plan-list-col');
const editorColEl = document.getElementById('plan-editor-col');
const viewToggleEl = document.getElementById('plan-view-toggle');
const statusSelect = document.getElementById('plan-status-select');
const logsListEl = document.getElementById('plan-logs-list');
const toastContainer = document.getElementById('plan-toast-container');
const ctxMenuEl = document.getElementById('plan-ctx-menu');
const imagesGridEl = document.getElementById('plan-images-grid');
const lightboxEl = document.getElementById('plan-lightbox');
const lightboxImg = document.getElementById('plan-lightbox-img');
const lightboxClose = document.getElementById('plan-lightbox-close');

let plans = [];
let activeId = null;
let activeCategory = 'all';
let saveTimer = null;
let currentView = localStorage.getItem('plan-view') || 'list';
let ctxTargetPlanId = null;
let collapsedCols = JSON.parse(localStorage.getItem('plan-collapsed-cols') || '[]');

const STATUSES = ['todo', 'doing', 'done', 'on_hold', 'cancelled'];
const STATUS_LABELS = {
  todo: 'TODO',
  doing: 'DOING',
  done: 'DONE',
  on_hold: 'ON HOLD',
  cancelled: 'CANCELLED',
};

// ─── API ─────────────────────────────────────────────
async function loadPlans() {
  try {
    const res = await apiFetch('/api/plans');
    const data = await res.json();
    if (data.ok) {
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
      body: JSON.stringify({
        id: plan.id,
        title: plan.title,
        content: plan.content,
        category: plan.category,
      }),
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
  const todoCount = plans.filter((p) => (p.status || 'todo') === 'todo').length;
  const doingCount = plans.filter((p) => p.status === 'doing').length;
  if (todoCountEl) todoCountEl.textContent = todoCount;
  if (doingCountEl) doingCountEl.textContent = doingCount;
  const allEl = document.getElementById('plan-count-all');
  const featEl = document.getElementById('plan-count-feature');
  const bugEl = document.getElementById('plan-count-bug');
  const otherEl = document.getElementById('plan-count-other');
  if (allEl) allEl.textContent = plans.length;
  if (featEl) featEl.textContent = plans.filter((p) => p.category === 'feature').length;
  if (bugEl) bugEl.textContent = plans.filter((p) => p.category === 'bug').length;
  if (otherEl) otherEl.textContent = plans.filter((p) => p.category === 'other').length;
}

// ─── Filtered list ──────────────────────────────────
function filteredPlans() {
  if (activeCategory === 'all') return plans;
  return plans.filter((p) => p.category === activeCategory);
}

// ─── CRUD ───────────────────────────────────────────
async function createPlan() {
  const cat = activeCategory === 'all' ? 'feature' : activeCategory;
  const plan = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '',
    content: '',
    category: cat,
    status: 'todo',
    ai_done: false,
    use_worktree: false,
    use_headless: false,
    created: Date.now(),
    updated: Date.now(),
  };
  plans.unshift(plan);
  updateCount();
  await apiCreatePlan(plan);
  if (currentView === 'board') {
    renderBoard();
    selectPlan(plan.id);
    showBoardEditor();
  } else {
    renderList();
    selectPlan(plan.id);
  }
  titleInput.focus();
}

function deletePlan(id) {
  const filtered = filteredPlans();
  const idx = filtered.findIndex((p) => p.id === id);
  plans = plans.filter((p) => p.id !== id);
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
  if (currentView === 'board') {
    renderBoard();
    if (activeId === null) hideBoardEditor();
  } else {
    renderList();
  }
  apiDeletePlan(id);
}

function selectPlan(id) {
  activeId = id;
  const plan = plans.find((p) => p.id === id);
  if (!plan) {
    showEmptyState();
    return;
  }

  editorEmpty.style.display = 'none';
  editorArea.style.display = 'flex';
  titleInput.value = plan.title;
  contentInput.value = plan.content;
  catSelect.value = plan.category || 'other';
  dateEl.textContent = formatDate(plan.updated);
  if (statusSelect) statusSelect.value = plan.status || 'todo';
  loadPlanLogs(id);
  loadPlanImages(id);

  listEl.querySelectorAll('.plan-item').forEach((el) => {
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
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!activeId) return;
  const plan = plans.find((p) => p.id === activeId);
  if (!plan) return;
  plan.title = titleInput.value;
  plan.content = contentInput.value;
  plan.category = catSelect.value;
  plan.updated = Date.now();
  updateCount();
  if (currentView === 'board') renderBoard();
  else renderList();
  dateEl.textContent = formatDate(plan.updated);
  apiUpdatePlan(plan);
}

// ─── Category tabs ──────────────────────────────────
function switchCategory(cat) {
  activeCategory = cat;
  catTabsEl.querySelectorAll('.plan-cat-tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.cat === cat);
  });
  if (currentView === 'board') renderBoard();
  else renderList();
  const filtered = filteredPlans();
  if (activeId && filtered.find((p) => p.id === activeId)) {
    selectPlan(activeId);
  } else if (filtered.length > 0) {
    selectPlan(filtered[0].id);
  } else {
    activeId = null;
    showEmptyState();
  }
}

// ─── View switching ──────────────────────────────────
function switchView(view) {
  currentView = view;
  localStorage.setItem('plan-view', view);
  viewToggleEl?.querySelectorAll('.plan-view-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  const body = document.querySelector('.plan-body');
  if (view === 'board') {
    if (body) body.classList.add('plan-body--board');
    if (boardEl) boardEl.style.display = 'flex';
    if (listColEl) listColEl.style.display = 'none';
    hideBoardEditor();
    renderBoard();
  } else {
    if (body) body.classList.remove('plan-body--board');
    if (boardEl) boardEl.style.display = 'none';
    if (boardDivider) boardDivider.style.display = 'none';
    if (editorColEl) {
      editorColEl.style.display = '';
      editorColEl.style.height = '';
    }
    if (listColEl) listColEl.style.display = '';
    renderList();
  }
}

const editorCloseBtn = document.getElementById('plan-editor-close');

function showBoardEditor() {
  if (boardDivider) boardDivider.style.display = '';
  if (editorColEl) {
    editorColEl.style.display = '';
    const savedH = localStorage.getItem('plan-board-editor-h');
    editorColEl.style.height = savedH ? `${savedH}px` : '260px';
  }
  if (editorCloseBtn) editorCloseBtn.style.display = 'block';
  if (boardEl) boardEl.style.flex = '1';
}

function hideBoardEditor() {
  flushSave();
  if (editorColEl) {
    editorColEl.style.display = 'none';
    editorColEl.style.height = '';
  }
  if (boardDivider) boardDivider.style.display = 'none';
  if (editorCloseBtn) editorCloseBtn.style.display = 'none';
  if (boardEl) boardEl.style.flex = '1';
  activeId = null;
}

// ─── Rendering ──────────────────────────────────────
function renderList() {
  if (!listEl) return;
  const filtered = filteredPlans();
  listEl.innerHTML = filtered
    .map((p) => {
      const title = escHtml(p.title || 'Untitled');
      const preview = escHtml((p.content || '').slice(0, 80).replace(/\n/g, ' '));
      const date = formatDate(p.updated);
      const active = p.id === activeId ? ' active' : '';
      const catLabel = CATEGORIES[p.category] || '기타';
      const statusLabel = STATUS_LABELS[p.status || 'todo'] || 'TODO';
      return `<div class="plan-item${active}" data-id="${p.id}">
      <span class="plan-item-cat" data-cat="${p.category || 'other'}">${catLabel}</span>
      <span class="plan-item-status">${statusLabel}</span>
      <div class="plan-item-title">${title}</div>
      <div class="plan-item-preview">${preview || 'No content'}</div>
      <div class="plan-item-date">${date}</div>
    </div>`;
    })
    .join('');
}

function renderBoard() {
  const filtered = filteredPlans();
  for (const status of STATUSES) {
    const col = document.getElementById(`plan-board-${status}`);
    const countBadge = document.getElementById(`plan-board-count-${status}`);
    if (!col) continue;
    const cards = filtered.filter((p) => (p.status || 'todo') === status);
    if (countBadge) countBadge.textContent = cards.length;
    col.innerHTML = cards
      .map((p) => {
        const title = escHtml(p.title || 'Untitled');
        const preview = escHtml((p.content || '').slice(0, 60).replace(/\n/g, ' '));
        const date = formatDate(p.updated);
        const catLabel = CATEGORIES[p.category] || '기타';
        const aiBadge = p.ai_done ? '<span class="plan-board-card-ai-badge">✅ AI</span>' : '';
        const aiSessions = (p.ai_sessions || [])
          .map((s) => {
            const reg = AI_REGISTRY[s.ai] || {};
            const icon = reg.icon ? `<img src="${reg.icon}" alt="">` : '🤖';
            return `<span class="plan-board-card-ai-session" data-session-id="${escHtml(s.sessionId)}" title="${escHtml(reg.label || s.ai)} session">${icon}${escHtml(s.sessionId.slice(-6))}</span>`;
          })
          .join('');
        const wtChecked = p.use_worktree ? ' checked' : '';
        const hlChecked = p.use_headless ? ' checked' : '';
        return `<div class="plan-board-card" draggable="true" data-id="${p.id}" data-cat="${p.category || 'other'}">
        <div class="plan-board-card-title">${title}</div>
        <div class="plan-board-card-preview">${preview || 'No content'}</div>
        <div class="plan-board-card-footer">
          <span class="plan-board-card-footer-left">
            <span class="plan-board-card-cat">${catLabel}</span>
            <label class="plan-board-card-wt" title="워크트리 모드 (-w)"><input type="checkbox" class="plan-wt-check" data-id="${p.id}"${wtChecked}><span class="plan-wt-icon">🌿</span></label>
            <label class="plan-board-card-hl" title="헤드리스 모드 (-p)"><input type="checkbox" class="plan-headless-check" data-id="${p.id}"${hlChecked}><span class="plan-headless-icon">⚡</span></label>
          </span>
          <span class="plan-board-card-footer-right">
            ${aiBadge}${aiSessions}
            <span class="plan-board-card-date">${date}</span>
          </span>
        </div>
      </div>`;
      })
      .join('');
  }
  applyColCollapse();
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const diff = Math.floor((now - d) / 86400000);
  if (diff === 1) return `Yesterday ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

// ─── Column Collapse ─────────────────────────────────
function toggleColCollapse(status) {
  const idx = collapsedCols.indexOf(status);
  if (idx >= 0) collapsedCols.splice(idx, 1);
  else collapsedCols.push(status);
  localStorage.setItem('plan-collapsed-cols', JSON.stringify(collapsedCols));
  applyColCollapse();
}

function applyColCollapse() {
  boardEl?.querySelectorAll('.plan-board-col').forEach((col) => {
    const status = col.dataset.status;
    col.classList.toggle('collapsed', collapsedCols.includes(status));
  });
}

function initColCollapse() {
  boardEl?.querySelectorAll('.plan-board-col-header').forEach((header) => {
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      const col = header.closest('.plan-board-col');
      if (col) toggleColCollapse(col.dataset.status);
    });
  });
}

// ─── Drag and Drop ───────────────────────────────────
function initBoardDragDrop() {
  boardEl?.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.plan-board-card');
    if (!card) return;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  boardEl?.addEventListener('dragend', (e) => {
    const card = e.target.closest('.plan-board-card');
    if (card) card.classList.remove('dragging');
    boardEl.querySelectorAll('.plan-board-col').forEach((col) => col.classList.remove('drag-over'));
  });
  boardEl?.querySelectorAll('.plan-board-col').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const planId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (!planId || !newStatus) return;
      const plan = plans.find((p) => p.id === planId);
      if (!plan || plan.status === newStatus) return;
      plan.status = newStatus;
      plan.ai_done = false;
      renderBoard();
      updateCount();
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

// ─── Board Divider Drag ─────────────────────────────
function initBoardDivider() {
  if (!boardDivider || !editorColEl) return;
  let startY = 0;
  let startH = 0;

  boardDivider.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = editorColEl.offsetHeight;
    boardDivider.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    const delta = startY - e.clientY;
    const newH = Math.max(120, Math.min(startH + delta, window.innerHeight * 0.7));
    editorColEl.style.height = `${newH}px`;
  }

  function onUp() {
    boardDivider.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    localStorage.setItem('plan-board-editor-h', String(editorColEl.offsetHeight));
  }
}

// ─── Context Menu ────────────────────────────────────
function showPlanCtxMenu(x, y, planId) {
  ctxTargetPlanId = planId;
  if (!ctxMenuEl) return;
  ctxMenuEl.style.display = 'block';
  ctxMenuEl.style.left = Math.min(x, window.innerWidth - 180) + 'px';
  ctxMenuEl.style.top = Math.min(y, window.innerHeight - 400) + 'px';
}

function hidePlanCtxMenu() {
  if (ctxMenuEl) ctxMenuEl.style.display = 'none';
  ctxTargetPlanId = null;
}

// ─── Plan Images ─────────────────────────────────────
async function loadPlanImages(planId) {
  if (!imagesGridEl) return;
  try {
    const res = await apiFetch(`/api/plans/${planId}/images`);
    const data = await res.json();
    if (!data.ok || !data.images.length) {
      imagesGridEl.innerHTML = '';
      return;
    }
    imagesGridEl.innerHTML = data.images
      .map(
        (img) => `
      <div class="plan-image-thumb" data-url="${escHtml(img.url)}" data-name="${escHtml(img.name)}">
        <img src="${escHtml(img.url)}" alt="${escHtml(img.name)}" loading="lazy" />
        <button class="plan-image-delete" title="Delete">✕</button>
      </div>
    `
      )
      .join('');
  } catch {
    imagesGridEl.innerHTML = '';
  }
}

async function uploadPlanImage(planId, file) {
  const ext = file.name?.split('.').pop()?.toLowerCase() || 'png';
  const filename = `img-${Date.now()}.${ext}`;
  try {
    await apiFetch(`/api/plans/${planId}/images?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'image/png' },
      body: file,
    });
    await loadPlanImages(planId);
  } catch (e) {
    console.error('[plan] image upload failed:', e);
  }
}

async function deletePlanImage(planId, filename) {
  try {
    await apiFetch(`/api/plans/${planId}/images/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    await loadPlanImages(planId);
  } catch (e) {
    console.error('[plan] image delete failed:', e);
  }
}

function openLightbox(url) {
  if (!lightboxEl || !lightboxImg) return;
  lightboxImg.src = url;
  lightboxEl.style.display = 'flex';
}

function closeLightbox() {
  if (lightboxEl) lightboxEl.style.display = 'none';
  if (lightboxImg) lightboxImg.src = '';
}

// ─── Activity Log ─────────────────────────────────────
async function loadPlanLogs(planId) {
  if (!logsListEl) return;
  try {
    const res = await apiFetch(`/api/plans/${planId}/logs`);
    const data = await res.json();
    if (!data.ok) {
      logsListEl.innerHTML = '';
      return;
    }
    logsListEl.innerHTML = data.logs
      .map((log) => {
        const icon = log.type === 'commit' ? '🔨' : '📝';
        const hash = log.commit_hash
          ? `<span class="plan-log-hash">${escHtml(log.commit_hash.slice(0, 7))}</span>`
          : '';
        const time = formatDate(new Date(log.created_at).getTime());
        return `<div class="plan-log-item">
        <span class="plan-log-icon">${icon}</span>
        <span class="plan-log-content">${escHtml(log.content)} ${hash}</span>
        <span class="plan-log-time">${time}</span>
      </div>`;
      })
      .join('');
  } catch {
    logsListEl.innerHTML = '';
  }
}

// ─── Toast ───────────────────────────────────────────
export function showPlanToast(planId, title) {
  // Update local plan data: AI completed → move to DONE
  const plan = plans.find((p) => p.id === planId);
  if (plan) {
    plan.ai_done = true;
    plan.status = 'done';
    if (currentView === 'board') renderBoard();
    else renderList();
  }
  if (!toastContainer) return;
  const statusLabel = STATUS_LABELS['done'];
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

// ─── Auth check ─────────────────────────────────────
function isLoggedIn() {
  return !!getAuthToken();
}

// ─── Modal size persistence ─────────────────────────
const modalEl = document.getElementById('plan-modal');

function restoreModalSize() {
  const saved = localStorage.getItem('plan-modal-size');
  if (saved && modalEl) {
    try {
      const { w, h } = JSON.parse(saved);
      modalEl.style.width = w + 'px';
      modalEl.style.height = h + 'px';
    } catch {}
  }
}

function saveModalSize() {
  if (!modalEl) return;
  const w = modalEl.offsetWidth;
  const h = modalEl.offsetHeight;
  localStorage.setItem('plan-modal-size', JSON.stringify({ w, h }));
}

// ─── Modal open/close ───────────────────────────────
export async function openPlanModal() {
  if (!isLoggedIn()) return;
  await loadPlans();
  if (activeId && !plans.find((p) => p.id === activeId)) activeId = null;
  const body = document.querySelector('.plan-body');
  if (currentView === 'board') {
    if (body) body.classList.add('plan-body--board');
    renderBoard();
    // Board view: editor is hidden until a card is clicked
    if (editorColEl) editorColEl.style.display = 'none';
    if (boardDivider) boardDivider.style.display = 'none';
  } else {
    if (body) body.classList.remove('plan-body--board');
    renderList();
    const filtered = filteredPlans();
    if (activeId && filtered.find((p) => p.id === activeId)) {
      selectPlan(activeId);
    } else if (filtered.length > 0) {
      selectPlan(filtered[0].id);
    } else {
      showEmptyState();
    }
  }
  restoreModalSize();
  overlay.classList.add('open');
}

export function closePlanModal() {
  flushSave();
  saveModalSize();
  overlay.classList.remove('open');
}

export function isPlanModalOpen() {
  return overlay.classList.contains('open');
}

// ─── Init ───────────────────────────────────────────
export function initPlanPanel() {
  const sbPlan = document.getElementById('sb-plan');

  // Hide plan buttons if not logged in
  if (!isLoggedIn()) {
    if (sbPlan) sbPlan.style.display = 'none';
    const activityPlanBtn = document.querySelector('.activity-btn[data-panel="plan"]');
    if (activityPlanBtn) activityPlanBtn.style.display = 'none';
    const bnavPlanBtn = document.querySelector('.bnav-btn[data-panel="plan"]');
    if (bnavPlanBtn) bnavPlanBtn.style.display = 'none';
    return;
  }

  // Load count on init
  loadPlans().then(() => updateCount());

  // Statusbar click
  sbPlan?.addEventListener('click', openPlanModal);

  // Close button
  document.getElementById('plan-modal-close')?.addEventListener('click', closePlanModal);

  // Overlay click to close
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) closePlanModal();
  });

  // Category tab clicks
  catTabsEl?.addEventListener('click', (e) => {
    const tab = e.target.closest('.plan-cat-tab');
    if (tab) {
      flushSave();
      switchCategory(tab.dataset.cat);
    }
  });

  // New plan
  document.getElementById('plan-btn-new')?.addEventListener('click', createPlan);
  document.getElementById('plan-btn-new-global')?.addEventListener('click', createPlan);

  // Delete plan
  document.getElementById('plan-btn-delete')?.addEventListener('click', () => {
    if (activeId) deletePlan(activeId);
  });

  // List click delegation
  listEl?.addEventListener('click', (e) => {
    const item = e.target.closest('.plan-item');
    if (item) {
      flushSave();
      selectPlan(item.dataset.id);
    }
  });

  // Enter in title → focus content (keyup for IME/한글 compatibility)
  titleInput?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.keyCode === 13) && !e.isComposing) e.preventDefault();
  });
  titleInput?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.keyCode === 13) contentInput.focus();
  });

  // Category change in editor
  catSelect?.addEventListener('change', () => {
    scheduleSave();
  });

  // Auto-save on input
  titleInput?.addEventListener('input', scheduleSave);
  contentInput?.addEventListener('input', scheduleSave);

  // View toggle
  viewToggleEl?.addEventListener('click', (e) => {
    const btn = e.target.closest('.plan-view-btn');
    if (btn) switchView(btn.dataset.view);
  });

  // Status select change
  statusSelect?.addEventListener('change', async () => {
    if (!activeId) return;
    const plan = plans.find((p) => p.id === activeId);
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

  // AI session badge click → navigate to session tab
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

  // Worktree checkbox toggle
  boardEl?.addEventListener('change', async (e) => {
    const cb = e.target.closest('.plan-wt-check');
    if (!cb) return;
    const planId = cb.dataset.id;
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    plan.use_worktree = cb.checked;
    try {
      await apiFetch(`/api/plans/${planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: plan.title, content: plan.content, category: plan.category, use_worktree: plan.use_worktree }),
      });
    } catch (err) {
      console.error('[plan] worktree toggle failed:', err);
    }
  });

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

  // Board card click → editor
  boardEl?.addEventListener('click', (e) => {
    const card = e.target.closest('.plan-board-card');
    if (!card) return;
    // skip if clicking worktree or headless checkbox
    if (e.target.closest('.plan-board-card-wt') || e.target.closest('.plan-wt-check') || e.target.closest('.plan-board-card-hl') || e.target.closest('.plan-headless-check')) return;
    // skip if clicking AI session badge
    if (e.target.closest('.plan-board-card-ai-session')) return;
    // toggle: click same card again → close detail
    if (activeId === card.dataset.id) {
      hideBoardEditor();
      return;
    }
    flushSave();
    selectPlan(card.dataset.id);
    showBoardEditor();
    loadPlanLogs(card.dataset.id);
  });

  // Board card right-click → context menu
  boardEl?.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.plan-board-card');
    if (!card) return;
    e.preventDefault();
    showPlanCtxMenu(e.clientX, e.clientY, card.dataset.id);
  });

  // Context menu actions
  ctxMenuEl?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const item = e.target.closest('.plan-ctx-item');
    if (!item || !ctxTargetPlanId) return;
    const action = item.dataset.action;
    if (action === 'edit') {
      selectPlan(ctxTargetPlanId);
      if (currentView === 'board') showBoardEditor();
    } else if (action === 'status') {
      const newStatus = item.dataset.status;
      const plan = plans.find((p) => p.id === ctxTargetPlanId);
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
    } else if (action === 'ai-assign') {
      const aiType = item.dataset.ai;
      assignAiToplan(ctxTargetPlanId, aiType);
      closePlanModal();
    }
    hidePlanCtxMenu();
  });

  // Close context menu on click elsewhere
  document.addEventListener('click', () => hidePlanCtxMenu());

  // Init column collapse and drag and drop
  initColCollapse();
  initBoardDragDrop();
  initBoardDivider();

  // Editor close button (board view only)
  editorCloseBtn?.addEventListener('click', () => {
    if (currentView === 'board') hideBoardEditor();
  });

  // Image paste on editor content area
  contentInput?.addEventListener('paste', (e) => {
    if (!activeId) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) uploadPlanImage(activeId, file);
        return;
      }
    }
  });

  // Image grid: click to lightbox, delete button
  imagesGridEl?.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.plan-image-delete');
    if (delBtn) {
      e.stopPropagation();
      const thumb = delBtn.closest('.plan-image-thumb');
      if (thumb && activeId) deletePlanImage(activeId, thumb.dataset.name);
      return;
    }
    const thumb = e.target.closest('.plan-image-thumb');
    if (thumb) openLightbox(thumb.dataset.url);
  });

  // Lightbox close
  lightboxClose?.addEventListener('click', closeLightbox);
  lightboxEl?.querySelector('.plan-lightbox-backdrop')?.addEventListener('click', closeLightbox);

  // Apply initial view
  switchView(currentView);
}

// ─── AI Assignment ──────────────────────────────────
// Map: sessionId → { planId, ai, prompt }  — pending AI sessions waiting for AI readiness
const pendingAiSessions = new Map();
// Map: sessionId → { planId, ai, status } — headless 작업 추적
const headlessJobs = new Map();
// 완료/실패된 headless 작업 히스토리
const headlessHistory = [];

let _pendingAiAssign = null;

async function assignAiToplan(planId, aiType) {
  const plan = plans.find((p) => p.id === planId);
  if (!plan) return;

  // Build the prompt from plan content
  const title = plan.title || 'Untitled';
  const content = plan.content || '';
  const catLabel = CATEGORIES[plan.category] || '기타';
  let prompt = `다음 이슈를 처리해주세요:\n\n유형: ${catLabel}\n제목: ${title}\n\n${content}`;

  // Fetch attached images and include URLs
  try {
    const res = await apiFetch(`/api/plans/${planId}/images`);
    const data = await res.json();
    if (data.ok && data.images && data.images.length) {
      prompt += '\n\n첨부 이미지:\n' + data.images.map((img) => img.url).join('\n');
    }
  } catch {
    /* ignore */
  }

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
}

// Called from main.js when session_created arrives — checks if it's an AI-assigned session
export function onAiSessionCreated(sessionId) {
  if (!_pendingAiAssign) return false;
  const { planId, aiType, prompt } = _pendingAiAssign;
  _pendingAiAssign = null;

  // Store pending session waiting for AI readiness
  pendingAiSessions.set(sessionId, { planId, aiType, prompt });
  updateAiTasksBadge();
  return true;
}

// Called from main.js when session_info with ai field arrives
export function onAiSessionReady(sessionId) {
  const pending = pendingAiSessions.get(sessionId);
  if (!pending || pending.sent) return;
  pending.sent = true;
  // AI process detected — ask server to wait for actual prompt readiness, then send
  wsSend({ type: 'send_when_ready', sessionId, data: pending.prompt });
}

// Called from main.js when server confirms prompt was sent to AI
export function onAiPromptSent(sessionId) {
  const pending = pendingAiSessions.get(sessionId);
  if (!pending) return;
  const { planId, aiType } = pending;
  pendingAiSessions.delete(sessionId);

  const plan = plans.find((p) => p.id === planId);
  if (!plan) return;

  // Add AI session badge
  if (!plan.ai_sessions) plan.ai_sessions = [];
  plan.ai_sessions.push({ sessionId, ai: aiType });

  // Move to DOING
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
  headlessHistory.push({ planId, sessionId, ai: 'claude', status: 'done', ts: Date.now() });

  const plan = plans.find((p) => p.id === planId);
  if (plan) {
    plan.ai_done = true;
    plan.status = 'done';
    plan.content = (plan.content || '') + '\n\n---\n**AI 결과 (headless):**\n' + result;
    if (currentView === 'board') renderBoard();
    else renderList();
  }

  updateCount();
  updateAiTasksBadge();
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
export function onHeadlessFailed({ sessionId, error }) {
  const job = headlessJobs.get(sessionId);
  headlessJobs.delete(sessionId);
  headlessHistory.push({ planId: job?.planId, sessionId, ai: 'claude', status: 'failed', error, ts: Date.now() });

  renderBoard();
  updateCount();
  updateAiTasksBadge();
  if (toastContainer) {
    const toast = document.createElement('div');
    toast.className = 'plan-toast';
    toast.innerHTML = `
      <div class="plan-toast-title">Headless AI 실패</div>
      <div class="plan-toast-status">${escHtml(error)}</div>
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

// ─── AI Tasks Dashboard ─────────────────────────────
const aiDashOverlay = document.getElementById('ai-dash-overlay');
const aiDashBody = document.getElementById('ai-dash-body');
const sbAiTasks = document.getElementById('sb-ai-tasks');
const sbAiTasksCount = document.getElementById('sb-ai-tasks-count');
const sbAiTasksSep = document.getElementById('sb-ai-tasks-sep');

// Collect all active AI sessions across plans
function getActiveAiTasks() {
  const tasks = [];
  for (const plan of plans) {
    if (!plan.ai_sessions) continue;
    for (const s of plan.ai_sessions) {
      // headless 세션은 headlessJobs Map에서 별도 수집 — 중복 방지
      if (s.mode === 'headless') continue;
      tasks.push({
        planId: plan.id,
        planTitle: plan.title || 'Untitled',
        planStatus: plan.status,
        ...s,
      });
    }
  }
  // Also include pending sessions not yet confirmed
  for (const [sessionId, info] of pendingAiSessions) {
    tasks.push({
      planId: info.planId,
      planTitle: plans.find((p) => p.id === info.planId)?.title || 'Untitled',
      planStatus: 'pending',
      sessionId,
      ai: info.aiType,
      pending: true,
    });
  }
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
  return tasks;
}

export function updateAiTasksBadge() {
  const tasks = getActiveAiTasks();
  const count = tasks.length;
  sbAiTasks.style.display = '';
  sbAiTasksSep.style.display = '';
  sbAiTasksCount.textContent = count;
}

let aiDashTab = 'active'; // 'active' | 'history'

function renderAiDashCard(t) {
  const reg = AI_REGISTRY[t.ai] || {};
  const icon = reg.icon || 'icons/codex.png';
  const label = reg.label || t.ai;
  const isHeadless = t.mode === 'headless';
  const statusCls = t.pending ? ' pending' : isHeadless ? ' headless' : t.status === 'done' ? ' done' : t.status === 'failed' ? ' failed' : '';
  const statusText = t.status === 'done'
    ? '✅ 완료'
    : t.status === 'failed'
      ? '❌ 실패'
      : t.pending
        ? '대기중…'
        : isHeadless
          ? '⚡ 실행중'
          : t.planStatus === 'done'
            ? '✅ 완료'
            : t.planStatus === 'doing'
              ? '작업중'
              : t.planStatus || '—';
  const sid = t.sessionId || '';
  const actionBtn = t.status === 'done' || t.status === 'failed'
    ? ''
    : isHeadless
      ? `<button class="ai-dash-card-cancel" data-plan-id="${escHtml(t.planId)}" data-sid="${escHtml(sid)}">취소</button>`
      : sid ? `<button class="ai-dash-card-go" data-sid="${escHtml(sid)}">이동 →</button>` : '';
  return `<div class="ai-dash-card" data-session-id="${escHtml(sid)}">
    <img class="ai-dash-card-icon" src="${escHtml(icon)}" alt="${escHtml(label)}">
    <div class="ai-dash-card-info">
      <div class="ai-dash-card-plan">${escHtml(t.planTitle)}</div>
      <div class="ai-dash-card-meta">${escHtml(label)} · ${escHtml(sid.slice(-8))}</div>
    </div>
    <span class="ai-dash-card-status${statusCls}">${statusText}</span>
    ${actionBtn}
  </div>`;
}

function renderAiDashboard() {
  const tasks = getActiveAiTasks();
  const historyCount = headlessHistory.length;
  const activeCount = tasks.length;

  // 탭 헤더
  const tabsHtml = `<div class="ai-dash-tabs">
    <button class="ai-dash-tab${aiDashTab === 'active' ? ' active' : ''}" data-tab="active">활성 (${activeCount})</button>
    <button class="ai-dash-tab${aiDashTab === 'history' ? ' active' : ''}" data-tab="history">완료 (${historyCount})</button>
  </div>`;

  if (aiDashTab === 'active') {
    if (!tasks.length) {
      aiDashBody.innerHTML = tabsHtml + '<div class="ai-dash-empty">활성 AI 작업이 없습니다</div>';
      return;
    }
    aiDashBody.innerHTML = tabsHtml + tasks.map(renderAiDashCard).join('');
  } else {
    if (!historyCount) {
      aiDashBody.innerHTML = tabsHtml + '<div class="ai-dash-empty">완료된 작업이 없습니다</div>';
      return;
    }
    const items = [...headlessHistory].reverse().map((h) => {
      const plan = plans.find((p) => p.id === h.planId);
      return renderAiDashCard({
        ...h,
        planTitle: plan?.title || 'Untitled',
        planStatus: h.status,
      });
    });
    aiDashBody.innerHTML = tabsHtml + items.join('');
  }
}

export function openAiDashboard() {
  renderAiDashboard();
  aiDashOverlay.classList.add('open');
}

export function closeAiDashboard() {
  aiDashOverlay.classList.remove('open');
}

// Event listeners
sbAiTasks?.addEventListener('click', () => openAiDashboard());
document.getElementById('ai-dash-close')?.addEventListener('click', () => closeAiDashboard());
aiDashOverlay?.addEventListener('click', (e) => {
  if (e.target === aiDashOverlay) closeAiDashboard();
});
aiDashBody?.addEventListener('click', (e) => {
  const tab = e.target.closest('.ai-dash-tab');
  if (tab) {
    aiDashTab = tab.dataset.tab;
    renderAiDashboard();
    return;
  }
  const cancelBtn = e.target.closest('.ai-dash-card-cancel');
  if (cancelBtn) {
    const planId = cancelBtn.dataset.planId;
    const sid = cancelBtn.dataset.sid;
    apiFetch(`/api/plans/${planId}/headless/${sid}`, { method: 'DELETE' })
      .catch((err) => console.error('[plan] headless cancel failed:', err));
    return;
  }
  const goBtn = e.target.closest('.ai-dash-card-go');
  if (goBtn) {
    const sid = goBtn.dataset.sid;
    if (sid) {
      activateSession(sid);
      closeAiDashboard();
    }
    return;
  }
  const card = e.target.closest('.ai-dash-card');
  if (card && card.dataset.sessionId) {
    activateSession(card.dataset.sessionId);
    closeAiDashboard();
  }
});

// Backward compatibility exports (no-ops now)
export function handlePlanFileData() {}
export function onPlanSessionChange() {}
