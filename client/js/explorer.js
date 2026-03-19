// ─── FILE EXPLORER PANEL ─────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend, apiFetch } from './websocket.js';
import { showToast } from './toast.js';
import { confirmModal } from './confirm-modal.js';
import { openFileTab } from './file-viewer.js';

let explorerTree = [];
const expandedDirs = new Set();
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

  document.getElementById('ectx-delete')?.addEventListener('click', async () => {
    const name = ctxTargetPath.split('/').pop();
    if (!await confirmModal(`Delete "${name}"?`, 'Delete') || !S.activeSessionId) return;
    wsSend({ type: 'file_delete', sessionId: S.activeSessionId, filePath: ctxTargetPath });
  });

  document.getElementById('ectx-download')?.addEventListener('click', () => {
    if (!ctxTargetPath || ctxTargetType !== 'file' || !S.activeSessionId) return;
    downloadFile(ctxTargetPath);
  });

  document.getElementById('ectx-reveal')?.addEventListener('click', () => {
    if (!ctxTargetPath || !S.activeSessionId) return;
    wsSend({ type: 'file_reveal', sessionId: S.activeSessionId, filePath: ctxTargetPath });
  });

  // Upload button
  const uploadBtn = document.getElementById('explorer-upload');
  const uploadInput = document.getElementById('explorer-upload-input');
  uploadBtn?.addEventListener('click', () => uploadInput?.click());
  uploadInput?.addEventListener('change', async () => {
    if (!uploadInput.files?.length || !S.activeSessionId) return;
    for (const file of uploadInput.files) {
      await uploadFile(file);
    }
    uploadInput.value = '';
    requestFileTree();
  });

  // Drag & drop upload on explorer tree
  const treeEl = document.getElementById('explorer-tree');
  treeEl?.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      treeEl.classList.add('drop-target');
    }
  });
  treeEl?.addEventListener('dragleave', () => treeEl.classList.remove('drop-target'));
  treeEl?.addEventListener('drop', async (e) => {
    e.preventDefault();
    treeEl.classList.remove('drop-target');
    if (!e.dataTransfer?.files.length || !S.activeSessionId) return;
    for (const file of e.dataTransfer.files) {
      await uploadFile(file);
    }
    requestFileTree();
  });
}

async function uploadFile(file) {
  if (!S.activeSessionId) return;
  if (file.size > 50 * 1024 * 1024) {
    showToast(`File too large: ${file.name} (>50MB)`, 'error');
    return;
  }
  try {
    const buf = await file.arrayBuffer();
    const params = new URLSearchParams({ sessionId: S.activeSessionId, filename: file.name });
    const res = await apiFetch(`/api/upload?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    });
    const data = await res.json();
    if (data.ok) {
      showToast(`Uploaded: ${file.name}`, 'success');
    } else {
      showToast(`Upload failed: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast(`Upload error: ${e.message}`, 'error');
  }
}

function downloadFile(filePath) {
  if (!S.activeSessionId) return;
  const params = new URLSearchParams({ sessionId: S.activeSessionId, path: filePath });
  const a = document.createElement('a');
  a.href = `/api/download?${params}`;
  a.download = filePath.split('/').pop() || 'file';
  document.body.appendChild(a);
  a.click();
  a.remove();
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
    if (msg.op === 'delete') {
      // Also refresh source control after file delete
      import('./source-control.js').then(m => m.requestGitStatus());
    }
    showToast(`File ${msg.op} successful`, 'success');
  } else {
    showToast(`File ${msg.op} failed: ${msg.error}`, 'error', 4000);
  }
}

export function handleFileReadData(msg) {
  openFileTab(msg.filePath || 'unknown', msg.content || '', {
    binary: msg.binary,
    isImage: msg.isImage,
    imageData: msg.imageData,
    imageMime: msg.imageMime,
    error: msg.error,
  });
}

export function onExplorerSessionChange() {
  requestFileTree();
}
