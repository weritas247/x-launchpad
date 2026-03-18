import { S, terminalMap, sessionMeta, sessionList, sessionEmpty, tabBar, tabAddBtn, termWrapper, sbActiveName, sbSize, ctxMenu, escHtml } from './state.js';
import { AI_REGISTRY } from './constants.js';
import { wsSend } from './websocket.js';
import { xtermKeyHandler } from './keyboard.js';
import { trackInput } from './input-panel.js';
import { activateSession, updateStatusBar, showEmptyState, hideEmptyState } from './session.js';
import { removeSplitPane, teardownSplitLayout, showDropZoneOverlay, hideDropZoneOverlay } from './split-pane.js';
import { resetTabStatus, tabStatusOnInput } from './tab-status.js';
import { setupTerminalImageHandlers, hasPendingAttachments, uploadAndFlush } from './image-attach.js';
import { destroyStream, bypassStream, unbypassStream } from './stream-writer.js';

export function newSession() {
  showSessionPicker();
}

let spFocusIdx = -1;
let spAbort = null;

function getSpButtons() {
  return Array.from(document.querySelectorAll('.sp-grid .sp-btn'));
}

function updateSpFocus(btns, idx) {
  btns.forEach(b => b.classList.remove('sp-focused'));
  spFocusIdx = idx;
  if (idx >= 0 && idx < btns.length) {
    btns[idx].classList.add('sp-focused');
  }
}

export function showSessionPicker() {
  const picker = document.getElementById('session-picker');
  picker.style.display = 'flex';
  spFocusIdx = 0;
  const btns = getSpButtons();
  updateSpFocus(btns, 0);

  if (spAbort) spAbort.abort();
  spAbort = new AbortController();

  document.addEventListener('keydown', e => {
    const btns = getSpButtons();
    const cols = 3;
    const len = btns.length;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hideSessionPicker();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (spFocusIdx >= 0 && spFocusIdx < len) btns[spFocusIdx].click();
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      updateSpFocus(btns, (spFocusIdx + 1) % len);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      updateSpFocus(btns, (spFocusIdx - 1 + len) % len);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = spFocusIdx + cols;
      if (next < len) updateSpFocus(btns, next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = spFocusIdx - cols;
      if (prev >= 0) updateSpFocus(btns, prev);
    }
  }, { signal: spAbort.signal, capture: true });
}

export function hideSessionPicker() {
  document.getElementById('session-picker').style.display = 'none';
  if (spAbort) { spAbort.abort(); spAbort = null; }
  getSpButtons().forEach(b => b.classList.remove('sp-focused'));
  spFocusIdx = -1;
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
  resetTabStatus(id);
  destroyStream(id);
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
      // Bypass streaming for restored sessions — dump output instantly, then scroll to bottom
      newIds.forEach(id => {
        bypassStream(id);
        setTimeout(() => {
          unbypassStream(id);
          const entry = terminalMap.get(id);
          if (entry) entry.term.scrollToBottom();
        }, 3000);
      });
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

  // Let app-level keybindings override xterm — execute action immediately
  term.attachCustomKeyEventHandler(e => xtermKeyHandler(e));

  term.onData(data => {
    if (S.activeSessionId === sessionId) {
      // Enter pressed with pending images → upload, inject paths, then send Enter
      if (data === '\r' && hasPendingAttachments(sessionId)) {
        trackInput(sessionId, data);
        uploadAndFlush(sessionId).then(paths => {
          if (paths) wsSend({ type: 'input', sessionId, data: ' ' + paths });
          wsSend({ type: 'input', sessionId, data: '\r' });
        });
        tabStatusOnInput(sessionId);
        return;
      }
      trackInput(sessionId, data);
      wsSend({ type: 'input', sessionId, data });
    }
    tabStatusOnInput(sessionId);
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

  setupTerminalImageHandlers(div, sessionId);

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
  el.dataset.status = 'idle';
  el.innerHTML = `
    <span class="session-icon">❯</span>
    <div class="session-info">
      <div class="session-name">${escHtml(name)}</div>
      <div class="session-meta">
        <div class="session-cwd" data-cwd>~</div>
      </div>
      <div class="session-status-text">대기</div>
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

function detectWorktreeName(cwdPath) {
  if (!cwdPath) return '';
  const match = cwdPath.match(/\.claude\/worktrees\/([^/]+)/);
  return match ? match[1] : '';
}

export function updateSessionInfo(sessionId, cwd, ai) {
  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  let shortCwd = cwd || '~';
  const parts = shortCwd.replace(/\/$/, '').split('/');
  if (parts.length > 3) shortCwd = '…/' + parts.slice(-2).join('/');

  const wtName = detectWorktreeName(cwd);

  const cwdEl = entry.sidebarEl.querySelector('[data-cwd]');
  if (cwdEl) cwdEl.textContent = wtName ? `⌥${wtName}  ${shortCwd}` : shortCwd;

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
  const wtTag = wtName ? ` [${wtName}]` : '';
  tabNameEl.textContent = `${baseName}${wtTag}  ${shortCwd}`;

  if (S.activeSessionId === sessionId) {
    sbActiveName.textContent = `${baseName}${wtTag}  ${shortCwd}${ai ? `  [${ai}]` : ''}`;
    updateBreadcrumb(cwd);
  }

  const metaObj = sessionMeta.get(sessionId);
  if (metaObj) { metaObj.cwd = cwd; if (ai) metaObj.ai = ai; }

  if (S.layoutTree !== null) {
    const titleEl = entry.div.querySelector('.split-pane-title');
    if (titleEl) {
      titleEl.querySelector('.spt-name').textContent = `${baseName}${wtTag}`;
      titleEl.querySelector('.spt-path').textContent = shortCwd;
    }
  }
}

export function createTab(sessionId, name) {
  const el = document.createElement('div');
  el.className = 'tab';
  el.draggable = true;
  el.dataset.sessionId = sessionId;
  el.dataset.status = 'idle';
  el.innerHTML = `
    <div class="tab-indicator" aria-label="대기"></div>
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
  document.getElementById('ctx-duplicate').addEventListener('click', () => {
    if (!S.ctxTargetId) return;
    const meta = sessionMeta.get(S.ctxTargetId);
    const name = meta ? meta.name : 'Shell';
    wsSend({ type: 'session_duplicate', sourceSessionId: S.ctxTargetId, name });
  });
  document.getElementById('ctx-reveal').addEventListener('click', () => {
    if (!S.ctxTargetId) return;
    fetch('/api/reveal-in-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: S.ctxTargetId }),
    }).catch(() => {});
  });
  document.getElementById('ctx-close').addEventListener('click', () => {
    if (S.ctxTargetId) closeSession(S.ctxTargetId);
  });
}

function updateBreadcrumb(cwd) {
  const bar = document.getElementById('breadcrumb-bar');
  if (!bar || !cwd) { if (bar) bar.innerHTML = ''; return; }
  let display = cwd;
  // Detect home dir pattern: /Users/xxx or /home/xxx
  const homeMatch = cwd.match(/^(\/(?:Users|home)\/[^/]+)/);
  if (homeMatch) display = '~' + cwd.slice(homeMatch[1].length);
  const parts = display.split('/').filter(Boolean);
  bar.innerHTML = parts.map(p =>
    `<span class="breadcrumb-part">${escHtml(p)}</span>`
  ).join('<span class="breadcrumb-sep">›</span>');
}
