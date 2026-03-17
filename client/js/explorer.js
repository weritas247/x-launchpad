// ─── FILE EXPLORER PANEL ─────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';

let explorerTree = [];
let expandedDirs = new Set();
let currentDir = '';

export function initExplorer() {
  // Request file tree when panel becomes visible
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
      item.innerHTML = `<span class="explorer-arrow">${isExpanded ? '▾' : '▸'}</span>` +
        `<span class="explorer-icon">📁</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>`;
      item.addEventListener('click', () => {
        if (expandedDirs.has(entry.path)) {
          expandedDirs.delete(entry.path);
        } else {
          expandedDirs.add(entry.path);
        }
        renderExplorer();
      });
      parent.appendChild(item);

      if (isExpanded && entry.children) {
        renderTreeLevel(parent, entry.children, depth + 1);
      }
    } else {
      const icon = getFileIcon(entry.name);
      item.innerHTML = `<span class="explorer-arrow" style="visibility:hidden">▸</span>` +
        `<span class="explorer-icon">${icon}</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>`;
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

export function onExplorerSessionChange() {
  requestFileTree();
}
