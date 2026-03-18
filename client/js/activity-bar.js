// ─── ACTIVITY BAR (LEFT ICON BAR) ────────────────────────────────
import { requestFileTree } from './explorer.js';
import { requestGitStatus } from './source-control.js';

let activePanel = 'sessions'; // currently visible panel (or primary when split is shown)
let splitConfig = null;       // { primary, secondary, ratio } — persists until explicitly closed
let splitShown = false;       // true when the split view is currently displayed
let dragSrcBtn = null;

export function initActivityBar() {
  const buttons = document.querySelectorAll('.activity-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.panel;

      // Split icon click → show/toggle split view
      if (btn.classList.contains('activity-btn-split')) {
        if (splitShown) {
          toggleSidebar();
        } else {
          showSplitView();
        }
        return;
      }

      // Normal icon click
      if (splitShown) {
        // Currently showing split → switch to single panel
        hideSplitView();
        switchPanel(panel);
      } else if (panel === activePanel) {
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
    if (headerPanel && splitConfig) {
      const draggedIsPrimary = headerPanel === splitConfig.primary;
      if ((draggedIsPrimary && !isTop) || (!draggedIsPrimary && isTop)) {
        swapSidebarSplit();
      }
      return;
    }

    // Case 2: Activity bar icon drag
    const panel = e.dataTransfer.getData('text/activity-panel');
    if (!panel) return;
    if (splitConfig && (panel === splitConfig.primary || panel === splitConfig.secondary)) return;

    if (splitConfig) {
      // Already has split config → replace secondary
      replaceSplitSecondary(panel, isTop);
    } else {
      // Create new split
      createSplit(panel, isTop);
    }
  });

  // ─── Panel header drag (for split rearranging) ───
  sidebar.addEventListener('dragstart', (e) => {
    const header = e.target.closest('.sidebar-header');
    if (!header || !splitConfig || !splitShown) return;
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
    if (!splitConfig || !splitShown) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const droppedOutside = e.clientX < sidebarRect.left || e.clientX > sidebarRect.right ||
                           e.clientY < sidebarRect.top || e.clientY > sidebarRect.bottom;
    if (droppedOutside) {
      destroySplit();
    }
  });

  // ─── Sidebar split resize handle ───
  initSidebarSplitResize();
}

// ─── Split Management ───

/** Create a new split configuration and show it */
function createSplit(panel, droppedOnTop) {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');

  const primary = droppedOnTop ? panel : activePanel;
  const secondary = droppedOnTop ? activePanel : panel;

  splitConfig = { primary, secondary, ratio: 0.5 };
  activePanel = primary;

  // Create split icon in activity bar, hide original icons
  createSplitButton(primary, secondary);

  // Show the split view
  showSplitView();
}

/** Show the split view (both panels stacked) */
function showSplitView() {
  if (!splitConfig) return;
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');
  splitShown = true;
  activePanel = splitConfig.primary;

  // Update activity bar: split icon active, others not
  document.querySelectorAll('.activity-btn').forEach(btn => {
    if (btn.classList.contains('activity-btn-split')) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Show both panels in split layout
  document.querySelectorAll('.sidebar-panel').forEach(p => {
    const id = p.id.replace('panel-', '');
    if (id === splitConfig.primary) {
      p.classList.add('active');
      p.classList.remove('sidebar-panel-secondary');
    } else if (id === splitConfig.secondary) {
      p.classList.add('active');
      p.classList.add('sidebar-panel-secondary');
    } else {
      p.classList.remove('active', 'sidebar-panel-secondary');
    }
  });

  sidebar.classList.add('sidebar-split');
  sidebar.style.setProperty('--sidebar-split-ratio', splitConfig.ratio);

  // Reorder DOM
  const primaryEl = document.getElementById(`panel-${splitConfig.primary}`);
  const secondaryEl = document.getElementById(`panel-${splitConfig.secondary}`);
  ensureSplitResizeHandle();
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  sidebar.insertBefore(primaryEl, sidebar.firstChild);
  primaryEl.after(resizeHandle);
  resizeHandle.after(secondaryEl);

  ensureSplitCloseBtn();
  setupSplitHeaderDrag();

  triggerPanelLoad(splitConfig.primary);
  triggerPanelLoad(splitConfig.secondary);
}

/** Hide the split view (without destroying split config) */
function hideSplitView() {
  if (!splitShown) return;
  const sidebar = document.getElementById('sidebar');

  // Save current ratio
  const computed = getComputedStyle(sidebar).getPropertyValue('--sidebar-split-ratio');
  if (splitConfig && computed) {
    splitConfig.ratio = parseFloat(computed);
  }

  // Clean up split DOM
  sidebar.querySelectorAll('.sidebar-header[draggable]').forEach(h => {
    h.removeAttribute('draggable');
  });
  sidebar.classList.remove('sidebar-split');
  sidebar.style.removeProperty('--sidebar-split-ratio');

  document.querySelectorAll('.sidebar-panel').forEach(p => {
    p.classList.remove('sidebar-panel-secondary', 'active');
  });

  const closeBtn = sidebar.querySelector('.sidebar-split-close');
  if (closeBtn) closeBtn.remove();
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  if (resizeHandle) resizeHandle.remove();

  // Deactivate split icon
  const splitBtn = document.querySelector('.activity-btn-split');
  if (splitBtn) splitBtn.classList.remove('active');

  splitShown = false;
}

/** Permanently destroy the split — remove split icon, restore original icons */
export function destroySplit() {
  hideSplitView();

  // Remove split button from activity bar
  const splitBtn = document.querySelector('.activity-btn-split');
  if (splitBtn) splitBtn.remove();

  // Restore original icons
  if (splitConfig) {
    const primaryBtn = document.querySelector(`.activity-btn[data-panel="${splitConfig.primary}"]`);
    const secondaryBtn = document.querySelector(`.activity-btn[data-panel="${splitConfig.secondary}"]`);
    if (primaryBtn) primaryBtn.style.display = '';
    if (secondaryBtn) secondaryBtn.style.display = '';
  }

  // Switch to primary panel
  const panel = splitConfig ? splitConfig.primary : activePanel;
  splitConfig = null;
  switchPanel(panel);
}

// Keep closeSidebarSplit as alias for destroySplit (used by close button)
export { destroySplit as closeSidebarSplit };

function swapSidebarSplit() {
  if (!splitConfig) return;
  const temp = splitConfig.primary;
  splitConfig.primary = splitConfig.secondary;
  splitConfig.secondary = temp;
  activePanel = splitConfig.primary;

  // Re-render the split view
  if (splitShown) {
    // Update panel classes
    document.querySelectorAll('.sidebar-panel').forEach(p => {
      const id = p.id.replace('panel-', '');
      if (id === splitConfig.primary) {
        p.classList.add('active');
        p.classList.remove('sidebar-panel-secondary');
      } else if (id === splitConfig.secondary) {
        p.classList.add('active');
        p.classList.add('sidebar-panel-secondary');
      } else {
        p.classList.remove('active', 'sidebar-panel-secondary');
      }
    });

    // Reorder DOM
    const sidebar = document.getElementById('sidebar');
    const primaryEl = document.getElementById(`panel-${splitConfig.primary}`);
    const secondaryEl = document.getElementById(`panel-${splitConfig.secondary}`);
    const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
    sidebar.insertBefore(primaryEl, sidebar.firstChild);
    primaryEl.after(resizeHandle);
    resizeHandle.after(secondaryEl);

    // Move close button
    const oldClose = sidebar.querySelector('.sidebar-split-close');
    if (oldClose) oldClose.remove();
    ensureSplitCloseBtn();
  }
}

function replaceSplitSecondary(newPanel, droppedOnTop) {
  if (!splitConfig) return;

  // Restore old secondary icon
  const oldSecBtn = document.querySelector(`.activity-btn[data-panel="${splitConfig.secondary}"]`);
  if (oldSecBtn) oldSecBtn.style.display = '';

  // Also restore old primary if it's changing
  if (droppedOnTop) {
    const oldPriBtn = document.querySelector(`.activity-btn[data-panel="${splitConfig.primary}"]`);
    if (oldPriBtn) oldPriBtn.style.display = '';
    splitConfig.secondary = splitConfig.primary;
    splitConfig.primary = newPanel;
  } else {
    splitConfig.secondary = newPanel;
  }
  activePanel = splitConfig.primary;

  // Hide new panel icon
  const newBtn = document.querySelector(`.activity-btn[data-panel="${newPanel}"]`);
  if (newBtn) newBtn.style.display = 'none';

  // Update split button
  const splitBtn = document.querySelector('.activity-btn-split');
  if (splitBtn) {
    splitBtn.remove();
  }
  createSplitButton(splitConfig.primary, splitConfig.secondary);

  if (splitShown) {
    // Remove old split DOM and re-show
    const sidebar = document.getElementById('sidebar');
    sidebar.querySelectorAll('.sidebar-header[draggable]').forEach(h => h.removeAttribute('draggable'));
    const closeBtn = sidebar.querySelector('.sidebar-split-close');
    if (closeBtn) closeBtn.remove();
    const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
    if (resizeHandle) resizeHandle.remove();
    splitShown = false;
    showSplitView();
  }
}

// ─── Split Button in Activity Bar ───

function createSplitButton(primary, secondary) {
  const bar = document.getElementById('activity-bar');

  // Hide original icons
  const primaryBtn = document.querySelector(`.activity-btn[data-panel="${primary}"]`);
  const secondaryBtn = document.querySelector(`.activity-btn[data-panel="${secondary}"]`);
  if (primaryBtn) primaryBtn.style.display = 'none';
  if (secondaryBtn) secondaryBtn.style.display = 'none';

  // Remove existing split button if any
  const existing = bar.querySelector('.activity-btn-split');
  if (existing) existing.remove();

  // Create split icon button
  const splitBtn = document.createElement('button');
  splitBtn.className = 'activity-btn activity-btn-split active';
  splitBtn.title = `${primaryBtn?.title || primary} + ${secondaryBtn?.title || secondary}`;
  splitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="3" y="3" width="18" height="8" rx="1.5"/>
    <rect x="3" y="13" width="18" height="8" rx="1.5"/>
  </svg>`;

  // Insert at the position of the first hidden button
  const insertRef = primaryBtn || secondaryBtn;
  if (insertRef) {
    bar.insertBefore(splitBtn, insertRef);
  } else {
    bar.appendChild(splitBtn);
  }

  // Click handler — delegated via initActivityBar's existing handler won't catch this
  // because it was created after forEach. Add directly.
  splitBtn.addEventListener('click', () => {
    if (splitShown) {
      toggleSidebar();
    } else {
      showSplitView();
    }
  });
}

// ─── Helpers ───

function ensureSplitResizeHandle() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar.querySelector('.sidebar-split-resize')) {
    const handle = document.createElement('div');
    handle.className = 'sidebar-split-resize';
    const primaryPanel = document.getElementById(`panel-${splitConfig.primary}`);
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
    destroySplit();
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
  if (splitShown) {
    hideSplitView();
  }

  activePanel = panel;

  // Update active button
  document.querySelectorAll('.activity-btn').forEach(btn => {
    if (btn.classList.contains('activity-btn-split')) {
      btn.classList.remove('active');
    } else {
      btn.classList.toggle('active', btn.dataset.panel === panel);
    }
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
