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

const STATUSES = ['todo', 'doing', 'done', 'on_hold', 'cancelled'];
const STATUS_LABELS = { todo: 'TODO', doing: 'DOING', done: 'DONE', on_hold: 'ON HOLD', cancelled: 'CANCELLED' };

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
        status: p.status || 'todo',
        ai_done: p.ai_done || false,
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
    status: 'todo',
    ai_done: false,
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
  if (statusSelect) statusSelect.value = plan.status || 'todo';
  loadPlanLogs(id);
  loadPlanImages(id);

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

// ─── View switching ──────────────────────────────────
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
    if (boardDivider) boardDivider.style.display = 'none';
    restoreBoardSplit();
    renderBoard();
  } else {
    if (boardEl) boardEl.style.display = 'none';
    if (boardDivider) boardDivider.style.display = 'none';
    if (listColEl) listColEl.style.display = '';
    if (editorColEl) editorColEl.style.display = '';
    renderList();
  }
}

function showBoardEditor() {
  if (boardDivider) boardDivider.style.display = '';
  if (editorColEl) editorColEl.style.display = '';
  restoreBoardSplit();
}

function restoreBoardSplit() {
  if (!boardEl) return;
  // Only apply saved split when editor is visible
  if (editorColEl && editorColEl.style.display !== 'none') {
    const saved = localStorage.getItem('plan-board-split');
    boardEl.style.flex = saved ? `0 0 ${saved}px` : '2';
  } else {
    boardEl.style.flex = '1';
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
    const statusLabel = STATUS_LABELS[p.status || 'todo'] || 'TODO';
    return `<div class="plan-item${active}" data-id="${p.id}">
      <span class="plan-item-cat" data-cat="${p.category || 'other'}">${catLabel}</span>
      <span class="plan-item-status">${statusLabel}</span>
      <div class="plan-item-title">${title}</div>
      <div class="plan-item-preview">${preview || 'No content'}</div>
      <div class="plan-item-date">${date}</div>
    </div>`;
  }).join('');
}

function renderBoard() {
  const filtered = filteredPlans();
  for (const status of STATUSES) {
    const col = document.getElementById(`plan-board-${status}`);
    const countBadge = document.getElementById(`plan-board-count-${status}`);
    if (!col) continue;
    const cards = filtered.filter(p => (p.status || 'todo') === status);
    if (countBadge) countBadge.textContent = cards.length;
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

// ─── Drag and Drop ───────────────────────────────────
function initBoardDragDrop() {
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
  boardEl?.querySelectorAll('.plan-board-col').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const planId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      if (!planId || !newStatus) return;
      const plan = plans.find(p => p.id === planId);
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
  if (!boardDivider || !boardEl) return;
  let startX = 0;
  let startW = 0;

  boardDivider.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = boardEl.offsetWidth;
    boardDivider.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    const delta = e.clientX - startX;
    const newW = Math.max(200, startW + delta);
    boardEl.style.flex = `0 0 ${newW}px`;
  }

  function onUp() {
    boardDivider.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    localStorage.setItem('plan-board-split', String(boardEl.offsetWidth));
  }
}

// ─── Context Menu ────────────────────────────────────
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

// ─── Plan Images ─────────────────────────────────────
async function loadPlanImages(planId) {
  if (!imagesGridEl) return;
  try {
    const res = await apiFetch(`/api/plans/${planId}/images`);
    const data = await res.json();
    if (!data.ok || !data.images.length) { imagesGridEl.innerHTML = ''; return; }
    imagesGridEl.innerHTML = data.images.map(img => `
      <div class="plan-image-thumb" data-url="${escHtml(img.url)}" data-name="${escHtml(img.name)}">
        <img src="${escHtml(img.url)}" alt="${escHtml(img.name)}" loading="lazy" />
        <button class="plan-image-delete" title="Delete">✕</button>
      </div>
    `).join('');
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
    await apiFetch(`/api/plans/${planId}/images/${encodeURIComponent(filename)}`, { method: 'DELETE' });
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

// ─── Toast ───────────────────────────────────────────
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
  if (activeId && !plans.find(p => p.id === activeId)) activeId = null;
  if (currentView === 'board') renderBoard();
  else renderList();
  const filtered = filteredPlans();
  if (activeId && filtered.find(p => p.id === activeId)) {
    selectPlan(activeId);
  } else if (filtered.length > 0) {
    selectPlan(filtered[0].id);
  } else {
    showEmptyState();
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

  // View toggle
  viewToggleEl?.addEventListener('click', e => {
    const btn = e.target.closest('.plan-view-btn');
    if (btn) switchView(btn.dataset.view);
  });

  // Status select change
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

  // Board card click → editor
  boardEl?.addEventListener('click', e => {
    const card = e.target.closest('.plan-board-card');
    if (!card) return;
    flushSave();
    selectPlan(card.dataset.id);
    showBoardEditor();
    loadPlanLogs(card.dataset.id);
  });

  // Board card right-click → context menu
  boardEl?.addEventListener('contextmenu', e => {
    const card = e.target.closest('.plan-board-card');
    if (!card) return;
    e.preventDefault();
    showPlanCtxMenu(e.clientX, e.clientY, card.dataset.id);
  });

  // Context menu actions
  ctxMenuEl?.addEventListener('click', async e => {
    const item = e.target.closest('.plan-ctx-item');
    if (!item || !ctxTargetPlanId) return;
    const action = item.dataset.action;
    if (action === 'edit') {
      selectPlan(ctxTargetPlanId);
      if (currentView === 'board') showBoardEditor();
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
        } catch (err) { console.error('[plan] status change failed:', err); }
      }
    } else if (action === 'delete') {
      deletePlan(ctxTargetPlanId);
    }
    hidePlanCtxMenu();
  });

  // Close context menu on click elsewhere
  document.addEventListener('click', () => hidePlanCtxMenu());

  // Init drag and drop
  initBoardDragDrop();
  initBoardDivider();

  // Image paste on editor content area
  contentInput?.addEventListener('paste', e => {
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
  imagesGridEl?.addEventListener('click', e => {
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

// Backward compatibility exports (no-ops now)
export function handlePlanFileData() {}
export function onPlanSessionChange() {}
