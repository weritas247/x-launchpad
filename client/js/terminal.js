import { S, terminalMap, sessionMeta, sessionList, sessionEmpty, tabBar, tabAddBtn, termWrapper, sbActiveName, sbSize, ctxMenu, escHtml } from './state.js';
import { AI_REGISTRY } from './constants.js';
import { wsSend } from './websocket.js';
import { activateSession, updateStatusBar, showEmptyState, hideEmptyState } from './session.js';
import { removeSplitPane, teardownSplitLayout, showDropZoneOverlay, hideDropZoneOverlay } from './split-pane.js';

export function newSession() {
  showSessionPicker();
}

export function showSessionPicker() {
  document.getElementById('session-picker').style.display = 'flex';
}

export function hideSessionPicker() {
  document.getElementById('session-picker').style.display = 'none';
}

export function closeSession(id) {
  wsSend({ type: 'session_close', sessionId: id });
  const entry = terminalMap.get(id);
  if (entry) {
    entry.term.dispose();
    entry.tabEl.remove();
    entry.sidebarEl.remove();
    terminalMap.delete(id);

    if (S.layoutTree !== null) {
      removeSplitPane(id);
    } else {
      entry.div.remove();
    }
  }
  sessionMeta.delete(id);
  if (S.activeSessionId === id) {
    S.activeSessionId = null;
    const first = terminalMap.keys().next().value;
    if (first) {
      activateSession(first);
      wsSend({ type:'session_attach', sessionId: first });
    } else {
      showEmptyState();
    }
  }
  updateStatusBar();
}

export function renameSession(id, newName) {
  const meta = sessionMeta.get(id);
  if (!meta) return;
  meta.name = newName;
  wsSend({ type: 'session_rename', sessionId: id, name: newName });
  const entry = terminalMap.get(id);
  if (entry) {
    entry.sidebarEl.querySelector('.session-name').textContent = newName;
    entry.tabEl.querySelector('.tab-name').textContent = newName;
  }
  if (S.activeSessionId === id) sbActiveName.textContent = newName;
}

export function syncSessionList(sessions, isReconnect = false) {
  if (isReconnect && S.layoutTree !== null) teardownSplitLayout();

  const isInitialLoad = terminalMap.size === 0 && sessions.length > 0;

  const newIds = [];
  sessions.forEach(s => {
    if (!sessionMeta.has(s.id)) {
      sessionMeta.set(s.id, { name: s.name, createdAt: s.createdAt });
      attachTerminal(s.id, s.name);
      newIds.push(s.id);
    }
  });
  if (newIds.length > 0) {
    wsSend({ type: 'session_subscribe', sessionIds: newIds });
    setTimeout(() => {
      newIds.forEach(id => {
        const e = terminalMap.get(id);
        if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:id, cols:e.term.cols, rows:e.term.rows }); }
      });
    }, 100);
  }

  if (!S.activeSessionId && terminalMap.size > 0) {
    const firstId = terminalMap.keys().next().value;
    activateSession(firstId);
    wsSend({ type: 'session_attach', sessionId: firstId });
    setTimeout(() => {
      const e = terminalMap.get(firstId);
      if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:firstId, cols:e.term.cols, rows:e.term.rows }); }
    }, 50);

    if (isInitialLoad) {
      const badge = document.getElementById('hdr-restore-badge');
      if (badge) {
        badge.style.display = '';
        setTimeout(() => { badge.style.display = 'none'; }, 2000);
      }
      const e = terminalMap.get(firstId);
      if (e) {
        e.term.write('\r\n\x1b[36m  ⟳ Restoring session...\x1b[0m\r\n\r\n');
      }
    }
  }
  updateStatusBar();
}

export function attachTerminal(sessionId, name) {
  if (terminalMap.has(sessionId)) return;
  sessionMeta.set(sessionId, { name, createdAt: Date.now() });

  const div = document.createElement('div');
  div.className = 'term-pane';
  div.dataset.sessionId = sessionId;
  const container = (S.layoutTree !== null && S.splitRoot) ? S.splitRoot : termWrapper;
  container.appendChild(div);

  const term = new Terminal({
    cursorBlink: S.settings?.appearance?.cursorBlink !== false,
    cursorStyle: S.settings?.appearance?.cursorStyle || 'block',
    fontSize: S.settings?.appearance?.fontSize || 14,
    lineHeight: S.settings?.appearance?.lineHeight || 1.2,
    fontFamily: S.settings?.appearance?.fontFamily || '"JetBrains Mono","Share Tech Mono",monospace',
    theme: S.currentTheme.term,
    scrollback: S.settings?.terminal?.scrollback || 5000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(div);
  fitAddon.fit();

  term.onData(data => {
    if (S.activeSessionId === sessionId) wsSend({ type:'input', sessionId, data });
  });

  term.onResize(({ cols, rows }) => {
    wsSend({ type:'resize', sessionId, cols, rows });
    if (S.activeSessionId === sessionId) sbSize.textContent = `${cols}×${rows}`;
  });

  div.addEventListener('contextmenu', async (e) => {
    if (S.settings?.terminal?.rightClickPaste) {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (text) wsSend({ type:'input', sessionId, data: text });
      } catch {}
    }
  });

  div.addEventListener('mousedown', () => {
    if (S.layoutTree !== null) activateSession(sessionId);
  });

  const sidebarEl = createSidebarItem(sessionId, name);
  const tabEl = createTab(sessionId, name);

  terminalMap.set(sessionId, { term, fitAddon, div, tabEl, sidebarEl });
  hideEmptyState();
  updateStatusBar();
}

export function createSidebarItem(sessionId, name) {
  const el = document.createElement('div');
  el.className = 'session-item';
  el.dataset.sessionId = sessionId;
  el.innerHTML = `
    <span class="session-icon">❯</span>
    <div class="session-info">
      <div class="session-name">${escHtml(name)}</div>
      <div class="session-meta">
        <div class="session-cwd" data-cwd>~</div>
      </div>
    </div>
    <button class="session-close">✕</button>
  `;
  el.addEventListener('click', e => {
    if (e.target.closest('.session-close')) { closeSession(sessionId); return; }
    activateSession(sessionId);
    wsSend({ type:'session_attach', sessionId });
  });
  el.addEventListener('contextmenu', e => showCtxMenu(e, sessionId));
  makeSidebarItemDraggable(el, sessionId);
  sessionEmpty.style.display = 'none';
  sessionList.appendChild(el);
  return el;
}

export function updateSessionInfo(sessionId, cwd, ai) {
  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  let shortCwd = cwd || '~';
  const parts = shortCwd.replace(/\/$/, '').split('/');
  if (parts.length > 3) shortCwd = '…/' + parts.slice(-2).join('/');

  const cwdEl = entry.sidebarEl.querySelector('[data-cwd]');
  if (cwdEl) cwdEl.textContent = shortCwd;

  let badgeEl = entry.sidebarEl.querySelector('.session-ai-badge');
  const metaEl = entry.sidebarEl.querySelector('.session-meta');
  if (ai) {
    const reg = AI_REGISTRY[ai];
    const def = reg
      ? { icon: `<img src="${reg.icon}" class="badge-img" alt="${reg.label}">`, label: reg.label }
      : { icon: '🤖', label: ai };
    if (!badgeEl) {
      badgeEl = document.createElement('div');
      metaEl.appendChild(badgeEl);
    }
    badgeEl.className = 'session-ai-badge';
    badgeEl.dataset.ai = ai;
    if (reg) {
      badgeEl.style.setProperty('--badge-rgb', reg.rgb.join(','));
      badgeEl.style.setProperty('--badge-color', reg.color);
    }
    badgeEl.innerHTML = `<span class="badge-icon">${def.icon}</span>${def.label}`;
  } else if (badgeEl) {
    badgeEl.remove();
  }

  const tabNameEl = entry.tabEl.querySelector('.tab-name');
  const meta = sessionMeta.get(sessionId);
  const baseName = meta ? meta.name : sessionId;
  tabNameEl.textContent = `${baseName}  ${shortCwd}`;

  if (S.activeSessionId === sessionId) {
    sbActiveName.textContent = `${baseName}  ${shortCwd}${ai ? `  [${ai}]` : ''}`;
  }

  const metaObj = sessionMeta.get(sessionId);
  if (metaObj) { metaObj.cwd = cwd; if (ai) metaObj.ai = ai; }

  if (S.layoutTree !== null) {
    const titleEl = entry.div.querySelector('.split-pane-title');
    if (titleEl) {
      titleEl.querySelector('.spt-name').textContent = baseName;
      titleEl.querySelector('.spt-path').textContent = shortCwd;
    }
  }
}

export function createTab(sessionId, name) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.dataset.sessionId = sessionId;
  el.innerHTML = `
    <div class="tab-indicator"></div>
    <span class="tab-name">${escHtml(name)}</span>
    <button class="tab-close-btn">✕</button>
  `;
  el.addEventListener('click', e => {
    if (e.target.closest('.tab-close-btn')) { closeSession(sessionId); return; }
    activateSession(sessionId);
    wsSend({ type:'session_attach', sessionId });
  });

  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/tab-session', sessionId);
    e.dataTransfer.setData('text/split-tab', sessionId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      el.classList.add('dragging');
      showDropZoneOverlay();
    }, 0);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    document.querySelectorAll('.tab.drag-over').forEach(t => t.classList.remove('drag-over'));
    hideDropZoneOverlay();
  });
  el.addEventListener('dragover', e => {
    e.preventDefault();
    const src = e.dataTransfer.types.includes('text/tab-session');
    if (src && e.currentTarget !== document.querySelector('.tab.dragging')) {
      document.querySelectorAll('.tab.drag-over').forEach(t => t.classList.remove('drag-over'));
      el.classList.add('drag-over');
    }
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    const srcId = e.dataTransfer.getData('text/tab-session');
    el.classList.remove('drag-over');
    if (srcId && srcId !== sessionId) {
      const srcEl = tabBar.querySelector(`[data-session-id="${srcId}"]`);
      if (srcEl) {
        const tabs = [...tabBar.querySelectorAll('.tab')];
        const srcIdx = tabs.indexOf(srcEl);
        const tgtIdx = tabs.indexOf(el);
        if (srcIdx < tgtIdx) tabBar.insertBefore(srcEl, el.nextSibling);
        else tabBar.insertBefore(srcEl, el);
      }
    }
  });

  tabBar.insertBefore(el, tabAddBtn);
  return el;
}

function showCtxMenu(e, sessionId) {
  e.preventDefault();
  S.ctxTargetId = sessionId;
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top  = e.clientY + 'px';
  ctxMenu.classList.add('visible');
}

export function makeSidebarItemDraggable(el, sessionId) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/sidebar-session', sessionId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.style.opacity = '0.4', 0);
  });
  el.addEventListener('dragend', () => {
    el.style.opacity = '';
    document.querySelectorAll('.folder-item.drag-over').forEach(f => f.classList.remove('drag-over'));
    document.getElementById('session-list').classList.remove('drag-over-root');
  });
}

export function initContextMenu() {
  document.addEventListener('click', () => ctxMenu.classList.remove('visible'));
  document.getElementById('ctx-rename').addEventListener('click', () => {
    if (!S.ctxTargetId) return;
    const entry = terminalMap.get(S.ctxTargetId);
    if (!entry) return;
    const nameEl = entry.sidebarEl.querySelector('.session-name');
    const old = nameEl.textContent;
    const input = document.createElement('input');
    input.className = 'session-name-input';
    input.value = old;
    nameEl.replaceWith(input);
    input.focus(); input.select();
    const finish = () => {
      const n = input.value.trim() || old;
      const span = document.createElement('div');
      span.className = 'session-name';
      span.textContent = n;
      input.replaceWith(span);
      renameSession(S.ctxTargetId, n);
    };
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { finish(); e.preventDefault(); }
      if (e.key === 'Escape') { input.value = old; finish(); }
    });
  });
  document.getElementById('ctx-close').addEventListener('click', () => {
    if (S.ctxTargetId) closeSession(S.ctxTargetId);
  });
}
