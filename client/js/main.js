import { S, terminalMap, sessionMeta, sbClock, tabAddBtn, settingsOverlay } from './state.js';
import { THEMES } from './constants.js';
import { connect, wsSend, setOnInputSend } from './websocket.js';
import { initThemeSwatches } from './themes.js';
import { activateSession, updateStatusBar } from './session.js';
import { initSplitDnD, refitAllPanes, updateSidebarSplitGroup } from './split-pane.js';
import { newSession, closeSession, renameSession, syncSessionList, attachTerminal, updateSessionInfo, showSessionPicker, hideSessionPicker, initContextMenu } from './terminal.js';
import { loadSettings, applySettings, openSettings, closeSettings, initSettingsUI } from './settings.js';
import { aiNotifyCheck, resetNotifyState, initNotifications } from './notifications.js';
import { createFolder, initFolderDnD } from './folder.js';

S.currentTheme = THEMES[0];

setOnInputSend(resetNotifyState);

const hdrTime = document.getElementById('hdr-time');
setInterval(() => {
  const t = new Date().toTimeString().slice(0,8);
  sbClock.textContent = t;
  hdrTime.textContent = t;
}, 1000);

function handleMessage(msg) {
  if (msg.type === 'session_list') {
    syncSessionList(msg.sessions, S.wsJustReconnected);
    S.wsJustReconnected = false;
  } else if (msg.type === 'settings') {
    applySettings(msg.settings);
  } else if (msg.type === 'session_created') {
    attachTerminal(msg.sessionId, msg.name);
    if (S.pendingSplitQueue.length > 0) {
      const pending = S.pendingSplitQueue.shift();
      pending.resolve(msg.sessionId);
    } else {
      activateSession(msg.sessionId);
      wsSend({ type:'session_attach', sessionId: msg.sessionId });
      setTimeout(() => {
        const e = terminalMap.get(msg.sessionId);
        if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:msg.sessionId, cols:e.term.cols, rows:e.term.rows }); }
      }, 50);
    }
  } else if (msg.type === 'session_attached') {
    activateSession(msg.sessionId);
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
}

document.addEventListener('keydown', e => {
  if (!S.settings) return;

  if (e.key === 'Escape') {
    const picker = document.getElementById('session-picker');
    if (picker.style.display !== 'none') { hideSessionPicker(); return; }
    if (settingsOverlay.classList.contains('open')) { closeSettings(); return; }
  }

  if (settingsOverlay.classList.contains('open')) return;

  if (e.ctrlKey && e.shiftKey && S.layoutTree !== null) {
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
      collectPanes(S.layoutTree);
      const activeEntry = terminalMap.get(S.activeSessionId);
      if (!activeEntry) return;
      const ar = activeEntry.div.getBoundingClientRect();
      const ax = ar.left + ar.width/2, ay = ar.top + ar.height/2;
      const coneMap = { left: Math.PI, right: 0, up: -Math.PI/2, down: Math.PI/2 };
      const targetAngle = coneMap[dir];
      let best = null, bestDist = Infinity;
      panes.forEach(p => {
        if (p.sessionId === S.activeSessionId) return;
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

  const kb = S.settings.keybindings || {};
  if (combo === kb.newSession)   { e.preventDefault(); newSession(); }
  if (combo === kb.closeSession && S.activeSessionId) { e.preventDefault(); closeSession(S.activeSessionId); }
  if (combo === kb.openSettings) { e.preventDefault(); openSettings(); }
  if (combo === kb.fullscreen)   { e.preventDefault(); toggleFullscreen(); }
  if (combo === kb.nextTab)      { e.preventDefault(); switchTabBy(1); }
  if (combo === kb.prevTab)      { e.preventDefault(); switchTabBy(-1); }
  if (combo === kb.renameSession && S.activeSessionId) { e.preventDefault(); promptRenameSession(S.activeSessionId); }
  if (combo === kb.clearTerminal && S.activeSessionId) { e.preventDefault(); clearActiveTerminal(); }

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
  if (!S.activeSessionId) return;
  const entry = terminalMap.get(S.activeSessionId);
  if (entry) entry.term.clear();
}

function switchTabBy(dir) {
  const ids = Array.from(terminalMap.keys());
  if (ids.length < 2) return;
  const idx = ids.indexOf(S.activeSessionId);
  const next = ids[(idx + dir + ids.length) % ids.length];
  activateSession(next);
  wsSend({ type:'session_attach', sessionId: next });
}

window.addEventListener('resize', () => {
  terminalMap.forEach(({ fitAddon }) => fitAddon.fit());
});

document.getElementById('btn-new-session').addEventListener('click', newSession);
tabAddBtn.addEventListener('click', newSession);
document.getElementById('btn-start-empty').addEventListener('click', newSession);
document.getElementById('btn-new-folder').addEventListener('click', createFolder);

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

initThemeSwatches();
initContextMenu();
initSettingsUI();
initSplitDnD();
initFolderDnD();
initNotifications();

loadSettings().then(() => connect(handleMessage));
