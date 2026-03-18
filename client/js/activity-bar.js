// ─── ACTIVITY BAR (LEFT ICON BAR) ────────────────────────────────
import { requestFileTree } from './explorer.js';
import { requestGitStatus } from './source-control.js';
import { onSearchSessionChange } from './search.js';

let activePanel = 'sessions'; // 'sessions' | 'explorer' | 'source-control'
let dragSrcBtn = null;

export function initActivityBar() {
  const buttons = document.querySelectorAll('.activity-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      if (panel === activePanel) {
        toggleSidebar();
      } else {
        switchPanel(panel);
      }
    });

    // ─── Drag & Drop: reorder icons + drop on sidebar ───
    btn.setAttribute('draggable', 'true');

    btn.addEventListener('dragstart', (e) => {
      dragSrcBtn = btn;
      btn.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', btn.dataset.panel);
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      dragSrcBtn = null;
      // Clean up all drop indicators
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('drag-over-top', 'drag-over-bottom'));
    });

    // Reorder within activity bar
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragSrcBtn || dragSrcBtn === btn) return;
      e.dataTransfer.dropEffect = 'move';
      const rect = btn.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      btn.classList.toggle('drag-over-top', e.clientY < midY);
      btn.classList.toggle('drag-over-bottom', e.clientY >= midY);
    });

    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      btn.classList.remove('drag-over-top', 'drag-over-bottom');
      if (!dragSrcBtn || dragSrcBtn === btn) return;
      const bar = document.getElementById('activity-bar');
      const rect = btn.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        bar.insertBefore(dragSrcBtn, btn);
      } else {
        bar.insertBefore(dragSrcBtn, btn.nextSibling);
      }
    });
  });

  // ─── Sidebar as drop target: switch panel ───
  const sidebar = document.getElementById('sidebar');
  sidebar.addEventListener('dragover', (e) => {
    const panel = e.dataTransfer.types.includes('text/plain') ? true : false;
    if (!panel) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    sidebar.classList.add('drag-target');
  });

  sidebar.addEventListener('dragleave', (e) => {
    // Only remove if truly leaving sidebar (not entering a child)
    if (!sidebar.contains(e.relatedTarget)) {
      sidebar.classList.remove('drag-target');
    }
  });

  sidebar.addEventListener('drop', (e) => {
    e.preventDefault();
    sidebar.classList.remove('drag-target');
    const panel = e.dataTransfer.getData('text/plain');
    if (panel && panel !== activePanel) {
      switchPanel(panel);
    }
  });
}

export function switchPanel(panel) {
  activePanel = panel;

  // Update active button
  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.panel === panel);
  });

  // Update visible panel
  document.querySelectorAll('.sidebar-panel').forEach(p => {
    p.classList.toggle('active', p.id === `panel-${panel}`);
  });

  // Ensure sidebar is visible
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');

  // Trigger data loading
  if (panel === 'explorer') {
    requestFileTree();
  } else if (panel === 'source-control') {
    requestGitStatus();
  } else if (panel === 'search') {
    document.getElementById('search-input')?.focus();
  }
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
}

export { toggleSidebar as toggleSidebarExport };

// ─── Sidebar resize ───
export function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  if (!handle) return;
  let startX = 0, startW = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 240;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    const delta = e.clientX - startX;
    const newW = Math.max(150, Math.min(500, startW + delta));
    document.documentElement.style.setProperty('--sidebar-w', newW + 'px');
  }

  function onUp() {
    handle.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

export function getActivePanel() {
  return activePanel;
}
