import {
  S,
  terminalMap,
  sessionMeta,
  sessionList,
  termWrapper,
  tabBar,
  dropOverlay,
  dzZones,
} from '../core/state.js';
import { activateSession } from './session.js';
import { wsSend } from '../core/websocket.js';

export function updateSplitPaneTitle(el, sessionId) {
  let titleEl = el.querySelector('.split-pane-title');
  if (!titleEl) {
    titleEl = document.createElement('div');
    titleEl.className = 'split-pane-title';
    titleEl.innerHTML =
      '<span class="spt-dot"></span><span class="spt-name"></span><span class="spt-path"></span>';
    el.insertBefore(titleEl, el.firstChild);
  }
  const meta = sessionMeta.get(sessionId) || {};
  const cwd = meta.cwd || '';
  const wtMatch = cwd.match(/\.claude\/worktrees\/([^/]+)/);
  const wtTag = wtMatch ? ` [${wtMatch[1]}]` : '';
  titleEl.querySelector('.spt-name').textContent = (meta.name || sessionId) + wtTag;
  titleEl.querySelector('.spt-path').textContent = cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : '';
}

export function renderSplitLayout(node, rect) {
  if (!S.splitRoot) return;
  if (node.type === 'pane') {
    const el = node.element;
    el.style.left = rect.left + '%';
    el.style.top = rect.top + '%';
    el.style.width = rect.width + '%';
    el.style.height = rect.height + '%';
    updateSplitPaneTitle(el, node.sessionId);
    return;
  }
  const { direction, ratio, children } = node;
  let r0, r1;
  if (direction === 'v') {
    r0 = { left: rect.left, top: rect.top, width: rect.width * ratio, height: rect.height };
    r1 = {
      left: rect.left + rect.width * ratio,
      top: rect.top,
      width: rect.width * (1 - ratio),
      height: rect.height,
    };
  } else {
    r0 = { left: rect.left, top: rect.top, width: rect.width, height: rect.height * ratio };
    r1 = {
      left: rect.left,
      top: rect.top + rect.height * ratio,
      width: rect.width,
      height: rect.height * (1 - ratio),
    };
  }
  renderSplitLayout(children[0], r0);
  renderSplitLayout(children[1], r1);
  attachDivider(
    node,
    direction === 'v'
      ? { left: rect.left + rect.width * ratio, top: rect.top, width: 0, height: rect.height }
      : { left: rect.left, top: rect.top + rect.height * ratio, width: rect.width, height: 0 },
    rect
  );
}

function attachDivider(node, pos, parentRect) {
  if (!node._divider) {
    const d = document.createElement('div');
    d.className = `split-divider split-divider-${node.direction}`;
    S.splitRoot.appendChild(d);
    node._divider = d;
    d.addEventListener('mousedown', (e) => startDividerDrag(e, node, parentRect));
  }
  const d = node._divider;
  if (node.direction === 'v') {
    d.style.left = pos.left + '%';
    d.style.top = pos.top + '%';
    d.style.height = pos.height + '%';
    d.style.width = '8px';
    d.style.marginLeft = '-4px';
    d.style.marginTop = '';
  } else {
    d.style.left = pos.left + '%';
    d.style.top = pos.top + '%';
    d.style.width = pos.width + '%';
    d.style.height = '8px';
    d.style.marginTop = '-4px';
    d.style.marginLeft = '';
  }
}

function startDividerDrag(e, node, parentRect) {
  e.preventDefault();
  node._divider.classList.add('dragging');
  const wrapRect = termWrapper.getBoundingClientRect();
  const parentSizePx =
    node.direction === 'v'
      ? (wrapRect.width * parentRect.width) / 100
      : (wrapRect.height * parentRect.height) / 100;
  const startRatio = node.ratio;
  const startPos = node.direction === 'v' ? e.clientX : e.clientY;

  const onMove = (ev) => {
    const delta = (node.direction === 'v' ? ev.clientX : ev.clientY) - startPos;
    node.ratio = Math.min(0.8, Math.max(0.2, startRatio + delta / parentSizePx));
    renderSplitLayout(S.layoutTree, { left: 0, top: 0, width: 100, height: 100 });
    refitAllPanes();
  };
  const onUp = () => {
    node._divider.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp, { once: true });
}

export function refitAllPanes() {
  if (!S.layoutTree || !S.splitRoot) return;
  terminalMap.forEach(({ fitAddon, div }) => {
    if (div.parentElement === S.splitRoot) {
      try {
        fitAddon.fit();
      } catch {}
    }
  });
}

export function enterSplitMode(existingSessionId) {
  if (S.splitRoot) return;
  S.splitRoot = document.createElement('div');
  S.splitRoot.id = 'split-root';
  termWrapper.appendChild(S.splitRoot);
  const entry = terminalMap.get(existingSessionId);
  if (entry) {
    entry.div.classList.remove('active');
    S.splitRoot.appendChild(entry.div);
  }
  tabBar.style.display = 'none';
}

export function collectPaneIds(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') {
    out.push(node.sessionId);
    return out;
  }
  collectPaneIds(node.children[0], out);
  collectPaneIds(node.children[1], out);
  return out;
}

export function updateSidebarSplitGroup() {
  const existing = sessionList.querySelector('.split-group');
  if (existing) {
    [...existing.querySelectorAll('.session-item')].forEach((el) => sessionList.appendChild(el));
    existing.remove();
  }
  if (!S.layoutTree) return;

  const paneIds = collectPaneIds(S.layoutTree);
  if (paneIds.length < 2) return;

  const group = document.createElement('div');
  group.className = 'split-group';
  group.innerHTML = `<div class="split-group-header"><span class="split-group-header-icon">⊞</span><span class="split-group-header-label">SPLIT</span><span class="split-group-badge">${paneIds.length}</span></div>`;

  paneIds.forEach((id) => {
    const entry = terminalMap.get(id);
    if (entry && entry.sidebarEl) group.appendChild(entry.sidebarEl);
  });

  sessionList.appendChild(group);
}

export function teardownSplitLayout() {
  if (!S.layoutTree) return;
  function removeDividers(node) {
    if (!node || node.type === 'pane') return;
    if (node._divider) {
      node._divider.remove();
      node._divider = null;
    }
    node.children.forEach(removeDividers);
  }
  removeDividers(S.layoutTree);
  S.layoutTree = null;
  if (S.splitRoot) {
    [...S.splitRoot.querySelectorAll('.term-pane')].forEach((div) => {
      div.classList.remove('split-active', 'split-inactive');
      termWrapper.appendChild(div);
    });
    S.splitRoot.remove();
    S.splitRoot = null;
  }
  tabBar.style.display = '';
  updateSidebarSplitGroup();
}

export function findPaneNode(node, sessionId) {
  if (!node) return null;
  if (node.type === 'pane') return node.sessionId === sessionId ? node : null;
  return findPaneNode(node.children[0], sessionId) || findPaneNode(node.children[1], sessionId);
}

export function findParentNode(tree, target, parent = null) {
  if (!tree) return null;
  if (tree === target) return parent;
  if (tree.type === 'split') {
    return (
      findParentNode(tree.children[0], target, tree) ||
      findParentNode(tree.children[1], target, tree)
    );
  }
  return null;
}

export function removeSplitPane(sessionId) {
  if (!S.layoutTree) return;
  const pane = findPaneNode(S.layoutTree, sessionId);
  if (!pane) return;
  pane.element.remove();

  const parent = findParentNode(S.layoutTree, pane);
  if (!parent) {
    teardownSplitLayout();
    return;
  }
  const sibling = parent.children.find((c) => c !== pane);
  if (parent._divider) {
    parent._divider.remove();
    parent._divider = null;
  }

  const grandParent = findParentNode(S.layoutTree, parent);
  if (!grandParent) {
    S.layoutTree = sibling;
  } else {
    const idx = grandParent.children.indexOf(parent);
    grandParent.children[idx] = sibling;
  }

  if (terminalMap.size <= 1) {
    teardownSplitLayout();
    const lastId = terminalMap.keys().next().value;
    if (lastId) {
      const lastEntry = terminalMap.get(lastId);
      if (lastEntry) lastEntry.div.classList.add('active');
      activateSession(lastId);
    }
  } else {
    renderSplitLayout(S.layoutTree, { left: 0, top: 0, width: 100, height: 100 });
    refitAllPanes();
  }
}

export function createSplitSession() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const wrappedResolve = (id) => {
      resolved = true;
      resolve(id);
    };
    S.pendingSplitQueue.push({ resolve: wrappedResolve });
    const currentMeta = S.activeSessionId ? sessionMeta.get(S.activeSessionId) : null;
    const baseName = currentMeta?.name || 'shell';
    wsSend({
      type: 'session_create',
      name: baseName,
      cmd: S.settings?.shell?.defaultShell || '',
      cwd: currentMeta?.cwd,
    });
    setTimeout(() => {
      if (!resolved) {
        S.pendingSplitQueue = S.pendingSplitQueue.filter((p) => p.resolve !== wrappedResolve);
        reject(new Error('split session timeout'));
      }
    }, 8000);
  });
}

export function showDropZoneOverlay() {
  const paneCount = terminalMap.size;
  if (paneCount >= 4) return;
  dropOverlay.classList.add('active');
  dropOverlay.querySelector('.dz-center').style.display = paneCount === 1 ? '' : 'none';
}

export function hideDropZoneOverlay() {
  dropOverlay.classList.remove('active');
  dzZones.forEach((z) => z.classList.remove('dz-hover'));
}

export function initSplitDnD() {
  dzZones.forEach((zone) => {
    zone.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/split-tab')) return;
      e.preventDefault();
      dzZones.forEach((z) => z.classList.remove('dz-hover'));
      zone.classList.add('dz-hover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dz-hover'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      hideDropZoneOverlay();
      const z = zone.dataset.zone;
      const existingId = S.activeSessionId;
      if (!existingId) return;

      if (z === 'center') {
        try {
          const [id1, id2, id3] = await Promise.all([
            createSplitSession(),
            createSplitSession(),
            createSplitSession(),
          ]);
          const existingEntry = terminalMap.get(existingId);
          if (!existingEntry) return;
          const existingPane = { type: 'pane', sessionId: existingId, element: existingEntry.div };
          const e1 = terminalMap.get(id1),
            e2 = terminalMap.get(id2),
            e3 = terminalMap.get(id3);
          if (!e1 || !e2 || !e3) return;
          const pane1 = { type: 'pane', sessionId: id1, element: e1.div };
          const pane2 = { type: 'pane', sessionId: id2, element: e2.div };
          const pane3 = { type: 'pane', sessionId: id3, element: e3.div };
          enterSplitMode(existingId);
          [pane1, pane2, pane3].forEach((p) => S.splitRoot.appendChild(p.element));
          S.layoutTree = {
            type: 'split',
            direction: 'h',
            ratio: 0.5,
            children: [
              { type: 'split', direction: 'v', ratio: 0.5, children: [existingPane, pane1] },
              { type: 'split', direction: 'v', ratio: 0.5, children: [pane2, pane3] },
            ],
          };
          renderSplitLayout(S.layoutTree, { left: 0, top: 0, width: 100, height: 100 });
          refitAllPanes();
          updateSidebarSplitGroup();
          activateSession(existingId);
        } catch (err) {
          console.error('4-way split failed', err);
        }
        return;
      }

      const dirMap = { left: 'v', right: 'v', top: 'h', bottom: 'h' };
      const direction = dirMap[z];
      try {
        const newId = await createSplitSession();
        const newEntry = terminalMap.get(newId);
        if (!newEntry) return;
        const newPane = { type: 'pane', sessionId: newId, element: newEntry.div };
        newPane.element.classList.add('split-inactive');

        const firstNew = z === 'left' || z === 'top';

        if (!S.layoutTree) {
          enterSplitMode(existingId);
          const existingEntry = terminalMap.get(existingId);
          if (!existingEntry) return;
          const existingPane = { type: 'pane', sessionId: existingId, element: existingEntry.div };
          S.layoutTree = {
            type: 'split',
            direction,
            ratio: 0.5,
            children: firstNew ? [newPane, existingPane] : [existingPane, newPane],
          };
        } else {
          const existingPane = findPaneNode(S.layoutTree, existingId);
          if (!existingPane) return;
          const parent = findParentNode(S.layoutTree, existingPane);
          const newNode = {
            type: 'split',
            direction,
            ratio: 0.5,
            children: firstNew ? [newPane, existingPane] : [existingPane, newPane],
          };
          if (!parent) {
            S.layoutTree = newNode;
          } else {
            const idx = parent.children.indexOf(existingPane);
            parent.children[idx] = newNode;
          }
        }
        S.splitRoot.appendChild(newPane.element);
        renderSplitLayout(S.layoutTree, { left: 0, top: 0, width: 100, height: 100 });
        refitAllPanes();
        updateSidebarSplitGroup();
        activateSession(newId);
      } catch (err) {
        console.error('split failed', err);
      }
    });
  });
}
