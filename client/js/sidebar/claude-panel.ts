// ─── CLAUDE PANEL: ~/.claude directory browser ──────────────────────
import { S } from '../core/state';
import { apiFetch, wsSend } from '../core/websocket';
import { getFileIcon, getFolderIcon } from '../ui/file-icons';
import { showToast } from '../ui/toast';
import { confirmModal } from '../ui/confirm-modal';

let claudeTree: any[] = [];
let claudeDir = '';
const expandedDirs = new Set<string>();
let pendingRevealPath: string | null = null;

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
        `<span class="explorer-arrow${isExpanded ? ' expanded' : ''}">▸</span>` +
        `<span class="explorer-icon">${getFolderIcon(isExpanded)}</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>`;

      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'explorer-children';
      if (isExpanded && entry.children) {
        renderTreeLevel(childrenContainer, entry.children, depth + 1);
      }

      item.addEventListener('click', () => {
        const arrow = item.querySelector('.explorer-arrow') as HTMLElement;
        const iconEl = item.querySelector('.explorer-icon') as HTMLElement;
        if (expandedDirs.has(entry.path)) {
          expandedDirs.delete(entry.path);
          arrow?.classList.remove('expanded');
          if (iconEl) iconEl.innerHTML = getFolderIcon(false);
          const h = childrenContainer.scrollHeight;
          childrenContainer.style.height = h + 'px';
          requestAnimationFrame(() => {
            childrenContainer.style.height = '0px';
          });
          childrenContainer.addEventListener('transitionend', () => {
            childrenContainer.innerHTML = '';
            childrenContainer.style.height = '';
          }, { once: true });
        } else {
          expandedDirs.add(entry.path);
          arrow?.classList.add('expanded');
          if (iconEl) iconEl.innerHTML = getFolderIcon(true);
          if (entry.children) {
            renderTreeLevel(childrenContainer, entry.children, depth + 1);
          }
          childrenContainer.style.height = '0px';
          requestAnimationFrame(() => {
            childrenContainer.style.height = childrenContainer.scrollHeight + 'px';
            childrenContainer.addEventListener('transitionend', () => {
              childrenContainer.style.height = '';
            }, { once: true });
          });
        }
      });
      item.addEventListener('contextmenu', (e) => showClaudeCtx(e, entry.path, 'directory'));
      parent.appendChild(item);
      parent.appendChild(childrenContainer);
    } else {
      item.innerHTML =
        `<span class="explorer-arrow" style="visibility:hidden">▸</span>` +
        `<span class="explorer-icon">${getFileIcon(entry.name)}</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>`;

      item.addEventListener('click', () => {
        openClaudeFile(entry.path);
      });
      item.addEventListener('contextmenu', (e) => showClaudeCtx(e, entry.path, 'file'));
      parent.appendChild(item);
    }
  }
}

async function openClaudeFile(filePath: string) {
  try {
    const res = await apiFetch(`/api/claude-read?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!data.ok) {
      showToast(`Failed to read file: ${data.error}`, 'error');
      return;
    }
    const { openFileTab } = await import('../editor/file-viewer');
    openFileTab(filePath, data.content || '', { binary: data.binary });
  } catch (e) {
    showToast(`Read error: ${(e as Error).message}`, 'error');
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
