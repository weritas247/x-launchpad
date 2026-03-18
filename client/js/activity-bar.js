// ─── ACTIVITY BAR (LEFT ICON BAR) ────────────────────────────────
import { requestFileTree } from './explorer.js';
import { requestGitStatus } from './source-control.js';

let activePanel = 'sessions'; // 'sessions' | 'explorer' | 'source-control'
let secondaryPanel = null;     // split 시 하단 패널
let dragSrcBtn = null;

export function initActivityBar() {
  const buttons = document.querySelectorAll('.activity-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;
      // secondary 패널 아이콘 클릭 → split 해제
      if (panel === secondaryPanel) {
        closeSidebarSplit();
        return;
      }
      if (panel === activePanel) {
        // 분할 상태에서 primary 클릭 → 분할 해제만 (사이드바는 유지)
        if (secondaryPanel) {
          closeSidebarSplit();
        } else {
          toggleSidebar();
        }
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
      e.dataTransfer.setData('text/activity-panel', btn.dataset.panel);
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      dragSrcBtn = null;
      document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('drag-over-top', 'drag-over-bottom'));
      clearSidebarDropZones();
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

  // ─── Sidebar as drop target: split or switch panel ───
  const sidebar = document.getElementById('sidebar');

  sidebar.addEventListener('dragover', (e) => {
    const isActivityDrag = e.dataTransfer.types.includes('text/activity-panel');
    const isHeaderDrag = e.dataTransfer.types.includes('text/sidebar-panel');
    if (!isActivityDrag && !isHeaderDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const rect = sidebar.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const isTop = e.clientY < midY;

    sidebar.classList.add('drag-target');
    sidebar.classList.toggle('drag-zone-top', isTop);
    sidebar.classList.toggle('drag-zone-bottom', !isTop);
  });

  sidebar.addEventListener('dragleave', (e) => {
    if (!sidebar.contains(e.relatedTarget)) {
      clearSidebarDropZones();
    }
  });

  sidebar.addEventListener('drop', (e) => {
    e.preventDefault();
    const isTop = sidebar.classList.contains('drag-zone-top');
    clearSidebarDropZones();

    // Case 1: Header drag → swap split panels
    const headerPanel = e.dataTransfer.getData('text/sidebar-panel');
    if (headerPanel && secondaryPanel) {
      // Only swap if dragged to opposite zone
      const draggedIsPrimary = headerPanel === activePanel;
      if ((draggedIsPrimary && !isTop) || (!draggedIsPrimary && isTop)) {
        swapSidebarSplit();
      }
      return;
    }

    // Case 2: Activity bar icon drag
    const panel = e.dataTransfer.getData('text/activity-panel');
    if (!panel || panel === activePanel || panel === secondaryPanel) return;

    if (secondaryPanel) {
      // Already split → replace secondary with new panel
      replaceSplitSecondary(panel, isTop);
    } else {
      // Not split → create split
      openSidebarSplit(panel, isTop);
    }
  });

  // ─── Panel header drag (for split rearranging) ───
  sidebar.addEventListener('dragstart', (e) => {
    const header = e.target.closest('.sidebar-header');
    if (!header || !secondaryPanel) return;
    const panel = header.closest('.sidebar-panel');
    if (!panel) return;
    const panelId = panel.id.replace('panel-', '');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/sidebar-panel', panelId);
    header.classList.add('dragging');
  });

  sidebar.addEventListener('dragend', (e) => {
    const header = e.target.closest('.sidebar-header');
    if (!header) return;
    header.classList.remove('dragging');
    clearSidebarDropZones();

    // If successfully dropped on a target, don't close
    if (e.dataTransfer.dropEffect !== 'none') return;
    // If dropped outside sidebar, close split
    if (!secondaryPanel) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const droppedOutside = e.clientX < sidebarRect.left || e.clientX > sidebarRect.right ||
                           e.clientY < sidebarRect.top || e.clientY > sidebarRect.bottom;
    if (droppedOutside) {
      closeSidebarSplit();
    }
  });

  // ─── Sidebar split resize handle ───
  initSidebarSplitResize();
}

// ─── Sidebar Split ───
function openSidebarSplit(panel, droppedOnTop) {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');

  // If dropped on top half, the dragged panel becomes primary (top)
  // and current primary moves to secondary (bottom)
  if (droppedOnTop) {
    secondaryPanel = activePanel;
    activePanel = panel;
  } else {
    secondaryPanel = panel;
  }

  // Update button active states — hide secondary icon, show only primary
  document.querySelectorAll('.activity-btn').forEach(btn => {
    const p = btn.dataset.panel;
    btn.classList.toggle('active', p === activePanel);
    btn.classList.remove('active-secondary');
    btn.style.display = (p === secondaryPanel) ? 'none' : '';
  });

  // Show both panels
  document.querySelectorAll('.sidebar-panel').forEach(p => {
    const id = p.id.replace('panel-', '');
    if (id === activePanel) {
      p.classList.add('active');
      p.classList.remove('sidebar-panel-secondary');
    } else if (id === secondaryPanel) {
      p.classList.add('active');
      p.classList.add('sidebar-panel-secondary');
    } else {
      p.classList.remove('active', 'sidebar-panel-secondary');
    }
  });

  sidebar.classList.add('sidebar-split');

  // Reorder DOM: primary panel → resize handle → secondary panel
  const primaryEl = document.getElementById(`panel-${activePanel}`);
  const secondaryEl = document.getElementById(`panel-${secondaryPanel}`);
  ensureSplitResizeHandle();
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  // Move primary to front, then resize, then secondary
  sidebar.insertBefore(primaryEl, sidebar.firstChild);
  primaryEl.after(resizeHandle);
  resizeHandle.after(secondaryEl);

  ensureSplitCloseBtn();
  setupSplitHeaderDrag();

  // Trigger data loading for both panels
  triggerPanelLoad(activePanel);
  triggerPanelLoad(secondaryPanel);
}

export function closeSidebarSplit() {
  const sidebar = document.getElementById('sidebar');
  sidebar.querySelectorAll('.sidebar-header[draggable]').forEach(h => {
    h.removeAttribute('draggable');
  });
  sidebar.classList.remove('sidebar-split');
  // Reset split ratio
  sidebar.style.removeProperty('--sidebar-split-ratio');

  secondaryPanel = null;

  // Remove secondary classes
  document.querySelectorAll('.sidebar-panel').forEach(p => {
    p.classList.remove('sidebar-panel-secondary');
    p.classList.toggle('active', p.id === `panel-${activePanel}`);
  });

  document.querySelectorAll('.activity-btn').forEach(btn => {
    btn.classList.remove('active-secondary');
    btn.classList.toggle('active', btn.dataset.panel === activePanel);
    btn.style.display = '';  // restore hidden secondary icon
  });

  // Remove close button and resize handle
  const closeBtn = sidebar.querySelector('.sidebar-split-close');
  if (closeBtn) closeBtn.remove();
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  if (resizeHandle) resizeHandle.remove();
}

function swapSidebarSplit() {
  const temp = activePanel;
  activePanel = secondaryPanel;
  secondaryPanel = temp;

  // Update button states — hide secondary icon, show only primary
  document.querySelectorAll('.activity-btn').forEach(btn => {
    const p = btn.dataset.panel;
    btn.classList.toggle('active', p === activePanel);
    btn.classList.remove('active-secondary');
    btn.style.display = (p === secondaryPanel) ? 'none' : '';
  });

  // Update panel classes
  document.querySelectorAll('.sidebar-panel').forEach(p => {
    const id = p.id.replace('panel-', '');
    if (id === activePanel) {
      p.classList.add('active');
      p.classList.remove('sidebar-panel-secondary');
    } else if (id === secondaryPanel) {
      p.classList.add('active');
      p.classList.add('sidebar-panel-secondary');
    } else {
      p.classList.remove('active', 'sidebar-panel-secondary');
    }
  });

  // Reorder DOM
  const sidebar = document.getElementById('sidebar');
  const primaryEl = document.getElementById(`panel-${activePanel}`);
  const secondaryEl = document.getElementById(`panel-${secondaryPanel}`);
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  sidebar.insertBefore(primaryEl, sidebar.firstChild);
  primaryEl.after(resizeHandle);
  resizeHandle.after(secondaryEl);

  // Move close button to new secondary
  const oldClose = sidebar.querySelector('.sidebar-split-close');
  if (oldClose) oldClose.remove();
  ensureSplitCloseBtn();
}

function replaceSplitSecondary(newPanel, droppedOnTop) {
  closeSidebarSplit();
  openSidebarSplit(newPanel, droppedOnTop);
}

function ensureSplitResizeHandle() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar.querySelector('.sidebar-split-resize')) {
    const handle = document.createElement('div');
    handle.className = 'sidebar-split-resize';
    // Insert after the primary panel
    const primaryPanel = document.getElementById(`panel-${activePanel}`);
    if (primaryPanel && primaryPanel.nextSibling) {
      sidebar.insertBefore(handle, primaryPanel.nextSibling);
    } else {
      sidebar.appendChild(handle);
    }
  }
}

function ensureSplitCloseBtn() {
  const secPanel = document.querySelector('.sidebar-panel-secondary');
  if (!secPanel) return;
  const header = secPanel.querySelector('.sidebar-header');
  if (!header || header.querySelector('.sidebar-split-close')) return;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'sidebar-split-close btn-icon-sm';
  closeBtn.title = 'Close split';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSidebarSplit();
  });

  const actions = header.querySelector('.sidebar-header-actions');
  if (actions) {
    actions.insertBefore(closeBtn, actions.firstChild);
  } else {
    header.appendChild(closeBtn);
  }
}

function setupSplitHeaderDrag() {
  const sidebar = document.getElementById('sidebar');
  sidebar.querySelectorAll('.sidebar-panel.active .sidebar-header').forEach(header => {
    header.setAttribute('draggable', 'true');
  });
}

function initSidebarSplitResize() {
  const sidebar = document.getElementById('sidebar');
  let startY = 0, startRatio = 0.5;

  sidebar.addEventListener('mousedown', (e) => {
    if (!e.target.classList.contains('sidebar-split-resize')) return;
    e.preventDefault();
    startY = e.clientY;
    const computed = getComputedStyle(sidebar).getPropertyValue('--sidebar-split-ratio');
    startRatio = computed ? parseFloat(computed) : 0.5;
    e.target.classList.add('dragging');

    const onMove = (ev) => {
      const rect = sidebar.getBoundingClientRect();
      const deltaRatio = (ev.clientY - startY) / rect.height;
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + deltaRatio));
      sidebar.style.setProperty('--sidebar-split-ratio', newRatio);
    };

    const onUp = () => {
      e.target.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function clearSidebarDropZones() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('drag-target', 'drag-zone-top', 'drag-zone-bottom');
}

function triggerPanelLoad(panel) {
  if (panel === 'explorer') {
    requestFileTree();
  } else if (panel === 'source-control') {
    requestGitStatus();
  } else if (panel === 'search') {
    document.getElementById('search-input')?.focus();
  }
}

export function switchPanel(panel) {
  // If we're in split mode, close it first
  if (secondaryPanel) {
    closeSidebarSplit();
  }

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

  triggerPanelLoad(panel);
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

export function setActivityBadge(panel, count) {
  const btn = document.querySelector(`.activity-btn[data-panel="${panel}"]`);
  if (!btn) return;
  let badge = btn.querySelector('.activity-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'activity-badge';
      btn.appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
  } else if (badge) {
    badge.remove();
  }
}
