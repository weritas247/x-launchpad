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
}

// Backward compatibility exports (no-ops now)
export function handlePlanFileData() {}
export function onPlanSessionChange() {}
