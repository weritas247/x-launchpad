import { S, terminalMap, sessionMeta, hdrCount, sessionEmpty, emptyState } from './state.js';
import { requestBranch } from './git-graph.js';
import { collectPaneIds, teardownSplitLayout } from './split-pane.js';
import { renderPanel as renderInputPanel } from './prompt-history.js';
import { deactivateAllFileTabs } from './file-viewer.js';

// Lazy-loaded callbacks to avoid circular imports
let _onSessionChangeSidePanels = null;
export function setOnSessionChangeSidePanels(fn) {
  _onSessionChangeSidePanels = fn;
}

export function activateSession(id) {
  if (!terminalMap.has(id)) return;
  S.activeSessionId = id;

  // Deactivate any open file tabs
  deactivateAllFileTabs();

  if (S.layoutTree === null) {
    terminalMap.forEach(({ div, tabEl }, sid) => {
      const a = sid === id;
      div.classList.toggle('active', a);
      tabEl.classList.toggle('active', a);
    });
  } else {
    const paneIds = collectPaneIds(S.layoutTree);
    if (!paneIds.includes(id)) {
      teardownSplitLayout();
      terminalMap.forEach(({ div, tabEl }, sid) => {
        const a = sid === id;
        div.classList.toggle('active', a);
        tabEl.classList.toggle('active', a);
      });
    } else {
      terminalMap.forEach(({ div, tabEl }, sid) => {
        const a = sid === id;
        div.classList.toggle('split-active', a);
        div.classList.toggle('split-inactive', !a);
        tabEl.classList.toggle('active', a);
      });
    }
  }

  const entry = terminalMap.get(id);
  if (entry) {
    entry.fitAddon.fit();
    entry.term.focus();
    const meta = sessionMeta.get(id);
    requestBranch(id);
  }
  updateStatusBar();
  renderInputPanel();
  if (_onSessionChangeSidePanels) _onSessionChangeSidePanels();
}

export function updateStatusBar() {
  const c = terminalMap.size;
  hdrCount.textContent = c;
  sessionEmpty.style.display = c === 0 ? 'block' : 'none';

  // Update project name in statusbar
  const meta = S.activeSessionId ? sessionMeta.get(S.activeSessionId) : null;
  const cwd = meta?.cwd;
  const el = document.getElementById('sb-project');
  const nameEl = document.getElementById('sb-project-name');
  const sepEl = document.getElementById('sb-project-sep');
  if (cwd) {
    const parts = cwd.replace(/\/$/, '').split('/');
    nameEl.textContent = parts[parts.length - 1] || '~';
    el.style.display = '';
    sepEl.style.display = '';
  } else {
    el.style.display = 'none';
    sepEl.style.display = 'none';
  }
}

export function showEmptyState() {
  emptyState.style.display = 'flex';
}
export function hideEmptyState() {
  emptyState.style.display = 'none';
}
