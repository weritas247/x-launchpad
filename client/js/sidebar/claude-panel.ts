// ─── CLAUDE PANEL: ~/.claude directory browser with tabs ──────────────────────
import { S, sessionMeta } from '../core/state';
import { apiFetch, wsSend } from '../core/websocket';
import { getFileIcon, getFolderIcon } from '../ui/file-icons';
import { showToast } from '../ui/toast';
import { confirmModal } from '../ui/confirm-modal';

type ClaudeTab = 'home' | 'project';

let activeTab: ClaudeTab = 'home';

// Per-tab state
const tabState: Record<ClaudeTab, { tree: any[]; dir: string; expandedDirs: Set<string> }> = {
  home: { tree: [], dir: '', expandedDirs: new Set() },
  project: { tree: [], dir: '', expandedDirs: new Set() },
};

let pendingRevealPath: string | null = null;
let fetchSeq = 0; // race-condition guard for async fetches

let ctxTargetPath = '';
let ctxTargetType = ''; // 'file' | 'directory'

function getProjectCwd(): string | undefined {
  if (!S.activeSessionId) return undefined;
  const meta = sessionMeta.get(S.activeSessionId);
  return meta?.cwd || undefined;
}

function getBaseParam(): string {
  if (activeTab === 'project') {
    const cwd = getProjectCwd();
    return cwd ? `&base=${encodeURIComponent(cwd)}` : '';
  }
  return '';
}

function getBaseBody(): Record<string, string> {
  if (activeTab === 'project') {
    const cwd = getProjectCwd();
    return cwd ? { base: cwd } : {};
  }
  return {};
}

export function initClaudePanel() {
  document.getElementById('claude-refresh')?.addEventListener('click', requestClaudeDir);

  // Tab switching
  document.querySelectorAll('.claude-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = (btn as HTMLElement).dataset.claudeTab as ClaudeTab;
      if (!tab || tab === activeTab) return;
      switchTab(tab);
    });
  });

  // Reveal active file button
  document.getElementById('claude-reveal-active')?.addEventListener('click', async () => {
    const { getActiveFilePath } = await import('../editor/file-viewer');
    const filePath = getActiveFilePath();
    if (filePath) revealFileInClaudePanel(filePath);
  });

  // Context menu
  const ctxMenu = document.getElementById('claude-ctx-menu');
  document.addEventListener('click', () => {
    if (ctxMenu) ctxMenu.style.display = 'none';
  });

  document.getElementById('cctx-open')?.addEventListener('click', () => {
    if (!ctxTargetPath) return;
    const st = tabState[activeTab];
    if (ctxTargetType === 'directory') {
      if (st.expandedDirs.has(ctxTargetPath)) {
        st.expandedDirs.delete(ctxTargetPath);
      } else {
        st.expandedDirs.add(ctxTargetPath);
      }
      renderClaudePanel();
    } else {
      openClaudeFile(ctxTargetPath);
    }
  });

  document.getElementById('cctx-copy-path')?.addEventListener('click', () => {
    const st = tabState[activeTab];
    if (!ctxTargetPath || !st.dir) return;
    const fullPath = st.dir + '/' + ctxTargetPath;
    navigator.clipboard.writeText(fullPath).then(() => {
      showToast('Path copied', 'success');
    });
  });

  document.getElementById('cctx-reveal')?.addEventListener('click', () => {
    if (!ctxTargetPath) return;
    const st = tabState[activeTab];
    const fullPath = st.dir + '/' + ctxTargetPath;
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
        body: JSON.stringify({ filePath: ctxTargetPath, ...getBaseBody() }),
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

function switchTab(tab: ClaudeTab) {
  activeTab = tab;
  console.log('[claude-panel] switchTab:', tab, 'cwd:', getProjectCwd());

  // Update tab button UI
  document.querySelectorAll('.claude-tab').forEach((btn) => {
    const t = (btn as HTMLElement).dataset.claudeTab;
    btn.classList.toggle('active', t === tab);
  });

  // Always re-render and re-fetch for the new tab
  renderClaudePanel();
  requestClaudeDir();
}

export async function requestClaudeDir() {
  const tab = activeTab; // capture at call time
  const seq = ++fetchSeq;  // unique request id
  try {
    if (tab === 'project' && !getProjectCwd()) {
      tabState.project.tree = [];
      tabState.project.dir = '';
      if (seq === fetchSeq) renderClaudePanel();
      return;
    }
    const baseParam = tab === 'project'
      ? `?base=${encodeURIComponent(getProjectCwd()!)}`
      : '';
    console.log('[claude-panel] fetch seq:', seq, 'tab:', tab, 'url:', `/api/claude-dir${baseParam}`);
    const res = await apiFetch(`/api/claude-dir${baseParam}`);
    if (seq !== fetchSeq) {
      console.log('[claude-panel] stale response seq:', seq, 'current:', fetchSeq, '— discarded');
      return; // a newer request was made, discard this response
    }
    const data = await res.json();
    console.log('[claude-panel] response seq:', seq, 'dir:', data.dir, 'items:', data.tree?.length);
    if (data.ok) {
      const st = tabState[tab];
      st.tree = data.tree || [];
      st.dir = data.dir || '';
      renderClaudePanel();
    }
  } catch (e) {
    console.error('[claude-panel] fetch error:', e);
  }
}

export function handleClaudeDirData(msg: any) {
  // External callers (activity-bar) always provide home data
  const st = tabState.home;
  st.tree = msg.tree || [];
  st.dir = msg.dir || '';
  if (activeTab === 'home') renderClaudePanel();
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

  const st = tabState[activeTab];

  const headerPath = document.getElementById('claude-path');
  if (headerPath) {
    if (activeTab === 'home') {
      headerPath.textContent = '~/.claude';
      headerPath.title = st.dir;
    } else {
      const cwd = getProjectCwd();
      if (cwd) {
        const parts = cwd.replace(/\/$/, '').split('/');
        headerPath.textContent = parts[parts.length - 1] + '/.claude';
      } else {
        headerPath.textContent = '(no project)';
      }
      headerPath.title = st.dir;
    }
  }

  // Update project tab label with project name
  const projectTab = document.querySelector('.claude-tab[data-claude-tab="project"]') as HTMLElement;
  if (projectTab) {
    const cwd = getProjectCwd();
    if (cwd) {
      const parts = cwd.replace(/\/$/, '').split('/');
      projectTab.textContent = parts[parts.length - 1];
      projectTab.title = cwd + '/.claude';
    } else {
      projectTab.textContent = 'Project';
      projectTab.title = '';
    }
  }

  if (activeTab === 'project' && !getProjectCwd()) {
    container.innerHTML = '<div class="explorer-empty">No project detected</div>';
    return;
  }

  if (st.tree.length === 0) {
    container.innerHTML = '<div class="explorer-empty">No files found</div>';
    return;
  }
  container.innerHTML = '';
  renderTreeLevel(container, st.tree, 0, st.expandedDirs);

  if (pendingRevealPath) {
    const revealPath = pendingRevealPath;
    requestAnimationFrame(() => applyRevealHighlight(revealPath, container));
  }
}

function renderTreeLevel(parent: HTMLElement, entries: any[], depth: number, expandedDirs: Set<string>) {
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
        renderTreeLevel(childrenContainer, entry.children, depth + 1, expandedDirs);
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
            renderTreeLevel(childrenContainer, entry.children, depth + 1, expandedDirs);
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
    const baseParam = activeTab === 'project' && getProjectCwd()
      ? `&base=${encodeURIComponent(getProjectCwd()!)}`
      : '';
    const res = await apiFetch(`/api/claude-read?path=${encodeURIComponent(filePath)}${baseParam}`);
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

function applyRevealHighlight(filePath: string, container: HTMLElement) {
  const item = container.querySelector(`.explorer-item[data-path="${CSS.escape(filePath)}"]`) as HTMLElement;
  if (!item) return;

  const containerRect = container.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  const targetOffset = containerRect.height / 3;
  const itemRelativeTop = itemRect.top - containerRect.top + container.scrollTop;
  container.scrollTo({ top: itemRelativeTop - targetOffset, behavior: 'smooth' });

  document.querySelectorAll('#claude-tree .explorer-highlight').forEach(el => el.classList.remove('explorer-highlight'));
  void item.offsetWidth;
  item.classList.add('explorer-highlight');
}

function revealFileInClaudePanel(filePath: string) {
  const st = tabState[activeTab];
  const parts = filePath.split('/');
  for (let i = 1; i < parts.length; i++) {
    const dirPath = parts.slice(0, i).join('/');
    st.expandedDirs.add(dirPath);
  }

  pendingRevealPath = filePath;
  renderClaudePanel();

  import('./activity-bar').then(({ switchPanel }) => {
    switchPanel('claude');
  });

  setTimeout(() => {
    if (pendingRevealPath === filePath) pendingRevealPath = null;
  }, 3500);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
