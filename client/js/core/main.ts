import 'highlight.js/styles/vs2015.css';
import { S, terminalMap, sessionMeta, tabBar, tabAddBtn, settingsOverlay } from './state';
import { THEMES } from './constants';
import { connect, wsSend, setOnInputSend, requestScrollback } from './websocket';
import { initThemeSwatches } from '../ui/themes';
import { activateSession, updateStatusBar, setOnSessionChangeSidePanels } from '../terminal/session';
import { initSplitDnD, refitAllPanes, updateSidebarSplitGroup } from '../terminal/split-pane';
import {
  newSession,
  closeSession,
  renameSession,
  syncSessionList,
  attachTerminal,
  updateSessionInfo,
  showSessionPicker,
  hideSessionPicker,
  initContextMenu,
} from '../terminal/terminal';
import {
  loadSettings,
  applySettings,
  openSettings,
  closeSettings,
  initSettingsUI,
} from '../ui/settings';
import { aiNotifyCheck, resetNotifyState, initNotifications } from '../ui/notifications';
import { tabStatusCheck, tabStatusOnAiChange, suppressTabStatus } from '../ui/tab-status';
import { initFolderDnD } from '../ui/folder';
import {
  openGitGraph,
  closeGitGraph,
  isGitGraphOpen,
  handleGitGraphData,
  handleGitFileListData,
  handleGitBranchData,
  handleGitBranchListData,
  handleGitRemoteUrlData,
  handleGitCheckoutAck,
  handleGitPullAck,
  handleGitPushAckInGraph,
  handleGitGraphSearchData,
  requestBranch,
  handleGitGraphKeydown,
} from '../sidebar/git-graph';
import { streamWrite, bypassStream, unbypassStream } from '../terminal/stream-writer';
import { registerAction, buildCombo, matchCombo, tryKeybinding } from './keyboard';
import {
  initInputPanel,
  toggleInputPanel,
  onSessionChange as inputPanelSessionChange,
  handleClaudePrompts,
} from '../sidebar/prompt-history';
import {
  initActivityBar,
  getActivePanel,
  switchPanel,
  toggleSidebarExport,
  initSidebarResize,
} from '../sidebar/activity-bar';
import {
  initExplorer,
  handleFileTreeData,
  handleFileReadData,
  handleFileOpAck,
  onExplorerSessionChange,
  requestFileTree,
} from '../sidebar/explorer';
import {
  initSourceControl,
  handleGitStatusData,
  handleGitDiffData,
  handleGitCommitAck,
  handleGitPushAck,
  handleGitGenerateMessage,
  onSourceControlSessionChange,
  handleWorktreeListData,
  handleWorktreeAddAck,
  handleWorktreeRemoveAck,
  handleWorktreeSwitchAck,
} from '../sidebar/source-control';
import {
  initSearch,
  handleSearchResults,
  handleReplaceAck,
  onSearchSessionChange,
} from '../sidebar/search';
import { setActivateSessionFn, handleFileSaveResult, getActiveFilePath, closeFileTab, activateFileTab } from '../editor/file-viewer';
import {
  initPlanPanel,
  handlePlanFileData,
  onPlanSessionChange,
  openPlanModal,
  closePlanModal,
  isPlanModalOpen,
  showPlanToast,
  onAiSessionCreated,
  onAiSessionReady,
  onAiPromptSent,
  onHeadlessStarted,
  onHeadlessDone,
  onHeadlessFailed,
  onHeadlessSync,
  updateAiTasksBadge,
} from '../sidebar/plan-panel';
import { initControlPanel } from '../terminal/control-panel';
// Side-effect imports — modules with self-initializing code
import '../ui/scroll-float'
import '../ui/mobile'

S.currentTheme = THEMES[0];

setOnInputSend(resetNotifyState);

const hdrTime = document.getElementById('hdr-time');
const sbClock = document.getElementById('sb-clock');
setInterval(() => {
  const t = new Date().toTimeString().slice(0, 8);
  sbClock.textContent = t;
  hdrTime.textContent = t;
}, 1000);

function handleMessage(msg) {
  if (msg.type === 'session_list') {
    syncSessionList(msg.sessions, S.wsJustReconnected);
    if (S.wsJustReconnected) {
      msg.sessions.forEach((s) => {
        suppressTabStatus(s.id, 2000);
        // Scrollback is now auto-sent by per-session data WS on connect
      });
    }
    S.wsJustReconnected = false;
    // Auto-close git graph if active session is gone
    if (
      isGitGraphOpen() &&
      S.activeSessionId &&
      !msg.sessions.some((s) => s.id === S.activeSessionId)
    ) {
      closeGitGraph();
    }
  } else if (msg.type === 'settings') {
    applySettings(msg.settings);
  } else if (msg.type === 'session_created') {
    attachTerminal(msg.sessionId, msg.name);
    onAiSessionCreated(msg.sessionId);
    if (S.pendingSplitQueue.length > 0) {
      const pending = S.pendingSplitQueue.shift();
      pending.resolve(msg.sessionId);
    } else {
      activateSession(msg.sessionId);
      wsSend({ type: 'session_attach', sessionId: msg.sessionId });
      setTimeout(() => {
        const e = terminalMap.get(msg.sessionId);
        if (e) {
          e.fitAddon.fit();
          e.term.scrollToBottom();
          wsSend({
            type: 'resize',
            sessionId: msg.sessionId,
            cols: e.term.cols,
            rows: e.term.rows,
          });
        }
      }, 50);
    }
  } else if (msg.type === 'session_attached') {
    activateSession(msg.sessionId);

    setTimeout(() => {
      const e = terminalMap.get(msg.sessionId);
      if (e) {
        e.fitAddon.fit();
        e.term.scrollToBottom();
        wsSend({ type: 'resize', sessionId: msg.sessionId, cols: e.term.cols, rows: e.term.rows });
      }
    }, 50);
  } else if (msg.type === 'session_info') {
    updateSessionInfo(msg.sessionId, msg.cwd, msg.ai);
    tabStatusOnAiChange(msg.sessionId, msg.ai);

    if (msg.ai) onAiSessionReady(msg.sessionId);
    if (msg.sessionId === S.activeSessionId) {
      updateProjectName(msg.cwd);
      requestBranch(msg.sessionId);
      inputPanelSessionChange();
      // Refresh all relevant side panels when CWD changes (e.g. worktree switch)
      const panel = getActivePanel();
      if (panel === 'explorer') onExplorerSessionChange();
      else if (panel === 'source-control') onSourceControlSessionChange();
      else if (panel === 'search') onSearchSessionChange();
      else if (panel === 'plan') onPlanSessionChange();
      // Always refresh source control status in background for badge updates
      if (panel !== 'source-control') onSourceControlSessionChange();
    }
  } else if (msg.type === 'ai_prompt_sent') {
    onAiPromptSent(msg.sessionId);
    // output and scrollback are now handled by per-session data WebSocket in terminal.js
  } else if (msg.type === 'headless_started') {
    onHeadlessStarted(msg);
  } else if (msg.type === 'headless_done') {
    onHeadlessDone(msg);
  } else if (msg.type === 'headless_failed') {
    onHeadlessFailed(msg);
  } else if (msg.type === 'headless_sync') {
    onHeadlessSync(msg.jobs);
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
  } else if (msg.type === 'git_graph_search_data') {
    handleGitGraphSearchData(msg);
  } else if (msg.type === 'claude_prompts_data') {
    handleClaudePrompts(msg);
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
    handleGitPushAckInGraph(msg);
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
      handlePlanFileData();
    }
  } else if (msg.type === 'file_save_result') {
    handleFileSaveResult(msg.filePath, msg.success, msg.error);
  } else if (msg.type === 'file_op_ack') {
    handleFileOpAck(msg);
  } else if (msg.type === 'plan_ai_done') {
    showPlanToast(msg.planId, msg.planTitle);
  }
}

// ─── REGISTER KEYBINDING ACTIONS ─────────────────────
registerAction('newSession', () => newSession());
const closeTabAction = () => {
  const fp = getActiveFilePath();
  if (fp) closeFileTab(fp);
  else if (S.activeSessionId) closeSession(S.activeSessionId);
};
registerAction('closeTab', closeTabAction);
registerAction('closeSession', closeTabAction); // backward-compat: old saved keybindings
registerAction('openSettings', () => openSettings());
registerAction('fullscreen', () => toggleFullscreen());
registerAction('nextTab', () => switchTabBy(1));
registerAction('prevTab', () => switchTabBy(-1));
registerAction('renameSession', () => {
  if (S.activeSessionId) promptRenameSession(S.activeSessionId);
});
registerAction('clearTerminal', () => clearActiveTerminal());
registerAction('gitGraph', () => {
  isGitGraphOpen() ? closeGitGraph() : openGitGraph();
});
registerAction('toggleSidebar', () => toggleSidebarExport());
registerAction('focusSearch', () => switchPanel('search'));
registerAction('focusExplorer', () => switchPanel('explorer'));
registerAction('focusSourceControl', () => switchPanel('source-control'));
registerAction('toggleInputPanel', () => toggleInputPanel());
registerAction('planModal', () => {
  isPlanModalOpen() ? closePlanModal() : openPlanModal();
});

document.addEventListener('keydown', (e) => {
  if (!S.settings) return;

  // Git graph modal handles its own keys (arrows, enter, escape)
  if (isGitGraphOpen() && handleGitGraphKeydown(e)) return;

  if (e.key === 'Escape') {
    const picker = document.getElementById('session-picker');
    if (picker.style.display !== 'none') {
      hideSessionPicker();
      return;
    }
    if (isPlanModalOpen()) {
      closePlanModal();
      return;
    }
    if (settingsOverlay.classList.contains('open')) {
      closeSettings();
      return;
    }
  }

  if (isPlanModalOpen()) return;
  if (settingsOverlay.classList.contains('open')) return;

  // Split pane navigation: Ctrl+Shift+Arrow
  if (e.ctrlKey && e.shiftKey && S.layoutTree !== null) {
    const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      navigateSplitPane(dir);
      return;
    }
  }

  // Centralized keybinding handling
  if (tryKeybinding(e)) return;

  // Cmd+1~9: switch to Nth tab (terminal + file tabs in DOM order)
  if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
    const combo = buildCombo(e);
    const n = parseInt(combo.replace('Meta+', ''));
    if (n >= 1 && n <= 9) {
      const tabs = [...tabBar.querySelectorAll('.tab')];
      const target = tabs[n - 1];
      if (target) {
        e.preventDefault();
        const sessionId = (target as HTMLElement).dataset.sessionId;
        const filePath = (target as HTMLElement).dataset.filePath;
        if (sessionId) {
          activateSession(sessionId);
          wsSend({ type: 'session_attach', sessionId });
        } else if (filePath) {
          activateFileTab(filePath);
        }
      }
    }
  }
});

function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
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
  const tabs = [...tabBar.querySelectorAll('.tab')];
  if (tabs.length < 2) return;
  const activeIdx = tabs.findIndex((t) => t.classList.contains('active'));
  const nextIdx = (activeIdx + dir + tabs.length) % tabs.length;
  const target = tabs[nextIdx];
  const sessionId = (target as HTMLElement).dataset.sessionId;
  const filePath = (target as HTMLElement).dataset.filePath;
  if (sessionId) {
    activateSession(sessionId);
    wsSend({ type: 'session_attach', sessionId });
  } else if (filePath) {
    activateFileTab(filePath);
  }
}

function navigateSplitPane(dir) {
  const panes = [];
  function collectPanes(node) {
    if (!node) return;
    if (node.type === 'pane') {
      const rect = node.element.getBoundingClientRect();
      panes.push({
        sessionId: node.sessionId,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      });
    } else {
      node.children.forEach(collectPanes);
    }
  }
  collectPanes(S.layoutTree);
  const activeEntry = terminalMap.get(S.activeSessionId);
  if (!activeEntry) return;
  const ar = activeEntry.div.getBoundingClientRect();
  const ax = ar.left + ar.width / 2,
    ay = ar.top + ar.height / 2;
  const coneMap = { left: Math.PI, right: 0, up: -Math.PI / 2, down: Math.PI / 2 };
  const targetAngle = coneMap[dir];
  let best = null,
    bestDist = Infinity;
  panes.forEach((p) => {
    if (p.sessionId === S.activeSessionId) return;
    const dx = p.cx - ax,
      dy = p.cy - ay;
    const angle = Math.atan2(dy, dx);
    let diff = angle - targetAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) <= Math.PI / 4) {
      const primaryDist = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy);
      if (primaryDist < bestDist) {
        bestDist = primaryDist;
        best = p;
      }
    }
  });
  if (best) activateSession(best.sessionId);
}

window.addEventListener('resize', () => {
  terminalMap.forEach(({ fitAddon, term }) => {
    fitAddon.fit();
    term.scrollToBottom();
  });
});

tabAddBtn.addEventListener('click', newSession);
document.getElementById('btn-start-empty').addEventListener('click', newSession);

document.getElementById('sp-close').addEventListener('click', hideSessionPicker);
document.getElementById('session-picker').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) hideSessionPicker();
});
function updateProjectName(cwd) {
  const el = document.getElementById('sb-project');
  const nameEl = document.getElementById('sb-project-name');
  const sepEl = document.getElementById('sb-project-sep');
  if (!cwd) {
    el.style.display = 'none';
    sepEl.style.display = 'none';
    return;
  }
  const parts = cwd.replace(/\/$/, '').split('/');
  nameEl.textContent = '💻 ' + (parts[parts.length - 1] || '~');
  el.style.display = '';
  sepEl.style.display = '';
}

function getCurrentSessionCwd() {
  if (!S.activeSessionId) return undefined;
  const meta = sessionMeta.get(S.activeSessionId);
  return meta?.cwd || undefined;
}

document.querySelectorAll('.sp-btn').forEach((btn: Element) => {
  btn.addEventListener('click', () => {
    const label = (btn as HTMLElement).dataset.label || 'Shell';
    const cmd = (btn as HTMLElement).dataset.cmd || null;
    hideSessionPicker();
    wsSend({ type: 'session_create', name: label, cmd, cwd: getCurrentSessionCwd() });
  });
});

document.querySelectorAll('.btn-ai-quick').forEach((btn: Element) => {
  btn.addEventListener('click', () => {
    const label = (btn as HTMLElement).dataset.label || (btn as HTMLElement).dataset.ai;
    const cmd = (btn as HTMLElement).dataset.cmd;
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
initControlPanel();

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

loadSettings().then(() => {
  connect(handleMessage);
});
