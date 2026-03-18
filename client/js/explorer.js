// ─── FILE EXPLORER PANEL ─────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { showToast } from './toast.js';
import { openFileTab } from './file-viewer.js';

let explorerTree = [];
let expandedDirs = new Set();
let currentDir = '';
let gitStatusMap = {}; // { relativePath: status }

let ctxTargetPath = '';
let ctxTargetType = ''; // 'file' | 'directory'

export function initExplorer() {
  // Explorer context menu
  const ctxMenu = document.getElementById('explorer-ctx-menu');
  document.addEventListener('click', () => { if (ctxMenu) ctxMenu.style.display = 'none'; });

  document.getElementById('ectx-new-file')?.addEventListener('click', () => {
    const name = prompt('New file name:');
    if (!name || !S.activeSessionId) return;
    const dir = ctxTargetType === 'directory' ? ctxTargetPath : ctxTargetPath.split('/').slice(0, -1).join('/');
    const filePath = dir ? `${dir}/${name}` : name;
    wsSend({ type: 'file_create', sessionId: S.activeSessionId, filePath, isDir: false });
  });

  document.getElementById('ectx-new-folder')?.addEventListener('click', () => {
    const name = prompt('New folder name:');
    if (!name || !S.activeSessionId) return;
    const dir = ctxTargetType === 'directory' ? ctxTargetPath : ctxTargetPath.split('/').slice(0, -1).join('/');
    const filePath = dir ? `${dir}/${name}` : name;
    wsSend({ type: 'file_create', sessionId: S.activeSessionId, filePath, isDir: true });
  });

  document.getElementById('ectx-rename')?.addEventListener('click', () => {
    const oldName = ctxTargetPath.split('/').pop();
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName || !S.activeSessionId) return;
    const dir = ctxTargetPath.split('/').slice(0, -1).join('/');
    const newPath = dir ? `${dir}/${newName}` : newName;
    wsSend({ type: 'file_rename', sessionId: S.activeSessionId, oldPath: ctxTargetPath, newPath });
  });

  document.getElementById('ectx-delete')?.addEventListener('click', () => {
    const name = ctxTargetPath.split('/').pop();
    if (!confirm(`Delete "${name}"?`) || !S.activeSessionId) return;
    wsSend({ type: 'file_delete', sessionId: S.activeSessionId, filePath: ctxTargetPath });
  });
}

function showExplorerCtx(e, path, type) {
  e.preventDefault();
  e.stopPropagation();
  ctxTargetPath = path;
  ctxTargetType = type;
  const menu = document.getElementById('explorer-ctx-menu');
  if (!menu) return;
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
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
      item.addEventListener('contextmenu', (e) => showExplorerCtx(e, entry.path, 'directory'));
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
      item.addEventListener('contextmenu', (e) => showExplorerCtx(e, entry.path, 'file'));
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
