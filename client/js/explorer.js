// ─── FILE EXPLORER PANEL ─────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { showToast } from './toast.js';
import { openFileTab } from './file-viewer.js';
import { ContextMenu } from './context-menu.js';

let explorerTree = [];
let expandedDirs = new Set();
let currentDir = '';
let gitStatusMap = {}; // { relativePath: status }

const isDir = (ctx) => ctx.type === 'directory';

const explorerMenu = new ContextMenu([
  { label: '📄 New File',            action: 'new-file' },
  { label: '📁 New Folder',          action: 'new-folder' },
  '---',
  { label: '▶ Open Terminal Here',   action: 'open-terminal',  when: isDir },
  { label: '▶ Open with Claude',     action: 'open-claude',    when: isDir },
  { label: '▶ Open with OpenCode',   action: 'open-opencode',  when: isDir },
  { label: '▶ Open with Gemini',     action: 'open-gemini',    when: isDir },
  { label: '▶ Open with Codex',      action: 'open-codex',     when: isDir },
  '---',
  { label: '📋 Copy Path',           action: 'copy-path' },
  { label: '📑 Duplicate',           action: 'duplicate' },
  '---',
  { label: '✎ Rename',              action: 'rename' },
  { label: '✕ Delete',              action: 'delete', danger: true },
], handleExplorerAction);

function getAbsPath(relPath) {
  const meta = sessionMeta.get(S.activeSessionId);
  if (!meta?.cwd) return relPath;
  return meta.cwd.replace(/\/+$/, '') + '/' + relPath;
}

function getDirPath(path, type) {
  return type === 'directory' ? path : path.split('/').slice(0, -1).join('/');
}

function handleExplorerAction(action, ctx) {
  if (!S.activeSessionId) return;

  switch (action) {
    case 'new-file': {
      const name = prompt('New file name:');
      if (!name) return;
      const dir = getDirPath(ctx.path, ctx.type);
      const filePath = dir ? `${dir}/${name}` : name;
      wsSend({ type: 'file_create', sessionId: S.activeSessionId, filePath, isDir: false });
      break;
    }
    case 'new-folder': {
      const name = prompt('New folder name:');
      if (!name) return;
      const dir = getDirPath(ctx.path, ctx.type);
      const filePath = dir ? `${dir}/${name}` : name;
      wsSend({ type: 'file_create', sessionId: S.activeSessionId, filePath, isDir: true });
      break;
    }
    case 'open-terminal': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Shell', cwd: absPath });
      break;
    }
    case 'open-claude': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Claude', cwd: absPath, cmd: 'claude' });
      break;
    }
    case 'open-opencode': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'OpenCode', cwd: absPath, cmd: 'opencode' });
      break;
    }
    case 'open-gemini': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Gemini', cwd: absPath, cmd: 'gemini' });
      break;
    }
    case 'open-codex': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Codex', cwd: absPath, cmd: 'codex' });
      break;
    }
    case 'copy-path': {
      const absPath = getAbsPath(ctx.path);
      navigator.clipboard.writeText(absPath).catch(() => {});
      showToast('Path copied', 'success');
      break;
    }
    case 'duplicate': {
      wsSend({ type: 'file_duplicate', sessionId: S.activeSessionId, filePath: ctx.path });
      break;
    }
    case 'rename': {
      const oldName = ctx.path.split('/').pop();
      const newName = prompt('Rename to:', oldName);
      if (!newName || newName === oldName) return;
      const dir = ctx.path.split('/').slice(0, -1).join('/');
      const newPath = dir ? `${dir}/${newName}` : newName;
      wsSend({ type: 'file_rename', sessionId: S.activeSessionId, oldPath: ctx.path, newPath });
      break;
    }
    case 'delete': {
      const name = ctx.path.split('/').pop();
      if (!confirm(`Delete "${name}"?`)) return;
      wsSend({ type: 'file_delete', sessionId: S.activeSessionId, filePath: ctx.path });
      break;
    }
  }
}

export function initExplorer() {
  // No static menu setup needed — ContextMenu handles everything dynamically
}

export function requestFileTree() {
  if (!S.activeSessionId) return;
  const meta = sessionMeta.get(S.activeSessionId);
  const dir = meta?.cwd || '';
  if (!dir) return;
  currentDir = dir;
  wsSend({ type: 'file_tree', sessionId: S.activeSessionId, dir });
}

export function handleFileTreeData(msg) {
  explorerTree = msg.tree || [];
  currentDir = msg.dir || '';
  gitStatusMap = msg.gitStatus || {};
  renderExplorer();
}

function renderExplorer() {
  const container = document.getElementById('explorer-tree');
  if (!container) return;

  const headerPath = document.getElementById('explorer-path');
  if (headerPath) {
    const parts = currentDir.split('/');
    headerPath.textContent = parts[parts.length - 1] || currentDir;
    headerPath.title = currentDir;
  }

  if (explorerTree.length === 0) {
    container.innerHTML = '<div class="explorer-empty">No files found</div>';
    return;
  }

  container.innerHTML = '';
  renderTreeLevel(container, explorerTree, 0);
}

function renderTreeLevel(parent, entries, depth) {
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'explorer-item' + (entry.type === 'directory' ? ' is-dir' : '');
    item.style.paddingLeft = (12 + depth * 16) + 'px';
    item.dataset.path = entry.path;

    if (entry.type === 'directory') {
      const isExpanded = expandedDirs.has(entry.path);
      const dirHasChanges = hasDirChanges(entry.path);
      item.innerHTML = `<span class="explorer-arrow">${isExpanded ? '▾' : '▸'}</span>` +
        `<span class="explorer-icon">📁</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>` +
        (dirHasChanges ? `<span class="explorer-git-dot"></span>` : '');
      item.addEventListener('click', () => {
        if (expandedDirs.has(entry.path)) {
          expandedDirs.delete(entry.path);
        } else {
          expandedDirs.add(entry.path);
        }
        renderExplorer();
      });
      item.addEventListener('contextmenu', (e) => explorerMenu.show(e, { path: entry.path, type: 'directory' }));
      parent.appendChild(item);

      if (isExpanded && entry.children) {
        renderTreeLevel(parent, entry.children, depth + 1);
      }
    } else {
      const icon = getFileIcon(entry.name);
      const status = gitStatusMap[entry.path];
      const statusBadge = status ? `<span class="explorer-git-badge explorer-git-${getGitClass(status)}">${getGitLabel(status)}</span>` : '';
      item.innerHTML = `<span class="explorer-arrow" style="visibility:hidden">▸</span>` +
        `<span class="explorer-icon">${icon}</span>` +
        `<span class="explorer-name${status ? ' explorer-git-' + getGitClass(status) + '-name' : ''}">${escHtml(entry.name)}</span>` +
        statusBadge;
      item.addEventListener('click', () => {
        if (!S.activeSessionId) return;
        wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath: entry.path });
      });
      item.addEventListener('contextmenu', (e) => explorerMenu.show(e, { path: entry.path, type: 'file' }));
      parent.appendChild(item);
    }
  }
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap = {
    js: '📜', ts: '📘', jsx: '⚛', tsx: '⚛',
    json: '{}', md: '📝', css: '🎨', html: '🌐',
    py: '🐍', rs: '🦀', go: '🐹', rb: '💎',
    sh: '$_', yml: '⚙', yaml: '⚙', toml: '⚙',
    png: '🖼', jpg: '🖼', gif: '🖼', svg: '🖼', webp: '🖼',
    lock: '🔒',
  };
  return iconMap[ext] || '📄';
}

function getGitClass(status) {
  const map = { 'M': 'modified', 'A': 'added', 'D': 'deleted', 'R': 'renamed', 'U': 'untracked', '?': 'untracked' };
  return map[status] || 'modified';
}

function getGitLabel(status) {
  const map = { 'M': 'M', 'A': 'A', 'D': 'D', 'R': 'R', 'U': 'U', '?': 'U' };
  return map[status] || status;
}

function hasDirChanges(dirPath) {
  const prefix = dirPath + '/';
  return Object.keys(gitStatusMap).some(p => p === dirPath || p.startsWith(prefix));
}

export function handleFileOpAck(msg) {
  if (msg.ok) {
    requestFileTree();
    showToast(`File ${msg.op} successful`, 'success');
  } else {
    showToast(`File ${msg.op} failed: ${msg.error}`, 'error', 4000);
  }
}

export function handleFileReadData(msg) {
  openFileTab(msg.filePath || 'unknown', msg.content || '', {
    binary: msg.binary,
    error: msg.error,
  });
}

export function onExplorerSessionChange() {
  requestFileTree();
}
