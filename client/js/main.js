import { S, terminalMap, sessionMeta, sbClock, tabAddBtn, settingsOverlay } from './state.js';
import { THEMES } from './constants.js';
import { connect, wsSend, setOnInputSend, requestScrollback } from './websocket.js';
import { initThemeSwatches } from './themes.js';
import { activateSession, updateStatusBar, setOnSessionChangeSidePanels } from './session.js';
import { initSplitDnD, refitAllPanes, updateSidebarSplitGroup } from './split-pane.js';
import { newSession, closeSession, renameSession, syncSessionList, attachTerminal, updateSessionInfo, showSessionPicker, hideSessionPicker, initContextMenu } from './terminal.js';
import { loadSettings, applySettings, openSettings, closeSettings, initSettingsUI } from './settings.js';
import { aiNotifyCheck, resetNotifyState, initNotifications } from './notifications.js';
import { tabStatusCheck, tabStatusOnAiChange, suppressTabStatus } from './tab-status.js';
import { initFolderDnD } from './folder.js';
import { openGitGraph, closeGitGraph, isGitGraphOpen, handleGitGraphData, handleGitFileListData, handleGitBranchData, handleGitBranchListData, handleGitRemoteUrlData, handleGitCheckoutAck, handleGitPullAck, requestBranch, handleGitGraphKeydown } from './git-graph.js';
import { streamWrite, bypassStream, unbypassStream } from './stream-writer.js';
import { registerAction, buildCombo, matchCombo, tryKeybinding } from './keyboard.js';
import { initInputPanel, onSessionChange as inputPanelSessionChange } from './input-panel.js';
import { handleClaudeUsageData, startUsagePolling, onSessionChangeUsage, onAiChangeUsage } from './claude-usage.js';
import { initActivityBar, getActivePanel, switchPanel, toggleSidebarExport, initSidebarResize } from './activity-bar.js';
import { initExplorer, handleFileTreeData, handleFileReadData, handleFileOpAck, onExplorerSessionChange, requestFileTree } from './explorer.js';
import { initSourceControl, handleGitStatusData, handleGitDiffData, handleGitCommitAck, handleGitPushAck, handleGitGenerateMessage, onSourceControlSessionChange, handleWorktreeListData, handleWorktreeAddAck, handleWorktreeRemoveAck, handleWorktreeSwitchAck } from './source-control.js';
import { initSearch, handleSearchResults, handleReplaceAck, onSearchSessionChange } from './search.js';
import { setActivateSessionFn } from './file-viewer.js';
import { initPlanPanel, handlePlanFileData, onPlanSessionChange } from './plan-panel.js';
import './mobile.js'; // auto-initializes mobile UI

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
    if (S.wsJustReconnected) {
      msg.sessions.forEach(s => {
        suppressTabStatus(s.id, 2000);
        // Scrollback is now auto-sent by per-session data WS on connect
      });
    }
    S.wsJustReconnected = false;
    // Auto-close git graph if active session is gone
    if (isGitGraphOpen() && S.activeSessionId && !msg.sessions.some(s => s.id === S.activeSessionId)) {
      closeGitGraph();
    }
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
    onSessionChangeUsage();
    setTimeout(() => {
      const e = terminalMap.get(msg.sessionId);
      if (e) { e.fitAddon.fit(); wsSend({ type:'resize', sessionId:msg.sessionId, cols:e.term.cols, rows:e.term.rows }); }
    }, 50);
  } else if (msg.type === 'session_info') {
    updateSessionInfo(msg.sessionId, msg.cwd, msg.ai);
    tabStatusOnAiChange(msg.sessionId, msg.ai);
    onAiChangeUsage(msg.sessionId, msg.ai);
    if (msg.sessionId === S.activeSessionId) {
      requestBranch(msg.sessionId);
      // Refresh all relevant side panels when CWD changes (e.g. worktree switch)
      const panel = getActivePanel();
      if (panel === 'explorer') onExplorerSessionChange();
      else if (panel === 'source-control') onSourceControlSessionChange();
      else if (panel === 'search') onSearchSessionChange();
      else if (panel === 'plan') onPlanSessionChange();
      // Always refresh source control status in background for badge updates
      if (panel !== 'source-control') onSourceControlSessionChange();
    }
  // output and scrollback are now handled by per-session data WebSocket in terminal.js
  } else if (msg.type === 'git_graph_data') {
    handleGitGraphData(msg);
  } else if (msg.type === 'git_file_list_data') {
    handleGitFileListData(msg);
  } else if (msg.type === 'git_branch_data') {
    handleGitBranchData(msg);
  } else if (msg.type === 'git_branch_list_data') {
    handleGitBranchListData(msg);
  } else if (msg.type === 'git_remote_url_data') {
    handleGitRemoteUrlData(msg);
  } else if (msg.type === 'git_checkout_ack') {
    handleGitCheckoutAck(msg);
  } else if (msg.type === 'git_pull_ack') {
    handleGitPullAck(msg);
  } else if (msg.type === 'claude_usage_data') {
    handleClaudeUsageData(msg);
  } else if (msg.type === 'file_tree_data') {
    handleFileTreeData(msg);
  } else if (msg.type === 'git_status_data') {
    handleGitStatusData(msg);
  } else if (msg.type === 'git_diff_data') {
    handleGitDiffData(msg);
  } else if (msg.type === 'git_commit_ack') {
    handleGitCommitAck(msg);
  } else if (msg.type === 'git_push_ack') {
    handleGitPushAck(msg);
  } else if (msg.type === 'git_generate_message_data') {
    handleGitGenerateMessage(msg);
  } else if (msg.type === 'git_worktree_list_data') {
    handleWorktreeListData(msg);
  } else if (msg.type === 'git_worktree_add_ack') {
    handleWorktreeAddAck(msg);
  } else if (msg.type === 'git_worktree_remove_ack') {
    handleWorktreeRemoveAck(msg);
  } else if (msg.type === 'git_worktree_switch_ack') {
    handleWorktreeSwitchAck(msg);
  } else if (msg.type === 'file_search_data') {
    handleSearchResults(msg);
  } else if (msg.type === 'file_replace_ack') {
    handleReplaceAck(msg);
  } else if (msg.type === 'file_read_data') {
    handleFileReadData(msg);
    // Also route to plan panel for .md files
    if (msg.filePath && /\.(md|markdown)$/i.test(msg.filePath)) {
      handlePlanFileData(msg);
    }
  } else if (msg.type === 'file_op_ack') {
    handleFileOpAck(msg);
  }
}

// ─── REGISTER KEYBINDING ACTIONS ─────────────────────
registerAction('newSession',    () => newSession());
registerAction('closeSession',  () => { if (S.activeSessionId) closeSession(S.activeSessionId); });
registerAction('openSettings',  () => openSettings());
registerAction('fullscreen',    () => toggleFullscreen());
registerAction('nextTab',       () => switchTabBy(1));
registerAction('prevTab',       () => switchTabBy(-1));
registerAction('renameSession', () => { if (S.activeSessionId) promptRenameSession(S.activeSessionId); });
registerAction('clearTerminal', () => clearActiveTerminal());
registerAction('gitGraph',      () => { isGitGraphOpen() ? closeGitGraph() : openGitGraph(); });
registerAction('toggleSidebar', () => toggleSidebarExport());
registerAction('focusSearch',   () => switchPanel('search'));
registerAction('focusExplorer', () => switchPanel('explorer'));
registerAction('focusSourceControl', () => switchPanel('source-control'));

document.addEventListener('keydown', e => {
  if (!S.settings) return;

  // Git graph modal handles its own keys (arrows, enter, escape)
  if (isGitGraphOpen() && handleGitGraphKeydown(e)) return;

  if (e.key === 'Escape') {
    const picker = document.getElementById('session-picker');
    if (picker.style.display !== 'none') { hideSessionPicker(); return; }
    if (settingsOverlay.classList.contains('open')) { closeSettings(); return; }
  }

  if (settingsOverlay.classList.contains('open')) return;

  // Split pane navigation: Ctrl+Shift+Arrow
  if (e.ctrlKey && e.shiftKey && S.layoutTree !== null) {
    const dirs = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down' };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      navigateSplitPane(dir);
      return;
    }
  }

  // Centralized keybinding handling
  if (tryKeybinding(e)) return;

  // Cmd+1~9: switch to Nth tab
  if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
    const combo = buildCombo(e);
    const n = parseInt(combo.replace('Meta+', ''));
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

function navigateSplitPane(dir) {
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
}

window.addEventListener('resize', () => {
  terminalMap.forEach(({ fitAddon }) => fitAddon.fit());
});

tabAddBtn.addEventListener('click', newSession);
document.getElementById('btn-start-empty').addEventListener('click', newSession);

document.getElementById('sp-close').addEventListener('click', hideSessionPicker);
document.getElementById('session-picker').addEventListener('click', e => {
  if (e.target === e.currentTarget) hideSessionPicker();
});
function getCurrentSessionCwd() {
  if (!S.activeSessionId) return undefined;
  const meta = sessionMeta.get(S.activeSessionId);
  return meta?.cwd || undefined;
}

document.querySelectorAll('.sp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const label = btn.dataset.label || 'Shell';
    const cmd   = btn.dataset.cmd || null;
    hideSessionPicker();
    wsSend({ type: 'session_create', name: label, cmd, cwd: getCurrentSessionCwd() });
  });
});

document.querySelectorAll('.btn-ai-quick').forEach(btn => {
  btn.addEventListener('click', () => {
    const label = btn.dataset.label || btn.dataset.ai;
    const cmd   = btn.dataset.cmd;
    wsSend({ type: 'session_create', name: label, cmd, cwd: getCurrentSessionCwd() });
  });
});

initThemeSwatches();
initContextMenu();
initSettingsUI();
initSplitDnD();
initFolderDnD();
initNotifications();
initInputPanel();
initActivityBar();
initSidebarResize();
initExplorer();
initSourceControl();
initSearch();
initPlanPanel();

// Wire up file viewer's lazy dependency
setActivateSessionFn(activateSession);

// Register side panel refresh on session change
setOnSessionChangeSidePanels(() => {
  const panel = getActivePanel();
  if (panel === 'explorer') onExplorerSessionChange();
  else if (panel === 'source-control') onSourceControlSessionChange();
  else if (panel === 'search') onSearchSessionChange();
});

// Explorer refresh button
document.getElementById('explorer-refresh')?.addEventListener('click', requestFileTree);

// Diff modal is now handled internally by source-control.js

loadSettings().then(() => { connect(handleMessage); startUsagePolling(); });
