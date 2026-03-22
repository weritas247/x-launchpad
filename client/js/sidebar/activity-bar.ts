// ─── ACTIVITY BAR (LEFT ICON BAR) ────────────────────────────────
import { requestFileTree } from './explorer';
import { requestGitStatus, startScPoll, stopScPoll } from './source-control';
import { requestClaudeDir } from './claude-panel';
import { refitAllPanes } from '../terminal/split-pane';

const ICON_ORDER_KEY = 'x-launchpad-activity-order';

let activePanel = 'source-control';
const splits = []; // [{ id, primary, secondary, ratio, btnEl }]
let activeSplitId = null; // currently shown split's id (null = single panel view)
let splitIdCounter = 0;
let dragSrcBtn = null;

/** Find which split (if any) contains a given panel */
function findSplitByPanel(panel) {
  return splits.find((s) => s.primary === panel || s.secondary === panel);
}

function saveIconOrder() {
  const bar = document.getElementById('activity-bar');
  const order = [...bar.querySelectorAll('.activity-btn[data-panel]')].map((b) => (b as HTMLElement).dataset.panel);
  try {
    localStorage.setItem(ICON_ORDER_KEY, JSON.stringify(order));
  } catch {}
}

function restoreIconOrder() {
  try {
    const saved = JSON.parse(localStorage.getItem(ICON_ORDER_KEY));
    if (!Array.isArray(saved) || saved.length === 0) return;
    const bar = document.getElementById('activity-bar');
    const btnMap = {};
    bar.querySelectorAll('.activity-btn[data-panel]').forEach((b) => {
      btnMap[(b as HTMLElement).dataset.panel] = b;
    });
    // Reorder: append in saved order
    for (const panel of saved) {
      if (btnMap[panel]) bar.appendChild(btnMap[panel]);
    }
    // Append any remaining buttons not in saved order
    Object.keys(btnMap).forEach((p) => {
      if (!saved.includes(p)) bar.appendChild(btnMap[p]);
    });
  } catch {}
}

export function initActivityBar() {
  restoreIconOrder();

  // Activate the first icon's panel on startup
  const firstBtn = document.querySelector('#activity-bar .activity-btn[data-panel]');
  if (firstBtn) {
    const firstPanel = (firstBtn as HTMLElement).dataset.panel;
    activePanel = firstPanel;
    // Update active states
    document.querySelectorAll('.activity-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.panel === firstPanel);
    });
    document.querySelectorAll('.sidebar-panel').forEach((p) => {
      p.classList.toggle('active', p.id === `panel-${firstPanel}`);
    });
    triggerPanelLoad(firstPanel);
  }

  const buttons = document.querySelectorAll('.activity-btn');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = (btn as HTMLElement).dataset.panel;

      // Split button click
      const splitId = (btn as HTMLElement).dataset.splitId;
      if (splitId) {
        const split = splits.find((s) => s.id === splitId);
        if (!split) return;
        if (activeSplitId === splitId) {
          toggleSidebar();
        } else {
          showSplitView(splitId);
        }
        return;
      }

      // Normal icon click
      if (activeSplitId) {
        // Currently showing a split → switch to single panel
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
      (e as DragEvent).dataTransfer.effectAllowed = 'move';
      (e as DragEvent).dataTransfer.setData('text/activity-panel', (btn as HTMLElement).dataset.panel);
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      dragSrcBtn = null;
      document
        .querySelectorAll('.activity-btn')
        .forEach((b) => b.classList.remove('drag-over-top', 'drag-over-bottom'));
      clearSidebarDropZones();
    });

    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragSrcBtn || dragSrcBtn === btn) return;
      (e as DragEvent).dataTransfer.dropEffect = 'move';
      const rect = btn.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      btn.classList.toggle('drag-over-top', (e as DragEvent).clientY < midY);
      btn.classList.toggle('drag-over-bottom', (e as DragEvent).clientY >= midY);
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
      if ((e as DragEvent).clientY < midY) {
        bar.insertBefore(dragSrcBtn, btn);
      } else {
        bar.insertBefore(dragSrcBtn, btn.nextSibling);
      }
      saveIconOrder();
    });
  });

  // ─── Sidebar as drop target ───
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
    if (!sidebar.contains(e.relatedTarget as Node)) {
      clearSidebarDropZones();
    }
  });

  sidebar.addEventListener('drop', (e) => {
    e.preventDefault();
    const isTop = sidebar.classList.contains('drag-zone-top');
    clearSidebarDropZones();

    // Case 1: Header drag → swap within active split
    const headerPanel = e.dataTransfer.getData('text/sidebar-panel');
    if (headerPanel && activeSplitId) {
      const split = splits.find((s) => s.id === activeSplitId);
      if (!split) return;
      const draggedIsPrimary = headerPanel === split.primary;
      if ((draggedIsPrimary && !isTop) || (!draggedIsPrimary && isTop)) {
        swapActiveSplit();
      }
      return;
    }

    // Case 2: Activity bar icon drag → create new split
    const panel = e.dataTransfer.getData('text/activity-panel');
    if (!panel) return;

    // Can't split a panel that's already in a split
    if (findSplitByPanel(panel)) return;

    // Determine which panel is currently shown as the "other half"
    let otherPanel;
    if (activeSplitId) {
      // Currently showing a split — can't create another from it
      return;
    } else {
      otherPanel = activePanel;
    }

    // Can't split with itself or if other is already in a split
    if (panel === otherPanel) return;
    if (findSplitByPanel(otherPanel)) return;

    const primary = isTop ? panel : otherPanel;
    const secondary = isTop ? otherPanel : panel;
    createSplit(primary, secondary);
  });

  // ─── Panel header drag (for split rearranging) ───
  sidebar.addEventListener('dragstart', (e) => {
    const header = (e.target as HTMLElement).closest('.sidebar-header');
    if (!header || !activeSplitId) return;
    const panel = header.closest('.sidebar-panel');
    if (!panel) return;
    const panelId = panel.id.replace('panel-', '');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/sidebar-panel', panelId);
    header.classList.add('dragging');
  });

  sidebar.addEventListener('dragend', (e) => {
    const header = (e.target as HTMLElement).closest('.sidebar-header');
    if (!header) return;
    header.classList.remove('dragging');
    clearSidebarDropZones();

    if (e.dataTransfer.dropEffect !== 'none') return;
    if (!activeSplitId) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const droppedOutside =
      e.clientX < sidebarRect.left ||
      e.clientX > sidebarRect.right ||
      e.clientY < sidebarRect.top ||
      e.clientY > sidebarRect.bottom;
    if (droppedOutside) {
      destroySplit(activeSplitId);
    }
  });

  initSidebarSplitResize();
}

// ─── Split Management ───

function createSplit(primary, secondary) {
  const id = 'split-' + ++splitIdCounter;
  const split = { id, primary, secondary, ratio: 0.5, btnEl: null };
  splits.push(split);

  // Create split button in activity bar
  createSplitButton(split);

  // Show the split view
  showSplitView(id);
}

function showSplitView(splitId) {
  const split = splits.find((s) => s.id === splitId);
  if (!split) return;

  // Hide any currently shown split first
  if (activeSplitId && activeSplitId !== splitId) {
    hideSplitView();
  }

  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');
  activeSplitId = splitId;
  activePanel = split.primary;

  // Update activity bar: this split's button active, all others not
  document.querySelectorAll('.activity-btn').forEach((btn) => {
    if ((btn as HTMLElement).dataset.splitId === splitId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Show both panels in split layout
  document.querySelectorAll('.sidebar-panel').forEach((p) => {
    const id = p.id.replace('panel-', '');
    if (id === split.primary) {
      p.classList.add('active');
      p.classList.remove('sidebar-panel-secondary');
    } else if (id === split.secondary) {
      p.classList.add('active');
      p.classList.add('sidebar-panel-secondary');
    } else {
      p.classList.remove('active', 'sidebar-panel-secondary');
    }
  });

  sidebar.classList.add('sidebar-split');
  sidebar.style.setProperty('--sidebar-split-ratio', String(split.ratio));

  // Reorder DOM
  const primaryEl = document.getElementById(`panel-${split.primary}`);
  const secondaryEl = document.getElementById(`panel-${split.secondary}`);
  ensureSplitResizeHandle(split);
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  sidebar.insertBefore(primaryEl, sidebar.firstChild);
  primaryEl.after(resizeHandle);
  resizeHandle.after(secondaryEl);

  ensureSplitCloseBtn(splitId);
  setupSplitHeaderDrag();

  triggerPanelLoad(split.primary);
  triggerPanelLoad(split.secondary);
}

function hideSplitView() {
  if (!activeSplitId) return;
  const sidebar = document.getElementById('sidebar');
  const split = splits.find((s) => s.id === activeSplitId);

  // Save current ratio
  if (split) {
    const computed = getComputedStyle(sidebar).getPropertyValue('--sidebar-split-ratio');
    if (computed) split.ratio = parseFloat(computed);
  }

  // Clean up split DOM
  sidebar.querySelectorAll('.sidebar-header[draggable]').forEach((h) => {
    h.removeAttribute('draggable');
  });
  sidebar.classList.remove('sidebar-split');
  sidebar.style.removeProperty('--sidebar-split-ratio');

  document.querySelectorAll('.sidebar-panel').forEach((p) => {
    p.classList.remove('sidebar-panel-secondary', 'active');
  });

  const closeBtn = sidebar.querySelector('.sidebar-split-close');
  if (closeBtn) closeBtn.remove();
  const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
  if (resizeHandle) resizeHandle.remove();

  // Deactivate split button
  const splitBtn = document.querySelector(`.activity-btn[data-split-id="${activeSplitId}"]`);
  if (splitBtn) splitBtn.classList.remove('active');

  activeSplitId = null;
}

function destroySplit(splitId) {
  const idx = splits.findIndex((s) => s.id === splitId);
  if (idx === -1) return;
  const split = splits[idx];

  // If this split is shown, hide it first
  if (activeSplitId === splitId) {
    hideSplitView();
  }

  // Remove split button
  if (split.btnEl) split.btnEl.remove();

  // Restore original icons
  const primaryBtn = document.querySelector(`.activity-btn[data-panel="${split.primary}"]`);
  const secondaryBtn = document.querySelector(`.activity-btn[data-panel="${split.secondary}"]`);
  if (primaryBtn) (primaryBtn as HTMLElement).style.display = '';
  if (secondaryBtn) (secondaryBtn as HTMLElement).style.display = '';

  // Remove from array
  splits.splice(idx, 1);

  // Show primary panel
  switchPanel(split.primary);
}

// Keep closeSidebarSplit for compatibility
export function closeSidebarSplit() {
  if (activeSplitId) {
    destroySplit(activeSplitId);
  }
}

function swapActiveSplit() {
  const split = splits.find((s) => s.id === activeSplitId);
  if (!split) return;
  const temp = split.primary;
  split.primary = split.secondary;
  split.secondary = temp;
  activePanel = split.primary;

  if (activeSplitId) {
    document.querySelectorAll('.sidebar-panel').forEach((p) => {
      const id = p.id.replace('panel-', '');
      if (id === split.primary) {
        p.classList.add('active');
        p.classList.remove('sidebar-panel-secondary');
      } else if (id === split.secondary) {
        p.classList.add('active');
        p.classList.add('sidebar-panel-secondary');
      } else {
        p.classList.remove('active', 'sidebar-panel-secondary');
      }
    });

    const sidebar = document.getElementById('sidebar');
    const primaryEl = document.getElementById(`panel-${split.primary}`);
    const secondaryEl = document.getElementById(`panel-${split.secondary}`);
    const resizeHandle = sidebar.querySelector('.sidebar-split-resize');
    sidebar.insertBefore(primaryEl, sidebar.firstChild);
    primaryEl.after(resizeHandle);
    resizeHandle.after(secondaryEl);

    const oldClose = sidebar.querySelector('.sidebar-split-close');
    if (oldClose) oldClose.remove();
    ensureSplitCloseBtn(activeSplitId);
  }
}

// ─── Split Button in Activity Bar ───

function createSplitButton(split) {
  const bar = document.getElementById('activity-bar');

  // Hide original icons
  const primaryBtn = document.querySelector(`.activity-btn[data-panel="${split.primary}"]`);
  const secondaryBtn = document.querySelector(`.activity-btn[data-panel="${split.secondary}"]`);
  if (primaryBtn) (primaryBtn as HTMLElement).style.display = 'none';
  if (secondaryBtn) (secondaryBtn as HTMLElement).style.display = 'none';

  // Create split icon button
  const splitBtn = document.createElement('button');
  splitBtn.className = 'activity-btn activity-btn-split';
  splitBtn.dataset.splitId = split.id;
  splitBtn.title = `${(primaryBtn as HTMLElement)?.title || split.primary} + ${(secondaryBtn as HTMLElement)?.title || split.secondary}`;
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

  // Click handler
  splitBtn.addEventListener('click', () => {
    if (activeSplitId === split.id) {
      toggleSidebar();
    } else {
      showSplitView(split.id);
    }
  });

  split.btnEl = splitBtn;
}

// ─── Helpers ───

function ensureSplitResizeHandle(split) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar.querySelector('.sidebar-split-resize')) {
    const handle = document.createElement('div');
    handle.className = 'sidebar-split-resize';
    const primaryPanel = document.getElementById(`panel-${split.primary}`);
    if (primaryPanel && primaryPanel.nextSibling) {
      sidebar.insertBefore(handle, primaryPanel.nextSibling);
    } else {
      sidebar.appendChild(handle);
    }
  }
}

function ensureSplitCloseBtn(splitId) {
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
    destroySplit(splitId);
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
  sidebar.querySelectorAll('.sidebar-panel.active .sidebar-header').forEach((header) => {
    header.setAttribute('draggable', 'true');
  });
}

function initSidebarSplitResize() {
  const sidebar = document.getElementById('sidebar');
  let startY = 0,
    startRatio = 0.5;

  sidebar.addEventListener('mousedown', (e) => {
    if (!(e.target as HTMLElement).classList.contains('sidebar-split-resize')) return;
    e.preventDefault();
    startY = e.clientY;
    const computed = getComputedStyle(sidebar).getPropertyValue('--sidebar-split-ratio');
    startRatio = computed ? parseFloat(computed) : 0.5;
    (e.target as HTMLElement).classList.add('dragging');

    const onMove = (ev) => {
      const rect = sidebar.getBoundingClientRect();
      const deltaRatio = (ev.clientY - startY) / rect.height;
      const newRatio = Math.max(0.15, Math.min(0.85, startRatio + deltaRatio));
      sidebar.style.setProperty('--sidebar-split-ratio', String(newRatio));
    };

    const onUp = () => {
      (e.target as HTMLElement).classList.remove('dragging');
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
    stopScPoll();
  } else if (panel === 'source-control') {
    requestGitStatus();
    startScPoll();
  } else if (panel === 'search') {
    document.getElementById('search-input')?.focus();
    stopScPoll();
  } else if (panel === 'claude') {
    requestClaudeDir();
    stopScPoll();
  } else {
    stopScPoll();
  }
}

export function switchPanel(panel) {
  if (activeSplitId) {
    hideSplitView();
  }

  activePanel = panel;

  // Update active button
  document.querySelectorAll('.activity-btn').forEach((btn) => {
    if ((btn as HTMLElement).dataset.splitId) {
      btn.classList.remove('active');
    } else {
      btn.classList.toggle('active', (btn as HTMLElement).dataset.panel === panel);
    }
  });

  // Update visible panel
  document.querySelectorAll('.sidebar-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${panel}`);
  });

  const sidebar = document.getElementById('sidebar');
  sidebar.classList.remove('collapsed');

  triggerPanelLoad(panel);
  // Refit terminals after grid layout change
  setTimeout(() => refitAllPanes(), 50);
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  // Refit terminals after grid layout change
  setTimeout(() => refitAllPanes(), 50);
}

export { toggleSidebar as toggleSidebarExport };

// ─── Sidebar resize ───
export function initSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  if (!handle) return;
  let startX = 0,
    startW = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 240;
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

export function setActivityBadge(panel, count, opts?) {
  const btn = document.querySelector(`.activity-btn[data-panel="${panel}"]`);
  if (!btn) return;

  // Remove existing badges
  btn.querySelectorAll('.activity-badge, .activity-badge-group').forEach((el) => el.remove());

  const total =
    opts && opts.mainCount !== null && opts.mainCount !== undefined
      ? count + opts.mainCount
      : count;
  if (total <= 0) return;

  // Dual badge: worktree + main branch
  if (opts && opts.isInWorktree && opts.mainCount !== null && opts.mainCount !== undefined) {
    const group = document.createElement('span');
    group.className = 'activity-badge-group';

    if (opts.mainCount > 0) {
      const mainBadge = document.createElement('span');
      mainBadge.className = 'activity-badge activity-badge-main';
      mainBadge.textContent = opts.mainCount > 99 ? '99+' : opts.mainCount;
      mainBadge.title = 'main branch';
      group.appendChild(mainBadge);
    }

    if (count > 0) {
      const wtBadge = document.createElement('span');
      wtBadge.className = 'activity-badge activity-badge-wt';
      wtBadge.textContent = count > 99 ? '99+' : count;
      wtBadge.title = 'worktree';
      group.appendChild(wtBadge);
    }

    btn.appendChild(group);
  } else {
    // Single badge (default)
    const badge = document.createElement('span');
    badge.className = 'activity-badge';
    badge.textContent = count > 99 ? '99+' : count;
    btn.appendChild(badge);
  }
}
