// ═══════════════════════════════════════════════════
//  THEMES
// ═══════════════════════════════════════════════════
const THEMES = [
  { id:'cyber',  label:'Cyber',  colors:['#050508','#00ffe5'],
    term:{ background:'#050508',foreground:'#c0fff8',cursor:'#00ffe5',cursorAccent:'#050508',selectionBackground:'#00ffe530',
           black:'#050508',red:'#ff3366',green:'#39ff78',yellow:'#ffb300',blue:'#60b0ff',magenta:'#bf80ff',cyan:'#00ffe5',white:'#c0fFF8',
           brightBlack:'#2a2a50',brightRed:'#ff6688',brightGreen:'#60ff99',brightYellow:'#ffd060',brightBlue:'#80c8ff',brightMagenta:'#d0a0ff',brightCyan:'#60ffef',brightWhite:'#e8e8ff'}},
  { id:'matrix', label:'Matrix', colors:['#020802','#39ff14'],
    term:{ background:'#020802',foreground:'#a0ffa0',cursor:'#39ff14',cursorAccent:'#020802',selectionBackground:'#39ff1430',
           black:'#020802',red:'#ff3366',green:'#39ff14',yellow:'#ccff00',blue:'#00ff88',magenta:'#88ff00',cyan:'#00ff88',white:'#a0ffa0',
           brightBlack:'#1a3a1a',brightRed:'#ff6688',brightGreen:'#60ff60',brightYellow:'#e0ff60',brightBlue:'#60ffaa',brightMagenta:'#aaff60',brightCyan:'#60ffcc',brightWhite:'#c0ffc0'}},
  { id:'amber',  label:'Amber',  colors:['#080400','#ffb300'],
    term:{ background:'#080400',foreground:'#ffe0a0',cursor:'#ffb300',cursorAccent:'#080400',selectionBackground:'#ffb30030',
           black:'#080400',red:'#ff3366',green:'#39ff78',yellow:'#ffb300',blue:'#ff6b35',magenta:'#ffd060',cyan:'#ffcc44',white:'#ffe0a0',
           brightBlack:'#3a2800',brightRed:'#ff6688',brightGreen:'#60ff99',brightYellow:'#ffd060',brightBlue:'#ff9966',brightMagenta:'#ffe080',brightCyan:'#ffdd88',brightWhite:'#fff0c0'}},
  { id:'frost',  label:'Frost',  colors:['#06080f','#60b0ff'],
    term:{ background:'#06080f',foreground:'#c0d8ff',cursor:'#60b0ff',cursorAccent:'#06080f',selectionBackground:'#60b0ff30',
           black:'#06080f',red:'#ff6688',green:'#60ffb0',yellow:'#ffd060',blue:'#60b0ff',magenta:'#c060ff',cyan:'#60e0ff',white:'#c0d8ff',
           brightBlack:'#1a2040',brightRed:'#ff88aa',brightGreen:'#80ffc0',brightYellow:'#ffe080',brightBlue:'#88c8ff',brightMagenta:'#d888ff',brightCyan:'#88eeff',brightWhite:'#e0eeff'}},
  { id:'blood',  label:'Blood',  colors:['#0a0505','#ff3366'],
    term:{ background:'#0a0505',foreground:'#ffb8b8',cursor:'#ff3366',cursorAccent:'#0a0505',selectionBackground:'#ff336630',
           black:'#0a0505',red:'#ff3366',green:'#ff9955',yellow:'#ff6b35',blue:'#ff80aa',magenta:'#ff60c0',cyan:'#ff8888',white:'#ffb8b8',
           brightBlack:'#2a1010',brightRed:'#ff6688',brightGreen:'#ffbb88',brightYellow:'#ff9966',brightBlue:'#ffaac8',brightMagenta:'#ff88d8',brightCyan:'#ffaaaa',brightWhite:'#ffd8d8'}},
  { id:'violet', label:'Violet', colors:['#070510','#bf80ff'],
    term:{ background:'#070510',foreground:'#ddc0ff',cursor:'#bf80ff',cursorAccent:'#070510',selectionBackground:'#bf80ff30',
           black:'#070510',red:'#ff6688',green:'#80ffbf',yellow:'#ffd060',blue:'#80a0ff',magenta:'#bf80ff',cyan:'#80d0ff',white:'#ddc0ff',
           brightBlack:'#201840',brightRed:'#ff88aa',brightGreen:'#a0ffd0',brightYellow:'#ffe080',brightBlue:'#a0b8ff',brightMagenta:'#d0a0ff',brightCyan:'#a0e0ff',brightWhite:'#f0e0ff'}},
];

const KB_DEFS = [
  { key:'newSession',      label:'New Session' },
  { key:'closeSession',    label:'Close Session' },
  { key:'nextTab',         label:'Next Tab' },
  { key:'prevTab',         label:'Previous Tab' },
  { key:'renameSession',   label:'Rename Session' },
  { key:'clearTerminal',   label:'Clear Terminal' },
  { key:'openSettings',    label:'Open Settings' },
  { key:'fullscreen',      label:'Toggle Fullscreen' },
];

// ═══════════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════════
let ws = null;
let activeSessionId = null;
let currentTheme = THEMES[0];
const terminalMap = new Map();
const sessionMeta = new Map();

// ── Split Pane State ──
let layoutTree = null;      // null = single mode, SplitNode = split mode
let splitRoot = null;       // #split-root element reference
let pendingSplitQueue = []; // async session creation queue
let wsJustReconnected = false; // true on first session_list after WS connect
let settings = null;
let pendingSettings = null;
let wsReconnectInterval = 3000;

// ═══════════════════════════════════════════════════
//  DOM REFS
// ═══════════════════════════════════════════════════
const connDot      = document.getElementById('conn-dot');
const connLabel    = document.getElementById('conn-label');
const hdrCount     = document.getElementById('hdr-session-count');
const sessionList  = document.getElementById('session-list');
const sessionEmpty = document.getElementById('session-empty');
const tabBar       = document.getElementById('tab-bar');
const tabAddBtn    = document.getElementById('tab-add-btn');
const termWrapper  = document.getElementById('terminal-wrapper');
const emptyState   = document.getElementById('empty-state');
const dropOverlay  = document.getElementById('drop-zone-overlay');
const dzZones      = dropOverlay.querySelectorAll('.dz');
const sbActiveName = document.getElementById('sb-active-name');
const sbCount      = document.getElementById('sb-count');
const sbSize       = document.getElementById('sb-size');
const sbWs         = document.getElementById('sb-ws');
const sbClock      = document.getElementById('sb-clock');
const ctxMenu      = document.getElementById('ctx-menu');
const settingsOverlay = document.getElementById('settings-overlay');
const customCssTag = document.getElementById('custom-css-tag');

// ═══════════════════════════════════════════════════
//  CLOCK
// ═══════════════════════════════════════════════════
const hdrTime = document.getElementById('hdr-time');
setInterval(() => {
  const t = new Date().toTimeString().slice(0,8);
  sbClock.textContent = t;
  hdrTime.textContent = t;
}, 1000);

// ═══════════════════════════════════════════════════
//  THEME SWATCHES (sidebar)
// ═══════════════════════════════════════════════════
const swatchContainer = document.getElementById('theme-swatches');
THEMES.forEach(t => {
  const sw = document.createElement('div');
  sw.className = 'theme-swatch' + (t.id === 'cyber' ? ' active' : '');
  sw.title = t.label;
  sw.style.background = `linear-gradient(135deg, ${t.colors[0]} 40%, ${t.colors[1]})`;
  sw.addEventListener('click', () => {
    if (pendingSettings) {
      pendingSettings.appearance.theme = t.id;
      document.querySelectorAll('.theme-grid .theme-card').forEach(el => {
        el.classList.toggle('active', el.dataset.themeId === t.id);
      });
    }
    applyTheme(t);
    updateSwatches();
  });
  swatchContainer.appendChild(sw);
});

function updateSwatches() {
  document.querySelectorAll('.theme-swatch').forEach((el, i) => {
    el.classList.toggle('active', THEMES[i].id === currentTheme.id);
  });
}

function applyTheme(t) {
  currentTheme = t;
  document.body.className = `theme-${t.id}`;
  terminalMap.forEach(({ term }) => { term.options.theme = t.term; });
  updateSwatches();
}

// ═══════════════════════════════════════════════════
//  SETTINGS LOAD / APPLY
// ═══════════════════════════════════════════════════
async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    settings = await r.json();
  } catch {
    settings = null;
  }
  if (settings) applySettings(settings);
}

async function saveSettingsToServer(s) {
  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
}

function applySettings(s) {
  settings = s;

  // Theme
  const t = THEMES.find(x => x.id === s.appearance.theme) || THEMES[0];
  applyTheme(t);

  // Effects
  applyEffects(s.appearance);

  // Custom CSS
  customCssTag.textContent = s.advanced?.customCss || '';

  // WS reconnect interval
  wsReconnectInterval = s.advanced?.wsReconnectInterval || 3000;

  // Apply to all open terminals
  terminalMap.forEach(({ term, fitAddon }) => {
    applyTerminalOptions(term, s);
    fitAddon.fit();
  });
}

function applyEffects(ap) {
  // Scanlines
  const scanlines = ap.crtScanlines !== false;
  const intensity = ap.crtScanlinesIntensity ?? 0.07;
  document.body.style.setProperty('--scanline-intensity', intensity);
  const beforeRule = scanlines
    ? `repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,${intensity}) 2px,rgba(0,0,0,${intensity}) 4px)`
    : 'none';
  // Re-inject pseudo-element via style rule
  let scanlineStyle = document.getElementById('scanline-style');
  if (!scanlineStyle) { scanlineStyle = document.createElement('style'); scanlineStyle.id='scanline-style'; document.head.appendChild(scanlineStyle); }
  scanlineStyle.textContent = `body::before { background: ${beforeRule} !important; }`;

  // Vignette
  const vig = ap.vignette !== false;
  let vigStyle = document.getElementById('vignette-style');
  if (!vigStyle) { vigStyle = document.createElement('style'); vigStyle.id='vignette-style'; document.head.appendChild(vigStyle); }
  vigStyle.textContent = vig ? '' : 'body::after { display: none !important; }';

  // Flicker
  const flicker = ap.crtFlicker !== false;
  let flickerStyle = document.getElementById('flicker-style');
  if (!flickerStyle) { flickerStyle = document.createElement('style'); flickerStyle.id='flicker-style'; document.head.appendChild(flickerStyle); }
  flickerStyle.textContent = flicker ? '' : '#terminal-wrapper { animation: none !important; }';
}

function applyTerminalOptions(term, s) {
  const ap = s.appearance;
  term.options.fontSize = ap.fontSize || 14;
  term.options.lineHeight = ap.lineHeight || 1.2;
  term.options.fontFamily = ap.fontFamily || '"JetBrains Mono",monospace';
  term.options.cursorStyle = ap.cursorStyle || 'block';
  term.options.cursorBlink = ap.cursorBlink !== false;
  term.options.scrollback = s.terminal?.scrollback || 5000;
  term.options.theme = currentTheme.term;
}

// ═══════════════════════════════════════════════════
//  WEBSOCKET
// ═══════════════════════════════════════════════════
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);

  ws.onopen = () => { setWsStatus(true); wsJustReconnected = true; };

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'session_list') {
      syncSessionList(msg.sessions, wsJustReconnected);
      wsJustReconnected = false;
    } else if (msg.type === 'settings') {
      applySettings(msg.settings);
    } else if (msg.type === 'session_created') {
      attachTerminal(msg.sessionId, msg.name);
      if (pendingSplitQueue.length > 0) {
        // Split mode: promise resolve, activateSession은 split 완료 후 호출
        const pending = pendingSplitQueue.shift();
        pending.resolve(msg.sessionId);
      } else {
        activateSession(msg.sessionId);
        wsSend({ type:'session_attach', sessionId: msg.sessionId });
        // Send actual terminal size to PTY after session is ready
        setTimeout(() => {
          const e = terminalMap.get(msg.sessionId);
          if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:msg.sessionId, cols:e.term.cols, rows:e.term.rows }); }
        }, 50);
      }
    } else if (msg.type === 'session_attached') {
      activateSession(msg.sessionId);
      // Sync PTY size on attach
      setTimeout(() => {
        const e = terminalMap.get(msg.sessionId);
        if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:msg.sessionId, cols:e.term.cols, rows:e.term.rows }); }
      }, 50);
    } else if (msg.type === 'session_info') {
      updateSessionInfo(msg.sessionId, msg.cwd, msg.ai);
    } else if (msg.type === 'output') {
      const entry = terminalMap.get(msg.sessionId);
      if (entry) {
        entry.term.write(msg.data);
        aiNotifyCheck(msg.sessionId, msg.data);
      }
    }
  };

  ws.onclose = () => {
    setWsStatus(false);
    setTimeout(connect, wsReconnectInterval);
  };

  ws.onerror = () => setWsStatus(false);
}

function setWsStatus(online) {
  connDot.className = 'meta-dot' + (online ? ' live' : ' dead');
  connLabel.textContent = online ? 'ONLINE' : 'OFFLINE';
  sbWs.textContent = online ? 'WS LIVE' : 'WS OFFLINE';
  sbWs.className = 'sb-item' + (online ? ' sb-ok' : ' sb-warn');
}

function wsSend(obj) {
  if (obj.type === 'input' && obj.sessionId) resetNotifyState(obj.sessionId);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ═══════════════════════════════════════════════════
//  SESSIONS
// ═══════════════════════════════════════════════════
function newSession() {
  showSessionPicker();
}

function showSessionPicker() {
  document.getElementById('session-picker').style.display = 'flex';
}

function hideSessionPicker() {
  document.getElementById('session-picker').style.display = 'none';
}

function closeSession(id) {
  wsSend({ type: 'session_close', sessionId: id });
  const entry = terminalMap.get(id);
  if (entry) {
    entry.term.dispose();  // 항상 dispose
    entry.tabEl.remove();
    entry.sidebarEl.remove();
    terminalMap.delete(id);

    if (layoutTree !== null) {
      removeSplitPane(id);  // div removal은 removeSplitPane 내부에서
    } else {
      entry.div.remove();
    }
  }
  sessionMeta.delete(id);
  if (activeSessionId === id) {
    activeSessionId = null;
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

function renameSession(id, newName) {
  const meta = sessionMeta.get(id);
  if (!meta) return;
  meta.name = newName;
  wsSend({ type: 'session_rename', sessionId: id, name: newName });
  const entry = terminalMap.get(id);
  if (entry) {
    entry.sidebarEl.querySelector('.session-name').textContent = newName;
    entry.tabEl.querySelector('.tab-name').textContent = newName;
  }
  if (activeSessionId === id) sbActiveName.textContent = newName;
}

function syncSessionList(sessions, isReconnect = false) {
  // Teardown split layout only on WS reconnect (layout is not persisted)
  if (isReconnect && layoutTree !== null) teardownSplitLayout();

  const isInitialLoad = terminalMap.size === 0 && sessions.length > 0;

  const newIds = [];
  sessions.forEach(s => {
    if (!sessionMeta.has(s.id)) {
      sessionMeta.set(s.id, { name: s.name, createdAt: s.createdAt });
      attachTerminal(s.id, s.name);
      newIds.push(s.id);
    }
  });
  // Subscribe ALL restored sessions so PTY output flows to each terminal
  // Also send resize for every restored session so TUI apps (opencode, etc.) get correct dimensions
  if (newIds.length > 0) {
    wsSend({ type: 'session_subscribe', sessionIds: newIds });
    setTimeout(() => {
      newIds.forEach(id => {
        const e = terminalMap.get(id);
        if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:id, cols:e.term.cols, rows:e.term.rows }); }
      });
    }, 100);
  }

  if (!activeSessionId && terminalMap.size > 0) {
    const firstId = terminalMap.keys().next().value;
    activateSession(firstId);
    // Also attach the first session so input works
    wsSend({ type: 'session_attach', sessionId: firstId });
    setTimeout(() => {
      const e = terminalMap.get(firstId);
      if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:firstId, cols:e.term.cols, rows:e.term.rows }); }
    }, 50);

    if (isInitialLoad) {
      // Show restoring badge in header
      const badge = document.getElementById('hdr-restore-badge');
      if (badge) {
        badge.style.display = '';
        setTimeout(() => { badge.style.display = 'none'; }, 2000);
      }
      // Show restoring message in terminal
      const e = terminalMap.get(firstId);
      if (e) {
        e.term.write('\r\n\x1b[36m  ⟳ Restoring session...\x1b[0m\r\n\r\n');
      }
    }
  }
  updateStatusBar();
}

function attachTerminal(sessionId, name) {
  if (terminalMap.has(sessionId)) return;
  sessionMeta.set(sessionId, { name, createdAt: Date.now() });

  const div = document.createElement('div');
  div.className = 'term-pane';
  div.dataset.sessionId = sessionId;
  const container = (layoutTree !== null && splitRoot) ? splitRoot : termWrapper;
  container.appendChild(div);

  const term = new Terminal({
    cursorBlink: settings?.appearance?.cursorBlink !== false,
    cursorStyle: settings?.appearance?.cursorStyle || 'block',
    fontSize: settings?.appearance?.fontSize || 14,
    lineHeight: settings?.appearance?.lineHeight || 1.2,
    fontFamily: settings?.appearance?.fontFamily || '"JetBrains Mono","Share Tech Mono",monospace',
    theme: currentTheme.term,
    scrollback: settings?.terminal?.scrollback || 5000,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(div);
  fitAddon.fit();

  term.onData(data => {
    if (activeSessionId === sessionId) wsSend({ type:'input', sessionId, data });
  });

  term.onResize(({ cols, rows }) => {
    wsSend({ type:'resize', sessionId, cols, rows });
    if (activeSessionId === sessionId) sbSize.textContent = `${cols}×${rows}`;
  });

  // Right-click paste
  div.addEventListener('contextmenu', async (e) => {
    if (settings?.terminal?.rightClickPaste) {
      e.preventDefault();
      try {
        const text = await navigator.clipboard.readText();
        if (text) wsSend({ type:'input', sessionId, data: text });
      } catch {}
    }
  });

  // Split mode: click pane to focus
  div.addEventListener('mousedown', () => {
    if (layoutTree !== null) activateSession(sessionId);
  });

  const sidebarEl = createSidebarItem(sessionId, name);
  const tabEl = createTab(sessionId, name);

  terminalMap.set(sessionId, { term, fitAddon, div, tabEl, sidebarEl });
  hideEmptyState();
  updateStatusBar();
}

function createSidebarItem(sessionId, name) {
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

function updateSessionInfo(sessionId, cwd, ai) {
  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  // Shorten path: replace HOME with ~
  const home = document.location.pathname; // fallback
  let shortCwd = cwd || '~';
  // Common shortening: last 2 path components
  const parts = shortCwd.replace(/\/$/, '').split('/');
  if (parts.length > 3) shortCwd = '…/' + parts.slice(-2).join('/');

  // Update sidebar cwd
  const cwdEl = entry.sidebarEl.querySelector('[data-cwd]');
  if (cwdEl) cwdEl.textContent = shortCwd;

  // Update AI badge
  let badgeEl = entry.sidebarEl.querySelector('.session-ai-badge');
  const metaEl = entry.sidebarEl.querySelector('.session-meta');
  if (ai) {
    const aiDefs = {
      claude:   { icon: '<img src="icons/claude.svg" class="badge-img" alt="Claude">', label: 'Claude' },
      chatgpt:  { icon: '<img src="icons/chatgpt.svg" class="badge-img" alt="ChatGPT">', label: 'ChatGPT' },
      gemini:   { icon: '<img src="icons/gemini.svg" class="badge-img" alt="Gemini">', label: 'Gemini' },
      copilot:  { icon: '<img src="icons/copilot.svg" class="badge-img" alt="Copilot">', label: 'Copilot' },
      aider:    { icon: '<img src="icons/aider.svg" class="badge-img" alt="Aider">', label: 'Aider' },
      cursor:   { icon: '<img src="icons/cursor.svg" class="badge-img" alt="Cursor">', label: 'Cursor' },
      codex:    { icon: '<img src="icons/codex.svg" class="badge-img" alt="Codex">', label: 'Codex' },
      opencode: { icon: '<img src="icons/opencode.svg" class="badge-img" alt="OpenCode">', label: 'OpenCode' },
    };
    const def = aiDefs[ai] || { icon: '🤖', label: ai };
    if (!badgeEl) {
      badgeEl = document.createElement('div');
      metaEl.appendChild(badgeEl);
    }
    badgeEl.className = `session-ai-badge ${ai}`;
    badgeEl.innerHTML = `<span class="badge-icon">${def.icon}</span>${def.label}`;
  } else if (badgeEl) {
    badgeEl.remove();
  }

  // Update tab: show short dir
  const tabNameEl = entry.tabEl.querySelector('.tab-name');
  const meta = sessionMeta.get(sessionId);
  const baseName = meta ? meta.name : sessionId;
  tabNameEl.textContent = `${baseName}  ${shortCwd}`;

  // Update statusbar if active
  if (activeSessionId === sessionId) {
    sbActiveName.textContent = `${baseName}  ${shortCwd}${ai ? `  [${ai}]` : ''}`;
  }

  // Store cwd in sessionMeta for split pane title
  const metaObj = sessionMeta.get(sessionId);
  if (metaObj) { metaObj.cwd = cwd; if (ai) metaObj.ai = ai; }

  // Update split pane title if in split mode
  if (layoutTree !== null) {
    const titleEl = entry.div.querySelector('.split-pane-title');
    if (titleEl) {
      titleEl.querySelector('.spt-name').textContent = baseName;
      titleEl.querySelector('.spt-path').textContent = shortCwd;
    }
  }
}

function createTab(sessionId, name) {
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

  // ── Tab DnD ──
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

// ═══════════════════════════════════════════════════
//  SPLIT PANE — LAYOUT ENGINE
// ═══════════════════════════════════════════════════
function updateSplitPaneTitle(el, sessionId) {
  let titleEl = el.querySelector('.split-pane-title');
  if (!titleEl) {
    titleEl = document.createElement('div');
    titleEl.className = 'split-pane-title';
    titleEl.innerHTML = '<span class="spt-dot"></span><span class="spt-name"></span><span class="spt-path"></span>';
    el.insertBefore(titleEl, el.firstChild);
  }
  const meta = sessionMeta.get(sessionId) || {};
  titleEl.querySelector('.spt-name').textContent = meta.name || sessionId;
  const cwd = meta.cwd || '';
  titleEl.querySelector('.spt-path').textContent = cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : '';
}

function renderSplitLayout(node, rect) {
  if (!splitRoot) return;
  if (node.type === 'pane') {
    const el = node.element;
    el.style.left   = rect.left + '%';
    el.style.top    = rect.top + '%';
    el.style.width  = rect.width + '%';
    el.style.height = rect.height + '%';
    updateSplitPaneTitle(el, node.sessionId);
    return;
  }
  const { direction, ratio, children } = node;
  let r0, r1;
  if (direction === 'v') {
    r0 = { left: rect.left, top: rect.top, width: rect.width * ratio, height: rect.height };
    r1 = { left: rect.left + rect.width * ratio, top: rect.top, width: rect.width * (1 - ratio), height: rect.height };
  } else {
    r0 = { left: rect.left, top: rect.top, width: rect.width, height: rect.height * ratio };
    r1 = { left: rect.left, top: rect.top + rect.height * ratio, width: rect.width, height: rect.height * (1 - ratio) };
  }
  renderSplitLayout(children[0], r0);
  renderSplitLayout(children[1], r1);
  attachDivider(node, direction === 'v'
    ? { left: rect.left + rect.width * ratio, top: rect.top, width: 0, height: rect.height }
    : { left: rect.left, top: rect.top + rect.height * ratio, width: rect.width, height: 0 },
    rect);
}

function attachDivider(node, pos, parentRect) {
  if (!node._divider) {
    const d = document.createElement('div');
    d.className = `split-divider split-divider-${node.direction}`;
    splitRoot.appendChild(d);
    node._divider = d;
    d.addEventListener('mousedown', e => startDividerDrag(e, node, parentRect));
  }
  const d = node._divider;
  if (node.direction === 'v') {
    d.style.left   = pos.left + '%';
    d.style.top    = pos.top + '%';
    d.style.height = pos.height + '%';
    d.style.width  = '8px';
    d.style.marginLeft = '-4px';
    d.style.marginTop  = '';
  } else {
    d.style.left   = pos.left + '%';
    d.style.top    = pos.top + '%';
    d.style.width  = pos.width + '%';
    d.style.height = '8px';
    d.style.marginTop  = '-4px';
    d.style.marginLeft = '';
  }
}

function startDividerDrag(e, node, parentRect) {
  e.preventDefault();
  node._divider.classList.add('dragging');
  const wrapRect = termWrapper.getBoundingClientRect();
  const parentSizePx = node.direction === 'v'
    ? wrapRect.width  * parentRect.width  / 100
    : wrapRect.height * parentRect.height / 100;
  const startRatio = node.ratio;
  const startPos = node.direction === 'v' ? e.clientX : e.clientY;

  const onMove = ev => {
    const delta = (node.direction === 'v' ? ev.clientX : ev.clientY) - startPos;
    node.ratio = Math.min(0.8, Math.max(0.2, startRatio + delta / parentSizePx));
    renderSplitLayout(layoutTree, { left:0, top:0, width:100, height:100 });
    refitAllPanes();
  };
  const onUp = () => {
    node._divider.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp, { once: true });
}

function refitAllPanes() {
  if (!layoutTree || !splitRoot) return;
  terminalMap.forEach(({ fitAddon, div }) => {
    if (div.parentElement === splitRoot) {
      try { fitAddon.fit(); } catch {}
    }
  });
}

function enterSplitMode(existingSessionId) {
  if (splitRoot) return;
  splitRoot = document.createElement('div');
  splitRoot.id = 'split-root';
  termWrapper.appendChild(splitRoot);
  const entry = terminalMap.get(existingSessionId);
  if (entry) {
    entry.div.classList.remove('active');
    splitRoot.appendChild(entry.div);
  }
  tabBar.style.display = 'none';
}

function collectPaneIds(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') { out.push(node.sessionId); return out; }
  collectPaneIds(node.children[0], out);
  collectPaneIds(node.children[1], out);
  return out;
}

function updateSidebarSplitGroup() {
  // Remove existing split group if any
  const existing = sessionList.querySelector('.split-group');
  if (existing) {
    // Move items back to sessionList before removing group
    [...existing.querySelectorAll('.session-item')].forEach(el => sessionList.appendChild(el));
    existing.remove();
  }
  if (!layoutTree) return;

  const paneIds = collectPaneIds(layoutTree);
  if (paneIds.length < 2) return;

  // Build group element
  const group = document.createElement('div');
  group.className = 'split-group';
  group.innerHTML = `<div class="split-group-header"><span class="split-group-header-icon">⊞</span><span class="split-group-header-label">SPLIT</span><span class="split-group-badge">${paneIds.length}</span></div>`;

  // Move pane session items into group
  paneIds.forEach(id => {
    const entry = terminalMap.get(id);
    if (entry && entry.sidebarEl) group.appendChild(entry.sidebarEl);
  });

  // Insert group at position of first pane item in sessionList
  // Find first non-split item's position, or just append
  sessionList.appendChild(group);
}

function teardownSplitLayout() {
  if (!layoutTree) return;
  function removeDividers(node) {
    if (!node || node.type === 'pane') return;
    if (node._divider) { node._divider.remove(); node._divider = null; }
    node.children.forEach(removeDividers);
  }
  removeDividers(layoutTree);
  layoutTree = null;
  if (splitRoot) {
    [...splitRoot.querySelectorAll('.term-pane')].forEach(div => {
      div.classList.remove('split-active', 'split-inactive');
      termWrapper.appendChild(div);
    });
    splitRoot.remove();
    splitRoot = null;
  }
  tabBar.style.display = '';
  updateSidebarSplitGroup(); // removes group (layoutTree is null)
}

function findPaneNode(node, sessionId) {
  if (!node) return null;
  if (node.type === 'pane') return node.sessionId === sessionId ? node : null;
  return findPaneNode(node.children[0], sessionId) || findPaneNode(node.children[1], sessionId);
}

function findParentNode(tree, target, parent = null) {
  if (!tree) return null;
  if (tree === target) return parent;
  if (tree.type === 'split') {
    return findParentNode(tree.children[0], target, tree) || findParentNode(tree.children[1], target, tree);
  }
  return null;
}

function removeSplitPane(sessionId) {
  if (!layoutTree) return;
  const pane = findPaneNode(layoutTree, sessionId);
  if (!pane) return;
  pane.element.remove();

  const parent = findParentNode(layoutTree, pane);
  if (!parent) {
    // 마지막 pane이었음
    teardownSplitLayout();
    return;
  }
  const sibling = parent.children.find(c => c !== pane);
  if (parent._divider) { parent._divider.remove(); parent._divider = null; }

  const grandParent = findParentNode(layoutTree, parent);
  if (!grandParent) {
    layoutTree = sibling;
  } else {
    const idx = grandParent.children.indexOf(parent);
    grandParent.children[idx] = sibling;
  }

  // terminalMap에서 이미 제거된 후 호출되므로 size로 판단
  if (terminalMap.size <= 1) {
    teardownSplitLayout();
    const lastId = terminalMap.keys().next().value;
    if (lastId) {
      const lastEntry = terminalMap.get(lastId);
      if (lastEntry) lastEntry.div.classList.add('active');
      activateSession(lastId);
    }
  } else {
    renderSplitLayout(layoutTree, { left:0, top:0, width:100, height:100 });
    refitAllPanes();
  }
}

function activateSession(id) {
  if (!terminalMap.has(id)) return;
  activeSessionId = id;

  if (layoutTree === null) {
    // Single mode: 기존 동작
    terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
      const a = sid === id;
      div.classList.toggle('active', a);
      tabEl.classList.toggle('active', a);
      sidebarEl.classList.toggle('active', a);
    });
  } else {
    // Split mode: 모든 pane 표시, highlight만 변경
    terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
      const a = sid === id;
      div.classList.toggle('split-active', a);
      div.classList.toggle('split-inactive', !a);
      tabEl.classList.toggle('active', a);
      sidebarEl.classList.toggle('active', a);
    });
  }

  const entry = terminalMap.get(id);
  if (entry) {
    entry.fitAddon.fit();
    entry.term.focus();
    const meta = sessionMeta.get(id);
    sbActiveName.textContent = meta ? meta.name : id;
    sbSize.textContent = `${entry.term.cols}×${entry.term.rows}`;
  }
  updateStatusBar();
}

function updateStatusBar() {
  const c = terminalMap.size;
  sbCount.textContent = c;
  hdrCount.textContent = c;
  sessionEmpty.style.display = c === 0 ? 'block' : 'none';
}

function showEmptyState()  { emptyState.style.display = 'flex'; sbActiveName.textContent='—'; sbSize.textContent='—'; }
function hideEmptyState()  { emptyState.style.display = 'none'; }

// ═══════════════════════════════════════════════════
//  CONTEXT MENU
// ═══════════════════════════════════════════════════
let ctxTargetId = null;
function showCtxMenu(e, sessionId) {
  e.preventDefault();
  ctxTargetId = sessionId;
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top  = e.clientY + 'px';
  ctxMenu.classList.add('visible');
}
document.addEventListener('click', () => ctxMenu.classList.remove('visible'));
document.getElementById('ctx-rename').addEventListener('click', () => {
  if (!ctxTargetId) return;
  const entry = terminalMap.get(ctxTargetId);
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
    renameSession(ctxTargetId, n);
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { finish(); e.preventDefault(); }
    if (e.key === 'Escape') { input.value = old; finish(); }
  });
});
document.getElementById('ctx-close').addEventListener('click', () => {
  if (ctxTargetId) closeSession(ctxTargetId);
});

// ═══════════════════════════════════════════════════
//  SETTINGS MODAL
// ═══════════════════════════════════════════════════

// Build theme grid
function buildThemeGrid(selectedId) {
  const grid = document.getElementById('theme-grid');
  grid.innerHTML = '';
  THEMES.forEach(t => {
    const card = document.createElement('div');
    card.className = 'theme-card' + (t.id === selectedId ? ' active' : '');
    card.dataset.themeId = t.id;
    card.innerHTML = `
      <div class="theme-card-swatch" style="background:linear-gradient(135deg,${t.colors[0]} 40%,${t.colors[1]})"></div>
      <div class="theme-card-name">${t.label}</div>
      <span class="theme-card-check">✓</span>
    `;
    card.addEventListener('click', () => {
      grid.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      pendingSettings.appearance.theme = t.id;
      applyTheme(t);
      updateSwatches();
    });
    grid.appendChild(card);
  });
}

// Build keybinding list
function buildKbList(kb) {
  const list = document.getElementById('kb-list');
  list.innerHTML = '';
  KB_DEFS.forEach(def => {
    const row = document.createElement('div');
    row.className = 'kb-row';
    const input = document.createElement('input');
    input.className = 'kb-input';
    input.readOnly = true;
    input.value = kb[def.key] || '';
    input.title = 'Click to record shortcut';

    input.addEventListener('click', () => {
      input.classList.add('recording');
      input.value = 'Press keys...';
      const handler = (e) => {
        e.preventDefault();
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        if (!['Control','Shift','Alt','Meta'].includes(e.key)) {
          parts.push(e.key === ' ' ? 'Space' : e.key);
        }
        if (parts.length > 0 && !['Control','Shift','Alt','Meta'].includes(e.key)) {
          const combo = parts.join('+');
          input.value = combo;
          pendingSettings.keybindings[def.key] = combo;
          input.classList.remove('recording');
          document.removeEventListener('keydown', handler, true);
        }
      };
      document.addEventListener('keydown', handler, true);
      input.addEventListener('blur', () => {
        input.classList.remove('recording');
        document.removeEventListener('keydown', handler, true);
        if (input.value === 'Press keys...') input.value = kb[def.key] || '';
      }, { once: true });
    });

    row.innerHTML = `<span class="kb-label">${def.label}</span>`;
    row.appendChild(input);
    list.appendChild(row);
  });
}

// Build env list
function buildEnvList(env) {
  const list = document.getElementById('env-list');
  list.innerHTML = '';
  Object.entries(env || {}).forEach(([k, v]) => addEnvRow(k, v));
}

function addEnvRow(k='', v='') {
  const list = document.getElementById('env-list');
  const row = document.createElement('div');
  row.className = 'env-row';
  row.innerHTML = `
    <input class="env-key" placeholder="KEY" value="${escHtml(k)}"/>
    <input class="env-val" placeholder="value" value="${escHtml(v)}"/>
    <button class="env-remove">✕</button>
  `;
  row.querySelector('.env-remove').addEventListener('click', () => {
    row.remove();
    syncEnvToPending();
  });
  row.querySelector('.env-key').addEventListener('input', syncEnvToPending);
  row.querySelector('.env-val').addEventListener('input', syncEnvToPending);
  list.appendChild(row);
}

function syncEnvToPending() {
  const env = {};
  document.querySelectorAll('.env-row').forEach(row => {
    const k = row.querySelector('.env-key').value.trim();
    const v = row.querySelector('.env-val').value;
    if (k) env[k] = v;
  });
  if (pendingSettings) pendingSettings.shell.env = env;
}

// Populate all settings form fields from pendingSettings
function populateForm(s) {
  const ap = s.appearance;
  const te = s.terminal;
  const sh = s.shell;
  const kb = s.keybindings;
  const adv = s.advanced;

  // Appearance
  buildThemeGrid(ap.theme);
  setSelectValue('s-fontFamily', ap.fontFamily);
  setRangeValue('s-fontSize', ap.fontSize, 'px');
  setRangeValue('s-lineHeight', ap.lineHeight, '');
  setSelectValue('s-cursorStyle', ap.cursorStyle);
  document.getElementById('s-cursorBlink').checked = ap.cursorBlink !== false;
  document.getElementById('s-crtScanlines').checked = ap.crtScanlines !== false;
  setRangeValue('s-crtScanlinesIntensity', ap.crtScanlinesIntensity, '');
  document.getElementById('s-crtFlicker').checked = ap.crtFlicker !== false;
  document.getElementById('s-vignette').checked = ap.vignette !== false;
  setRangeValue('s-glowIntensity', ap.glowIntensity, '');
  setRangeValue('s-backgroundOpacity', ap.backgroundOpacity, '');
  updateFontPreview(ap.fontFamily, ap.fontSize);

  // Terminal
  document.getElementById('s-scrollback').value = te.scrollback;
  setSelectValue('s-bellStyle', te.bellStyle);
  document.getElementById('s-copyOnSelect').checked = te.copyOnSelect;
  document.getElementById('s-rightClickPaste').checked = te.rightClickPaste;
  document.getElementById('s-trimCopied').checked = te.trimCopied;
  document.getElementById('s-wordSeparators').value = te.wordSeparators;
  setSelectValue('s-renderer', te.renderer);

  // Shell
  document.getElementById('s-shellPath').value = sh.shellPath;
  document.getElementById('s-startDirectory').value = sh.startDirectory;
  document.getElementById('s-sessionNameFormat').value = sh.sessionNameFormat;
  document.getElementById('s-autoReconnect').checked = sh.autoReconnect;
  buildEnvList(sh.env);

  // Keybindings
  buildKbList(kb);

  // Advanced
  document.getElementById('s-customCss').value = adv.customCss || '';
  document.getElementById('s-wsReconnectInterval').value = adv.wsReconnectInterval;
  setSelectValue('s-logLevel', adv.logLevel);
}

function setSelectValue(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let i = 0; i < el.options.length; i++) {
    if (el.options[i].value === String(val)) { el.selectedIndex = i; return; }
  }
}

function setRangeValue(id, val, _unit) {
  const range = document.getElementById(id);
  const display = document.getElementById(id + '-val');
  const numInput = document.getElementById(id + '-num');
  if (!range) return;
  range.value = val;
  if (display) display.textContent = parseFloat(val).toFixed(val < 1 ? 2 : (val % 1 === 0 ? 0 : 1));
  if (numInput) numInput.value = val;
}

function updateFontPreview(fontFamily, fontSize) {
  const preview = document.getElementById('font-preview');
  if (preview) {
    preview.style.fontFamily = fontFamily;
    preview.style.fontSize = (fontSize || 13) + 'px';
  }
}

// Read form back into pendingSettings
function readForm() {
  const s = pendingSettings;

  // Appearance
  s.appearance.fontFamily = document.getElementById('s-fontFamily').value;
  const fontSizeNumEl = document.getElementById('s-fontSize-num');
  s.appearance.fontSize = parseInt(fontSizeNumEl ? fontSizeNumEl.value : document.getElementById('s-fontSize').value) || 14;
  s.appearance.lineHeight = parseFloat(document.getElementById('s-lineHeight').value);
  s.appearance.cursorStyle = document.getElementById('s-cursorStyle').value;
  s.appearance.cursorBlink = document.getElementById('s-cursorBlink').checked;
  s.appearance.crtScanlines = document.getElementById('s-crtScanlines').checked;
  s.appearance.crtScanlinesIntensity = parseFloat(document.getElementById('s-crtScanlinesIntensity').value);
  s.appearance.crtFlicker = document.getElementById('s-crtFlicker').checked;
  s.appearance.vignette = document.getElementById('s-vignette').checked;
  s.appearance.glowIntensity = parseFloat(document.getElementById('s-glowIntensity').value);
  s.appearance.backgroundOpacity = parseFloat(document.getElementById('s-backgroundOpacity').value);

  // Terminal
  s.terminal.scrollback = parseInt(document.getElementById('s-scrollback').value);
  s.terminal.bellStyle = document.getElementById('s-bellStyle').value;
  s.terminal.copyOnSelect = document.getElementById('s-copyOnSelect').checked;
  s.terminal.rightClickPaste = document.getElementById('s-rightClickPaste').checked;
  s.terminal.trimCopied = document.getElementById('s-trimCopied').checked;
  s.terminal.wordSeparators = document.getElementById('s-wordSeparators').value;
  s.terminal.renderer = document.getElementById('s-renderer').value;

  // Shell
  s.shell.shellPath = document.getElementById('s-shellPath').value;
  s.shell.startDirectory = document.getElementById('s-startDirectory').value;
  s.shell.sessionNameFormat = document.getElementById('s-sessionNameFormat').value;
  s.shell.autoReconnect = document.getElementById('s-autoReconnect').checked;
  syncEnvToPending();

  // Advanced
  s.advanced.customCss = document.getElementById('s-customCss').value;
  s.advanced.wsReconnectInterval = parseInt(document.getElementById('s-wsReconnectInterval').value);
  s.advanced.logLevel = document.getElementById('s-logLevel').value;

  return s;
}

// Open modal
function openSettings() {
  pendingSettings = JSON.parse(JSON.stringify(settings || {}));
  populateForm(pendingSettings);
  settingsOverlay.classList.add('open');
  // Activate first nav
  activateNavPanel('appearance');
}

// Close modal
function closeSettings() {
  settingsOverlay.classList.remove('open');
  pendingSettings = null;
}

// Nav switching
document.getElementById('settings-nav').addEventListener('click', e => {
  const item = e.target.closest('.nav-item');
  if (!item) return;
  activateNavPanel(item.dataset.panel);
});

function activateNavPanel(panelId) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.panel === panelId));
  document.querySelectorAll('.settings-panel').forEach(el => el.classList.toggle('active', el.id === `panel-${panelId}`));
}

// Live preview for range inputs
document.querySelectorAll('.s-range').forEach(range => {
  range.addEventListener('input', () => {
    const valEl = document.getElementById(range.id + '-val');
    const numInput = document.getElementById(range.id + '-num');
    if (valEl) {
      const v = parseFloat(range.value);
      valEl.textContent = v.toFixed(v < 1 ? 2 : (v % 1 === 0 ? 0 : 1));
    }
    if (numInput) numInput.value = range.value;
    if (range.id === 's-fontSize' || range.id === 's-lineHeight') {
      const fontFamily = document.getElementById('s-fontFamily').value;
      const fontSize = document.getElementById('s-fontSize').value;
      updateFontPreview(fontFamily, fontSize);
    }
  });
});

// Sync number input → range for fontSize
const fontSizeNum = document.getElementById('s-fontSize-num');
if (fontSizeNum) {
  fontSizeNum.addEventListener('input', () => {
    const v = Math.min(32, Math.max(8, parseInt(fontSizeNum.value) || 14));
    document.getElementById('s-fontSize').value = v;
    updateFontPreview(document.getElementById('s-fontFamily').value, v);
  });
}

document.getElementById('s-fontFamily').addEventListener('change', e => {
  updateFontPreview(e.target.value, document.getElementById('s-fontSize').value);
});

// Save
document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const s = readForm();
  await saveSettingsToServer(s);
  applySettings(s);
  settings = s;
  const statusEl = document.getElementById('save-status');
  statusEl.classList.add('visible');
  setTimeout(() => statusEl.classList.remove('visible'), 2000);
  closeSettings();
});

document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) closeSettings(); });

// Reset
document.getElementById('btn-reset-settings').addEventListener('click', async () => {
  if (!confirm('Reset ALL settings to defaults? This cannot be undone.')) return;
  const r = await fetch('/api/settings/default');
  const def = await r.json();
  pendingSettings = def;
  populateForm(def);
  applySettings(def);
  settings = def;
  await saveSettingsToServer(def);
});

// Export
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'super-terminal-settings.json';
  a.click();
});

// Import
document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file-input').click();
});
document.getElementById('import-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const imported = JSON.parse(ev.target.result);
      pendingSettings = imported;
      populateForm(imported);
      applySettings(imported);
      settings = imported;
      await saveSettingsToServer(imported);
      const statusEl = document.getElementById('import-status');
      statusEl.textContent = '✓ Settings imported successfully';
      statusEl.style.display = 'block';
      setTimeout(() => statusEl.style.display = 'none', 3000);
    } catch {
      alert('Failed to parse settings file. Make sure it is a valid JSON.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Env add
document.getElementById('btn-add-env').addEventListener('click', () => {
  addEnvRow('', '');
});

// Settings button
document.getElementById('btn-settings').addEventListener('click', openSettings);

// ═══════════════════════════════════════════════════
//  SPLIT PANE — DnD LOGIC
// ═══════════════════════════════════════════════════
function createSplitSession() {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const wrappedResolve = (id) => { resolved = true; resolve(id); };
    pendingSplitQueue.push({ resolve: wrappedResolve });
    wsSend({ type: 'session_create', name: 'split', cmd: settings?.shell?.defaultShell || '' });
    setTimeout(() => {
      if (!resolved) {
        pendingSplitQueue = pendingSplitQueue.filter(p => p.resolve !== wrappedResolve);
        reject(new Error('split session timeout'));
      }
    }, 8000);
  });
}

function showDropZoneOverlay() {
  const paneCount = terminalMap.size;
  if (paneCount >= 4) return;
  dropOverlay.classList.add('active');
  dropOverlay.querySelector('.dz-center').style.display = paneCount === 1 ? '' : 'none';
}

function hideDropZoneOverlay() {
  dropOverlay.classList.remove('active');
  dzZones.forEach(z => z.classList.remove('dz-hover'));
}

dzZones.forEach(zone => {
  zone.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.includes('text/split-tab')) return;
    e.preventDefault();
    dzZones.forEach(z => z.classList.remove('dz-hover'));
    zone.classList.add('dz-hover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dz-hover'));
  zone.addEventListener('drop', async e => {
    e.preventDefault();
    hideDropZoneOverlay();
    const z = zone.dataset.zone;
    const existingId = activeSessionId;
    if (!existingId) return;

    if (z === 'center') {
      try {
        const [id1, id2, id3] = await Promise.all([
          createSplitSession(), createSplitSession(), createSplitSession()
        ]);
        const existingEntry = terminalMap.get(existingId);
        const existingPane = { type: 'pane', sessionId: existingId, element: existingEntry.div };
        const pane1 = { type: 'pane', sessionId: id1, element: terminalMap.get(id1).div };
        const pane2 = { type: 'pane', sessionId: id2, element: terminalMap.get(id2).div };
        const pane3 = { type: 'pane', sessionId: id3, element: terminalMap.get(id3).div };
        enterSplitMode(existingId);
        [pane1, pane2, pane3].forEach(p => splitRoot.appendChild(p.element));
        layoutTree = {
          type: 'split', direction: 'h', ratio: 0.5,
          children: [
            { type: 'split', direction: 'v', ratio: 0.5, children: [existingPane, pane1] },
            { type: 'split', direction: 'v', ratio: 0.5, children: [pane2, pane3] }
          ]
        };
        renderSplitLayout(layoutTree, { left:0, top:0, width:100, height:100 });
        refitAllPanes();
        updateSidebarSplitGroup();
        activateSession(existingId);
      } catch (err) { console.error('4-way split failed', err); }
      return;
    }

    const dirMap = { left: 'v', right: 'v', top: 'h', bottom: 'h' };
    const direction = dirMap[z];
    try {
      const newId = await createSplitSession();
      const newEntry = terminalMap.get(newId);
      const newPane = { type: 'pane', sessionId: newId, element: newEntry.div };
      newPane.element.classList.add('split-inactive');

      const firstNew = (z === 'left' || z === 'top');

      if (!layoutTree) {
        enterSplitMode(existingId);
        const existingEntry = terminalMap.get(existingId);
        const existingPane = { type: 'pane', sessionId: existingId, element: existingEntry.div };
        layoutTree = {
          type: 'split', direction, ratio: 0.5,
          children: firstNew ? [newPane, existingPane] : [existingPane, newPane]
        };
      } else {
        const existingPane = findPaneNode(layoutTree, existingId);
        if (!existingPane) return;
        const parent = findParentNode(layoutTree, existingPane);
        const newNode = {
          type: 'split', direction, ratio: 0.5,
          children: firstNew ? [newPane, existingPane] : [existingPane, newPane]
        };
        if (!parent) {
          layoutTree = newNode;
        } else {
          const idx = parent.children.indexOf(existingPane);
          parent.children[idx] = newNode;
        }
      }
      splitRoot.appendChild(newPane.element);
      renderSplitLayout(layoutTree, { left:0, top:0, width:100, height:100 });
      refitAllPanes();
      updateSidebarSplitGroup();
      activateSession(newId);
    } catch (err) { console.error('split failed', err); }
  });
});

// ═══════════════════════════════════════════════════
//  KEYBINDINGS HANDLER
// ═══════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!settings) return;

  // Escape: close picker or settings
  if (e.key === 'Escape') {
    const picker = document.getElementById('session-picker');
    if (picker.style.display !== 'none') { hideSessionPicker(); return; }
    if (settingsOverlay.classList.contains('open')) { closeSettings(); return; }
  }

  if (settingsOverlay.classList.contains('open')) return;

  // Split pane keyboard navigation: Ctrl+Shift+Arrow
  if (e.ctrlKey && e.shiftKey && layoutTree !== null) {
    const dirs = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down' };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      const panes = [];
      function collectPanes(node) {
        if (!node) return;
        if (node.type === 'pane') {
          const rect = node.element.getBoundingClientRect();
          panes.push({ sessionId: node.sessionId, cx: rect.left + rect.width/2, cy: rect.top + rect.height/2 });
        } else { node.children.forEach(collectPanes); }
      }
      collectPanes(layoutTree);
      const activeEntry = terminalMap.get(activeSessionId);
      if (!activeEntry) return;
      const ar = activeEntry.div.getBoundingClientRect();
      const ax = ar.left + ar.width/2, ay = ar.top + ar.height/2;
      const coneMap = { left: Math.PI, right: 0, up: -Math.PI/2, down: Math.PI/2 };
      const targetAngle = coneMap[dir];
      let best = null, bestDist = Infinity;
      panes.forEach(p => {
        if (p.sessionId === activeSessionId) return;
        const dx = p.cx - ax, dy = p.cy - ay;
        const angle = Math.atan2(dy, dx);
        let diff = angle - targetAngle;
        while (diff > Math.PI) diff -= 2*Math.PI;
        while (diff < -Math.PI) diff += 2*Math.PI;
        if (Math.abs(diff) <= Math.PI/4) {
          const primaryDist = (dir === 'left' || dir === 'right') ? Math.abs(dx) : Math.abs(dy);
          if (primaryDist < bestDist) { bestDist = primaryDist; best = p; }
        }
      });
      if (best) activateSession(best.sessionId);
      return;
    }
  }

  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  if (!['Control','Shift','Alt','Meta'].includes(e.key)) parts.push(e.key === ' ' ? 'Space' : e.key);
  const combo = parts.join('+');

  const kb = settings.keybindings || {};
  if (combo === kb.newSession)   { e.preventDefault(); newSession(); }
  if (combo === kb.closeSession && activeSessionId) { e.preventDefault(); closeSession(activeSessionId); }
  if (combo === kb.openSettings) { e.preventDefault(); openSettings(); }
  if (combo === kb.fullscreen)   { e.preventDefault(); toggleFullscreen(); }
  if (combo === kb.nextTab)      { e.preventDefault(); switchTabBy(1); }
  if (combo === kb.prevTab)      { e.preventDefault(); switchTabBy(-1); }
  if (combo === kb.renameSession && activeSessionId) { e.preventDefault(); promptRenameSession(activeSessionId); }
  if (combo === kb.clearTerminal && activeSessionId) { e.preventDefault(); clearActiveTerminal(); }

  // Cmd+1~9: jump to session by index (Mac)
  if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
    const n = parseInt(e.key);
    if (n >= 1 && n <= 9) {
      const ids = Array.from(terminalMap.keys());
      if (ids[n - 1]) { e.preventDefault(); activateSession(ids[n - 1]); }
    }
  }
});

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(()=>{});
  else document.exitFullscreen().catch(()=>{});
}

function promptRenameSession(id) {
  const meta = sessionMeta.get(id);
  if (!meta) return;
  const name = window.prompt('Rename session:', meta.name);
  if (name && name.trim()) renameSession(id, name.trim());
}

function clearActiveTerminal() {
  if (!activeSessionId) return;
  const entry = terminalMap.get(activeSessionId);
  if (entry) entry.term.clear();
}

function switchTabBy(dir) {
  const ids = Array.from(terminalMap.keys());
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeSessionId);
  const next = ids[(idx + dir + ids.length) % ids.length];
  activateSession(next);
  wsSend({ type:'session_attach', sessionId: next });
}

// ═══════════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════════
window.addEventListener('resize', () => {
  terminalMap.forEach(({ fitAddon }) => fitAddon.fit());
});

// ═══════════════════════════════════════════════════
//  AI NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════

// Request notification permission on load
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// Strip ANSI escape codes from terminal output
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[mGKHFABCDJsuhl]/g, '')
            .replace(/\x1b\][^\x07]*\x07/g, '')
            .replace(/\x1b[()][AB012]/g, '')
            .replace(/[\x00-\x09\x0b-\x1f]/g, '');
}

// Per-session output buffers and debounce timers
const notifyBuffers = new Map();   // sessionId → string (rolling 2KB)
const notifyTimers  = new Map();   // sessionId → setTimeout handle
const notifyState   = new Map();   // sessionId → 'idle' | 'busy'
const NOTIFY_DEBOUNCE = 1200;      // ms of silence before checking

// AI completion/question patterns
const AI_PATTERNS = [
  // Claude Code
  { re: />\s*$/m,                                      ai:'claude',   type:'question', msg:'Claude is waiting for your input' },
  { re: /✓|✔|Task complete|Done\.|Completed\./i,       ai:'claude',   type:'done',     msg:'Claude finished the task' },

  // opencode
  { re: /\?\s*$/m,                                     ai:'opencode', type:'question', msg:'opencode is asking a question' },
  { re: /Done|Completed|Finished/i,                    ai:'opencode', type:'done',     msg:'opencode finished the task' },

  // Gemini
  { re: /^>\s*$/m,                                     ai:'gemini',   type:'question', msg:'Gemini is waiting for input' },
  { re: /Done\.|Task complete|Finished/i,              ai:'gemini',   type:'done',     msg:'Gemini finished the task' },

  // Aider
  { re: /^aider>\s*$/im,                               ai:'aider',    type:'question', msg:'Aider is waiting for input' },
  { re: /^Tokens:|Applied edit/im,                     ai:'aider',    type:'done',     msg:'Aider finished editing' },

  // Generic — prompt symbol after silence (catches most CLIs)
  { re: /[\$❯›»]\s*$/m,                                ai:'any',      type:'question', msg:'Terminal is waiting for input' },
];

const AI_ICONS = {
  claude:   '✦', chatgpt: '●', gemini: '✦',
  copilot:  '◎', aider:   '◈', cursor: '▸',
  opencode: '🔶', any:     '💻',
};

function aiNotifyCheck(sessionId, chunk) {
  const currentAi = sessionMeta.get(sessionId)?.ai || null;

  // Always accumulate output
  const prev = notifyBuffers.get(sessionId) || '';
  const next = (prev + chunk).slice(-4096);
  notifyBuffers.set(sessionId, next);

  // Debounce: wait for silence
  clearTimeout(notifyTimers.get(sessionId));
  notifyTimers.set(sessionId, setTimeout(() => {
    const buf = stripAnsi(notifyBuffers.get(sessionId) || '');
    notifyBuffers.set(sessionId, ''); // clear after check

    let matched = null;
    for (const p of AI_PATTERNS) {
      if (p.ai !== 'any' && currentAi && p.ai !== currentAi) continue;
      if (p.re.test(buf)) { matched = p; break; }
    }
    if (!matched) return;

    const prevState = notifyState.get(sessionId);
    if (prevState === matched.type) return;
    notifyState.set(sessionId, matched.type);

    const meta = sessionMeta.get(sessionId);
    const sessName = meta?.name || sessionId;
    const icon = AI_ICONS[currentAi || 'any'] || '💻';
    const title = matched.type === 'done'
      ? `${icon} Task Done — ${sessName}`
      : `${icon} Needs Input — ${sessName}`;
    const body = matched.msg;

    // Toast: always show when session is not the active visible tab
    const isActiveVisible = (sessionId === activeSessionId) && (document.visibilityState === 'visible');
    if (!isActiveVisible) {
      showToast(title, body, sessionId);
    }

    // OS notification: only when page is hidden or window not focused
    if (document.visibilityState === 'hidden' || !document.hasFocus()) {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          fireOsNotification(title, body, sessionId);
        } else if (Notification.permission === 'default') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') fireOsNotification(title, body, sessionId);
          });
        }
      }
    }
  }, NOTIFY_DEBOUNCE));
}

// Reset notify state when user interacts with a session
function resetNotifyState(sessionId) {
  notifyState.set(sessionId, 'idle');
  notifyBuffers.set(sessionId, '');
  clearTimeout(notifyTimers.get(sessionId));
}

function fireOsNotification(title, body, sessionId) {
  const n = new Notification(title, {
    body,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%2300ffe5" opacity=".15"/><polyline points="10,7 6,16 14,16 10,25 22,13 15,13 19,7" fill="%2300ffe5"/></svg>',
    tag: `super-terminal-${sessionId}`,
    silent: false,
  });
  n.onclick = () => {
    window.focus();
    if (terminalMap.has(sessionId)) {
      activateSession(sessionId);
      wsSend({ type:'session_attach', sessionId });
    }
    n.close();
  };
}

// ── In-app Toast ──────────────────────────────────
let toastContainer = null;
function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(title, body, sessionId) {
  const c = getToastContainer();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <div class="toast-title">${escHtml(title)}</div>
    <div class="toast-body">${escHtml(body)}</div>
    <button class="toast-close">✕</button>
  `;
  t.addEventListener('click', e => {
    if (e.target.closest('.toast-close')) { t.remove(); return; }
    if (terminalMap.has(sessionId)) {
      activateSession(sessionId);
      wsSend({ type:'session_attach', sessionId });
    }
    t.remove();
  });
  c.appendChild(t);
  // Auto-dismiss after 6s
  setTimeout(() => t.classList.add('toast-hide'), 5500);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 6200);
}

// ═══════════════════════════════════════════════════
//  BUTTONS
// ═══════════════════════════════════════════════════
document.getElementById('btn-new-session').addEventListener('click', newSession);
tabAddBtn.addEventListener('click', newSession);
document.getElementById('btn-start-empty').addEventListener('click', newSession);
document.getElementById('btn-new-folder').addEventListener('click', createFolder);

// Session picker overlay
document.getElementById('sp-close').addEventListener('click', hideSessionPicker);
document.getElementById('session-picker').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideSessionPicker();
});
document.querySelectorAll('.sp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const label = btn.dataset.label || 'Shell';
    const cmd   = btn.dataset.cmd || null;
    hideSessionPicker();
    wsSend({ type: 'session_create', name: label, cmd });
  });
});

document.querySelectorAll('.btn-ai-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    const label = btn.dataset.label || btn.dataset.ai;
    const cmd   = btn.dataset.cmd;
    wsSend({ type: 'session_create', name: label, cmd });
  });
});

// ═══════════════════════════════════════════════════
//  FOLDER SYSTEM
// ═══════════════════════════════════════════════════
const folderMap = new Map(); // folderId → { el, name, open }
let folderCounter = 0;

function createFolder(name) {
  const id = 'folder-' + (++folderCounter);
  const folderName = (typeof name === 'string' && name) ? name : 'Folder ' + folderCounter;

  const el = document.createElement('div');
  el.className = 'folder-item open';
  el.dataset.folderId = id;
  el.innerHTML = `
    <div class="folder-header">
      <span class="folder-arrow">▶</span>
      <span class="folder-icon">📁</span>
      <span class="folder-name">${escHtml(folderName)}</span>
      <span class="folder-count"></span>
      <button class="folder-close-btn" title="Delete folder">✕</button>
    </div>
    <div class="folder-children"></div>
  `;

  const header = el.querySelector('.folder-header');
  const children = el.querySelector('.folder-children');
  const nameEl = el.querySelector('.folder-name');
  const countEl = el.querySelector('.folder-count');
  const closeBtn = el.querySelector('.folder-close-btn');

  // Toggle open/close
  header.addEventListener('click', e => {
    if (e.target.closest('.folder-close-btn')) return;
    el.classList.toggle('open');
    el.querySelector('.folder-icon').textContent = el.classList.contains('open') ? '📂' : '📁';
  });

  // Double-click to rename
  nameEl.addEventListener('dblclick', e => {
    e.stopPropagation();
    const input = document.createElement('input');
    input.className = 'folder-name-input';
    input.value = nameEl.textContent;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      const newName = input.value.trim() || folderName;
      const span = document.createElement('span');
      span.className = 'folder-name';
      span.textContent = newName;
      span.addEventListener('dblclick', arguments.callee = undefined);
      input.replaceWith(span);
      folderMap.get(id).name = newName;
      // re-attach dblclick
      span.addEventListener('dblclick', ev => { ev.stopPropagation(); nameEl.dispatchEvent(new Event('dblclick')); });
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key==='Enter') commit(); if (e.key==='Escape') { input.value=nameEl.textContent; commit(); } });
  });

  // Delete folder — move sessions out first
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    const sessionList = document.getElementById('session-list');
    [...children.querySelectorAll('.session-item')].forEach(s => sessionList.appendChild(s));
    el.remove();
    folderMap.delete(id);
  });

  // Drag-over for dropping sessions into folder
  el.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('text/sidebar-session')) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drag-over');
    }
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over');
  });
  el.addEventListener('drop', e => {
    const srcId = e.dataTransfer.getData('text/sidebar-session');
    el.classList.remove('drag-over');
    if (!srcId) return;
    e.preventDefault();
    e.stopPropagation();
    const entry = terminalMap.get(srcId);
    if (entry) {
      children.appendChild(entry.sidebarEl);
      el.classList.add('open');
      el.querySelector('.folder-icon').textContent = '📂';
      updateFolderCount(countEl, children);
    }
  });

  document.getElementById('session-list').appendChild(el);
  folderMap.set(id, { el, name: folderName, open: true });
  updateFolderCount(countEl, children);
  return el;
}

function updateFolderCount(countEl, children) {
  const n = children.querySelectorAll('.session-item').length;
  countEl.textContent = n > 0 ? `(${n})` : '';
}

// Make sidebar session items draggable for folder drops
function makeSidebarItemDraggable(el, sessionId) {
  el.draggable = true;
  el.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/sidebar-session', sessionId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => el.style.opacity = '0.4', 0);
  });
  el.addEventListener('dragend', () => {
    el.style.opacity = '';
    document.querySelectorAll('.folder-item.drag-over').forEach(f => f.classList.remove('drag-over'));
    // Also allow drop onto session-list (root) to ungroup
    document.getElementById('session-list').classList.remove('drag-over-root');
  });
}

// Allow dropping back to root session list
const sessionListEl = document.getElementById('session-list');
sessionListEl.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('text/sidebar-session') && e.target === sessionListEl) {
    e.preventDefault();
    sessionListEl.classList.add('drag-over-root');
  }
});
sessionListEl.addEventListener('dragleave', e => {
  if (!sessionListEl.contains(e.relatedTarget)) sessionListEl.classList.remove('drag-over-root');
});
sessionListEl.addEventListener('drop', e => {
  const srcId = e.dataTransfer.getData('text/sidebar-session');
  sessionListEl.classList.remove('drag-over-root');
  if (!srcId) return;
  const entry = terminalMap.get(srcId);
  if (entry && entry.sidebarEl.closest('.folder-children')) {
    e.preventDefault();
    sessionListEl.insertBefore(entry.sidebarEl, document.getElementById('session-empty'));
    // update folder counts
    document.querySelectorAll('.folder-children').forEach(fc => {
      const folder = fc.closest('.folder-item');
      if (folder) updateFolderCount(folder.querySelector('.folder-count'), fc);
    });
  }
});

// ═══════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════
