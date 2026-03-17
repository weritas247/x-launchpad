import { S, terminalMap, sessionMeta, sbActiveName, sbCount, sbSize, hdrCount, sessionEmpty, emptyState } from './state.js';
import { requestBranch } from './git-graph.js';
import { collectPaneIds, teardownSplitLayout } from './split-pane.js';
import { renderPanel as renderInputPanel } from './input-panel.js';

// Lazy-loaded callbacks to avoid circular imports
let _onSessionChangeSidePanels = null;
export function setOnSessionChangeSidePanels(fn) { _onSessionChangeSidePanels = fn; }

export function activateSession(id) {
  if (!terminalMap.has(id)) return;
  S.activeSessionId = id;

  if (S.layoutTree === null) {
    terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
      const a = sid === id;
      div.classList.toggle('active', a);
      tabEl.classList.toggle('active', a);
      sidebarEl.classList.toggle('active', a);
    });
  } else {
    const paneIds = collectPaneIds(S.layoutTree);
    if (!paneIds.includes(id)) {
      teardownSplitLayout();
      terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
        const a = sid === id;
        div.classList.toggle('active', a);
        tabEl.classList.toggle('active', a);
        sidebarEl.classList.toggle('active', a);
      });
    } else {
      terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
        const a = sid === id;
        div.classList.toggle('split-active', a);
        div.classList.toggle('split-inactive', !a);
        tabEl.classList.toggle('active', a);
        sidebarEl.classList.toggle('active', a);
      });
    }
  }

  const entry = terminalMap.get(id);
  if (entry) {
    entry.fitAddon.fit();
    entry.term.focus();
    const meta = sessionMeta.get(id);
    sbActiveName.textContent = meta ? meta.name : id;
    sbSize.textContent = `${entry.term.cols}×${entry.term.rows}`;
    requestBranch(id);
  }
  updateStatusBar();
  renderInputPanel();
  if (_onSessionChangeSidePanels) _onSessionChangeSidePanels();
}

export function updateStatusBar() {
  const c = terminalMap.size;
  sbCount.textContent = c;
  hdrCount.textContent = c;
  sessionEmpty.style.display = c === 0 ? 'block' : 'none';
}

export function showEmptyState()  { emptyState.style.display = 'flex'; sbActiveName.textContent='—'; sbSize.textContent='—'; }
export function hideEmptyState()  { emptyState.style.display = 'none'; }
