// ─── PLAN MODAL: Evernote-style plan editor ─────────────────
import { escHtml } from './state.js';

const STORAGE_KEY = 'plan-notes';

// DOM refs
const overlay = document.getElementById('plan-overlay');
const listEl = document.getElementById('plan-list-items');
const editorArea = document.getElementById('plan-editor-area');
const editorEmpty = document.getElementById('plan-editor-empty');
const titleInput = document.getElementById('plan-editor-title');
const contentInput = document.getElementById('plan-editor-content');
const dateEl = document.getElementById('plan-editor-date');
const countEl = document.getElementById('sb-plan-count');

let plans = [];
let activeId = null;
let saveTimer = null;

// ─── Storage ────────────────────────────────────────
function loadPlans() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) plans = JSON.parse(raw);
  } catch { plans = []; }
}

function savePlans() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(plans)); } catch {}
  updateCount();
}

function updateCount() {
  if (countEl) countEl.textContent = plans.length;
}

// ─── CRUD ───────────────────────────────────────────
function createPlan() {
  const plan = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '',
    content: '',
    created: Date.now(),
    updated: Date.now()
  };
  plans.unshift(plan);
  savePlans();
  renderList();
  selectPlan(plan.id);
  titleInput.focus();
}

function deletePlan(id) {
  const idx = plans.findIndex(p => p.id === id);
  plans = plans.filter(p => p.id !== id);
  savePlans();
  if (activeId === id) {
    if (plans.length > 0) {
      const next = plans[Math.min(idx, plans.length - 1)];
      selectPlan(next.id);
    } else {
      activeId = null;
      showEmptyState();
    }
  }
  renderList();
}

function selectPlan(id) {
  activeId = id;
  const plan = plans.find(p => p.id === id);
  if (!plan) { showEmptyState(); return; }

  editorEmpty.style.display = 'none';
  editorArea.style.display = 'flex';
  titleInput.value = plan.title;
  contentInput.value = plan.content;
  dateEl.textContent = formatDate(plan.updated);

  // highlight in list
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
  saveTimer = setTimeout(() => {
    if (!activeId) return;
    const plan = plans.find(p => p.id === activeId);
    if (!plan) return;
    plan.title = titleInput.value;
    plan.content = contentInput.value;
    plan.updated = Date.now();
    savePlans();
    renderList();
    dateEl.textContent = formatDate(plan.updated);
  }, 300);
}

// ─── Rendering ──────────────────────────────────────
function renderList() {
  if (!listEl) return;
  listEl.innerHTML = plans.map(p => {
    const title = escHtml(p.title || 'Untitled');
    const preview = escHtml((p.content || '').slice(0, 80).replace(/\n/g, ' '));
    const date = formatDate(p.updated);
    const active = p.id === activeId ? ' active' : '';
    return `<div class="plan-item${active}" data-id="${p.id}">
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

// ─── Modal open/close ───────────────────────────────
export function openPlanModal() {
  loadPlans();
  // validate activeId still exists
  if (activeId && !plans.find(p => p.id === activeId)) activeId = null;
  renderList();
  if (activeId) {
    selectPlan(activeId);
  } else if (plans.length > 0) {
    selectPlan(plans[0].id);
  } else {
    showEmptyState();
  }
  overlay.classList.add('open');
}

export function closePlanModal() {
  // flush any pending save
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (activeId) {
      const plan = plans.find(p => p.id === activeId);
      if (plan) {
        plan.title = titleInput.value;
        plan.content = contentInput.value;
        plan.updated = Date.now();
        savePlans();
      }
    }
  }
  overlay.classList.remove('open');
}

export function isPlanModalOpen() {
  return overlay.classList.contains('open');
}

// ─── Init ───────────────────────────────────────────
export function initPlanPanel() {
  loadPlans();
  updateCount();

  // Statusbar click
  document.getElementById('sb-plan')?.addEventListener('click', openPlanModal);

  // Close button
  document.getElementById('plan-modal-close')?.addEventListener('click', closePlanModal);

  // Overlay click to close
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) closePlanModal();
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
    if (item) selectPlan(item.dataset.id);
  });

  // Enter in title → focus content
  titleInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); contentInput.focus(); }
  });

  // Auto-save on input
  titleInput?.addEventListener('input', scheduleSave);
  contentInput?.addEventListener('input', scheduleSave);

}

// Keep these exports for backward compatibility with main.js
export function handlePlanFileData() {}
export function onPlanSessionChange() {}
