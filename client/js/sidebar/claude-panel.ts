// ─── CLAUDE PANEL: ~/.claude directory browser ──────────────────────
import { S } from '../core/state';
import { apiFetch, wsSend } from '../core/websocket';
import { getFileIcon, getFolderIcon } from '../ui/file-icons';
import { showToast } from '../ui/toast';
import { confirmModal } from '../ui/confirm-modal';

let claudeTree: any[] = [];
let claudeDir = '';
const expandedDirs = new Set<string>();

let ctxTargetPath = '';
let ctxTargetType = ''; // 'file' | 'directory'

export function initClaudePanel() {
  document.getElementById('claude-refresh')?.addEventListener('click', requestClaudeDir);

  // Context menu
  const ctxMenu = document.getElementById('claude-ctx-menu');
  document.addEventListener('click', () => {
    if (ctxMenu) ctxMenu.style.display = 'none';
  });

  document.getElementById('cctx-open')?.addEventListener('click', () => {
    if (!ctxTargetPath) return;
    if (ctxTargetType === 'directory') {
      // 디렉토리 토글
      if (expandedDirs.has(ctxTargetPath)) {
        expandedDirs.delete(ctxTargetPath);
      } else {
        expandedDirs.add(ctxTargetPath);
      }
      renderClaudePanel();
    } else {
      openClaudeFile(ctxTargetPath);
    }
  });

  document.getElementById('cctx-copy-path')?.addEventListener('click', () => {
    if (!ctxTargetPath || !claudeDir) return;
    const fullPath = claudeDir + '/' + ctxTargetPath;
    navigator.clipboard.writeText(fullPath).then(() => {
      showToast('Path copied', 'success');
    });
  });

  document.getElementById('cctx-reveal')?.addEventListener('click', () => {
    if (!ctxTargetPath) return;
    const fullPath = claudeDir + '/' + ctxTargetPath;
    apiFetch('/api/reveal-in-finder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: fullPath }),
    }).catch(() => {});
  });

  document.getElementById('cctx-delete')?.addEventListener('click', async () => {
    if (!ctxTargetPath) return;
    const name = ctxTargetPath.split('/').pop();
    if (!(await confirmModal(`Delete "${name}"?`, 'Delete'))) return;
    try {
      const res = await apiFetch('/api/claude-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath: ctxTargetPath }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Deleted: ${name}`, 'success');
        requestClaudeDir();
      } else {
        showToast(`Delete failed: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast(`Delete error: ${(e as Error).message}`, 'error');
    }
  });
}

export async function requestClaudeDir() {
  try {
    const res = await apiFetch('/api/claude-dir');
    const data = await res.json();
    if (data.ok) {
      handleClaudeDirData(data);
    }
  } catch (e) {
    console.error('[claude-panel] fetch error:', e);
  }
}

export function handleClaudeDirData(msg: any) {
  claudeTree = msg.tree || [];
  claudeDir = msg.dir || '';
  renderClaudePanel();
}

function showClaudeCtx(e: MouseEvent, path: string, type: string) {
  e.preventDefault();
  e.stopPropagation();
  ctxTargetPath = path;
  ctxTargetType = type;
  const menu = document.getElementById('claude-ctx-menu');
  if (!menu) return;
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
}

function renderClaudePanel() {
  const container = document.getElementById('claude-tree');
  if (!container) return;

  const headerPath = document.getElementById('claude-path');
  if (headerPath) {
    headerPath.textContent = '~/.claude';
    headerPath.title = claudeDir;
  }

  if (claudeTree.length === 0) {
    container.innerHTML = '<div class="explorer-empty">No files found</div>';
    return;
  }
  container.innerHTML = '';
  renderTreeLevel(container, claudeTree, 0);
}

function renderTreeLevel(parent: HTMLElement, entries: any[], depth: number) {
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'explorer-item' + (entry.type === 'directory' ? ' is-dir' : '');
    item.style.paddingLeft = 12 + depth * 16 + 'px';
    item.dataset.path = entry.path;

    if (entry.type === 'directory') {
      const isExpanded = expandedDirs.has(entry.path);
      item.innerHTML =
        `<span class="explorer-arrow">${isExpanded ? '▾' : '▸'}</span>` +
        `<span class="explorer-icon">${getFolderIcon(isExpanded)}</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>`;

      item.addEventListener('click', () => {
        if (expandedDirs.has(entry.path)) {
          expandedDirs.delete(entry.path);
        } else {
          expandedDirs.add(entry.path);
        }
        renderClaudePanel();
      });
      item.addEventListener('contextmenu', (e) => showClaudeCtx(e, entry.path, 'directory'));
      parent.appendChild(item);

      if (isExpanded && entry.children) {
        renderTreeLevel(parent, entry.children, depth + 1);
      }
    } else {
      item.innerHTML =
        `<span class="explorer-arrow" style="visibility:hidden">▸</span>` +
        `<span class="explorer-icon">${getFileIcon(entry.name)}</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>`;

      item.addEventListener('click', () => {
        if (!S.activeSessionId) return;
        import('../editor/file-viewer').then(m => {
          m.openFileTab(entry.path, claudeDir);
        });
      });
      item.addEventListener('contextmenu', (e) => showClaudeCtx(e, entry.path, 'file'));
      parent.appendChild(item);
    }
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
