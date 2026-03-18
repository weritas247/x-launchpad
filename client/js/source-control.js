// ─── SOURCE CONTROL PANEL ────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { showToast } from './toast.js';
import { setActivityBadge } from './activity-bar.js';

let gitStatusFiles = [];
let gitBranch = '';
let gitRoot = '';
let isGitRepo = false;
let upstream = { ahead: 0, behind: 0 };
let viewMode = 'list'; // 'list' | 'tree'
let expandedTreeDirs = new Set();
let selectedFile = null;
let ctxTarget = null; // { path, staged, status }
let worktrees = [];
let currentWorktreePath = '';
let worktreeCollapsed = true; // worktree section collapsed by default

// ─── Multi-select state ──────────────────────────────
let selectedItems = new Set(); // Set of "staged:path" or "unstaged:path"
let lastClickedKey = null;     // for shift-click range select
let allFileKeys = [];          // ordered list of keys for range select
let dragSelecting = false;
let dragStartY = 0;
let dragCurrentY = 0;
let dragStartX = 0;
let dragCurrentX = 0;
let dragContainer = null;
let dragStartedInside = false;
let dragMoved = false;

export function initSourceControl() {
  initScContextMenu();
  initDragSelect();
  const refreshBtn = document.getElementById('sc-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', requestGitStatus);

  const treeToggle = document.getElementById('sc-view-toggle');
  if (treeToggle) {
    treeToggle.addEventListener('click', () => {
      viewMode = viewMode === 'list' ? 'tree' : 'list';
      treeToggle.textContent = viewMode === 'list' ? '≡' : '⊞';
      treeToggle.title = viewMode === 'list' ? 'Tree view' : 'List view';
      renderSourceControl();
    });
  }

  // Commit functionality
  const commitInput = document.getElementById('sc-commit-input');
  const commitBtn = document.getElementById('sc-commit-btn');
  const commitDropdown = document.getElementById('sc-commit-dropdown');
  const commitMenu = document.getElementById('sc-commit-menu');

  const doCommit = (andPush = false) => {
    if (!commitInput || !S.activeSessionId) return;
    const message = commitInput.value.trim();
    if (!message) return;
    wsSend({ type: 'git_commit', sessionId: S.activeSessionId, message, push: andPush });
    commitInput.value = '';
  };

  if (commitBtn) commitBtn.addEventListener('click', () => doCommit(false));
  if (commitInput) commitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doCommit(false); }
  });

  // Generate commit message
  const generateBtn = document.getElementById('sc-generate-btn');
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      if (!S.activeSessionId) return;
      generateBtn.textContent = '...';
      generateBtn.disabled = true;
      wsSend({ type: 'git_generate_message', sessionId: S.activeSessionId });
    });
  }

  // Dropdown menu
  if (commitDropdown && commitMenu) {
    commitDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      commitMenu.classList.toggle('show');
    });
    document.addEventListener('click', () => commitMenu.classList.remove('show'));

    commitMenu.addEventListener('click', (e) => {
      const action = e.target.dataset?.action;
      if (action === 'commit-push') doCommit(true);
      else if (action === 'push') wsSend({ type: 'git_push', sessionId: S.activeSessionId });
      commitMenu.classList.remove('show');
    });
  }

  // Worktree section
  const wtHeader = document.getElementById('sc-worktree-header');
  if (wtHeader) {
    wtHeader.addEventListener('click', (e) => {
      if (e.target.closest('#sc-worktree-add-btn')) return;
      worktreeCollapsed = !worktreeCollapsed;
      const section = document.getElementById('sc-worktree-section');
      if (section) section.classList.toggle('collapsed', worktreeCollapsed);
    });
  }

  const wtAddBtn = document.getElementById('sc-worktree-add-btn');
  if (wtAddBtn) {
    wtAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const form = document.getElementById('sc-worktree-add-form');
      if (form) {
        const showing = form.style.display === 'none';
        form.style.display = showing ? '' : 'none';
        if (showing) document.getElementById('sc-worktree-path')?.focus();
      }
    });
  }

  const wtCreateBtn = document.getElementById('sc-worktree-create');
  if (wtCreateBtn) {
    wtCreateBtn.addEventListener('click', () => {
      const pathInput = document.getElementById('sc-worktree-path');
      const newBranchCb = document.getElementById('sc-worktree-new-branch');
      if (!pathInput || !S.activeSessionId) return;
      const value = pathInput.value.trim();
      if (!value) return;
      // Sanitize: only allow alphanumeric, hyphens, underscores, dots
      const safeName = value.replace(/[^a-zA-Z0-9._-]/g, '-');
      if (!safeName) { showToast('Invalid branch/worktree name', 'error'); return; }
      const isNewBranch = newBranchCb?.checked || false;
      const path = `.claude/worktrees/${safeName}`;
      wsSend({
        type: 'git_worktree_add',
        sessionId: S.activeSessionId,
        path,
        branch: isNewBranch ? safeName : value,
        createBranch: isNewBranch
      });
      pathInput.value = '';
      if (newBranchCb) newBranchCb.checked = false;
      document.getElementById('sc-worktree-add-form').style.display = 'none';
    });
  }

  const wtPathInput = document.getElementById('sc-worktree-path');
  if (wtPathInput) {
    wtPathInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); wtCreateBtn?.click(); }
      if (e.key === 'Escape') { document.getElementById('sc-worktree-add-form').style.display = 'none'; }
    });
  }

  const wtCancelBtn = document.getElementById('sc-worktree-cancel');
  if (wtCancelBtn) {
    wtCancelBtn.addEventListener('click', () => {
      document.getElementById('sc-worktree-add-form').style.display = 'none';
    });
  }
}

export function handleGitCommitAck(msg) {
  const commitInput = document.getElementById('sc-commit-input');
  if (msg.ok) {
    showToast('Commit successful', 'success');
  } else {
    showToast('Commit failed: ' + (msg.error || 'unknown error'), 'error', 5000);
    if (commitInput) commitInput.style.borderColor = 'var(--danger)';
    setTimeout(() => { if (commitInput) commitInput.style.borderColor = ''; }, 2000);
  }
}

export function handleGitPushAck(msg) {
  if (msg.ok) {
    showToast('Push successful', 'success');
  } else {
    showToast('Push failed: ' + (msg.error || 'unknown error'), 'error', 5000);
  }
}

export function handleGitGenerateMessage(msg) {
  const commitInput = document.getElementById('sc-commit-input');
  const generateBtn = document.getElementById('sc-generate-btn');
  if (generateBtn) { generateBtn.textContent = 'Generate ✦'; generateBtn.disabled = false; }
  if (commitInput && msg.message) {
    commitInput.value = msg.message;
    commitInput.focus();
  }
}

export function handleWorktreeListData(msg) {
  worktrees = msg.worktrees || [];
  currentWorktreePath = msg.currentPath || '';
  renderWorktrees();
}

export function handleWorktreeAddAck(msg) {
  if (msg.ok) {
    showToast('Worktree created', 'success');
  } else {
    showToast('Worktree creation failed: ' + (msg.error || 'unknown'), 'error', 5000);
  }
}

export function handleWorktreeRemoveAck(msg) {
  if (msg.ok) {
    showToast('Worktree removed', 'success');
  } else {
    showToast('Worktree removal failed: ' + (msg.error || 'unknown'), 'error', 5000);
  }
}

export function handleWorktreeSwitchAck(msg) {
  if (msg.ok) {
    showToast(`Switched to worktree`, 'success');
  } else {
    showToast('Switch failed: ' + (msg.error || 'unknown'), 'error', 5000);
  }
}

export function requestGitStatus() {
  if (!S.activeSessionId) return;
  wsSend({ type: 'git_status', sessionId: S.activeSessionId });
  wsSend({ type: 'git_worktree_list', sessionId: S.activeSessionId });
}

export function handleGitStatusData(msg) {
  gitStatusFiles = msg.files || [];
  gitBranch = msg.branch || '';
  gitRoot = msg.root || '';
  isGitRepo = msg.isRepo || false;
  upstream = msg.upstream || { ahead: 0, behind: 0 };
  setActivityBadge('source-control', gitStatusFiles.length, {
    isInWorktree: msg.isInWorktree || false,
    mainCount: msg.mainBranchFileCount != null ? msg.mainBranchFileCount : null,
  });
  renderSourceControl();
  // Hide worktree section if not a git repo
  if (!isGitRepo) {
    const wtSection = document.getElementById('sc-worktree-section');
    if (wtSection) wtSection.style.display = 'none';
  }
}

export function handleGitDiffData(msg) {
  const overlay = document.getElementById('diff-overlay');
  if (!overlay) return;
  if (!msg.diff) return;

  const titleFile = document.getElementById('diff-title-file');
  const titleBadge = document.getElementById('diff-title-badge');
  const diffContent = document.getElementById('diff-content');
  const diffLoading = document.getElementById('diff-loading');

  if (titleFile) titleFile.textContent = msg.filePath || '—';
  if (titleBadge) {
    titleBadge.textContent = msg.staged ? 'STAGED' : 'UNSTAGED';
    titleBadge.className = 'diff-title-badge ' + (msg.staged ? 'diff-badge-staged' : 'diff-badge-unstaged');
  }
  if (diffLoading) diffLoading.style.display = 'none';
  if (diffContent) diffContent.innerHTML = renderDiffHtml(msg.diff);

  overlay.classList.add('open');

  // Close handlers
  const closeBtn = document.getElementById('diff-close');
  const closeDiff = () => {
    overlay.classList.remove('open');
    closeBtn.removeEventListener('click', closeDiff);
    overlay.removeEventListener('click', onOverlayClick);
    document.removeEventListener('keydown', onEsc);
  };
  const onOverlayClick = (e) => { if (e.target === overlay) closeDiff(); };
  const onEsc = (e) => { if (e.key === 'Escape') closeDiff(); };

  closeBtn.addEventListener('click', closeDiff);
  overlay.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onEsc);
}

function renderDiffHtml(diff) {
  const lines = diff.split('\n');
  let oldLine = 0, newLine = 0;
  return lines.map(line => {
    const escaped = escHtml(line);
    // Parse hunk header for line numbers
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1]);
      newLine = parseInt(hunkMatch[2]);
      return `<div class="diff-hunk">${escaped}</div>`;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      const ln = newLine++;
      return `<div class="diff-add"><span class="diff-ln diff-ln-old"></span><span class="diff-ln">${ln}</span>${escaped}</div>`;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      const ln = oldLine++;
      return `<div class="diff-del"><span class="diff-ln">${ln}</span><span class="diff-ln diff-ln-new"></span>${escaped}</div>`;
    } else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
      return `<div class="diff-ctx diff-meta">${escaped}</div>`;
    }
    const oln = oldLine++;
    const nln = newLine++;
    return `<div class="diff-ctx"><span class="diff-ln">${oln}</span><span class="diff-ln">${nln}</span>${escaped}</div>`;
  }).join('');
}

function renderSourceControl() {
  const container = document.getElementById('sc-file-list');
  const branchEl = document.getElementById('sc-branch-name');
  const emptyEl = document.getElementById('sc-empty');
  const countEl = document.getElementById('sc-change-count');
  if (!container) return;

  if (branchEl) {
    let branchText = gitBranch || '—';
    const parts = [];
    if (upstream.behind > 0) parts.push(`↓${upstream.behind}`);
    if (upstream.ahead > 0) parts.push(`↑${upstream.ahead}`);
    if (parts.length) branchText += ` ${parts.join(' ')}`;
    branchEl.textContent = branchText;
  }
  if (countEl) countEl.textContent = gitStatusFiles.length > 0 ? gitStatusFiles.length : '';

  // Update commit input placeholder with branch name
  const commitInput = document.getElementById('sc-commit-input');
  if (commitInput) {
    commitInput.placeholder = gitBranch ? `Message (Enter to commit on "${gitBranch}")` : 'Message (Enter to commit)';
  }

  if (!isGitRepo) {
    container.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'Not a git repository'; }
    return;
  }

  if (gitStatusFiles.length === 0) {
    container.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'No changes detected'; }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  const staged = gitStatusFiles.filter(f => f.staged);
  const allUnstaged = gitStatusFiles.filter(f => !f.staged);

  // Separate worktree files from regular changes
  const isWorktreeFile = (f) => f.path.startsWith('.claude/worktrees/') || f.path.startsWith('.claude/worktrees\\');
  const changes = allUnstaged.filter(f => !isWorktreeFile(f));
  const worktreeFiles = allUnstaged.filter(f => isWorktreeFile(f));

  // Build ordered key list for range select
  allFileKeys = [
    ...staged.map(f => makeKey(f, true)),
    ...changes.map(f => makeKey(f, false)),
    ...worktreeFiles.map(f => makeKey(f, false))
  ];

  // Clean up selection: remove keys that no longer exist
  for (const k of [...selectedItems]) {
    if (!allFileKeys.includes(k)) selectedItems.delete(k);
  }

  container.innerHTML = '';

  if (staged.length > 0) {
    const section = createSection('STAGED CHANGES', staged, true);
    container.appendChild(section);
  }

  if (changes.length > 0) {
    const section = createSection('CHANGES', changes, false);
    container.appendChild(section);
  }

  if (worktreeFiles.length > 0) {
    const section = createWorktreeSection('WORKTREES', worktreeFiles);
    container.appendChild(section);
  }

  updateSelectionVisuals();
}

function createSection(title, files, isStaged) {
  const section = document.createElement('div');
  section.className = 'sc-section';

  const header = document.createElement('div');
  header.className = 'sc-section-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'sc-section-title';
  titleSpan.textContent = title;

  const actions = document.createElement('div');
  actions.className = 'sc-section-actions';

  const countSpan = document.createElement('span');
  countSpan.className = 'sc-section-count';
  countSpan.textContent = files.length;

  // Stage all / Unstage all button
  const allBtn = document.createElement('button');
  allBtn.className = 'sc-action-btn';
  allBtn.title = isStaged ? 'Unstage all' : 'Stage all';
  allBtn.textContent = isStaged ? '−' : '+';
  allBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isStaged) {
      wsSend({ type: 'git_unstage', sessionId: S.activeSessionId, all: true });
    } else {
      wsSend({ type: 'git_stage', sessionId: S.activeSessionId, all: true });
    }
  });

  actions.appendChild(allBtn);
  actions.appendChild(countSpan);
  header.appendChild(titleSpan);
  header.appendChild(actions);
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'sc-section-list';

  if (viewMode === 'tree') {
    renderTreeView(list, files, isStaged);
  } else {
    renderListView(list, files, isStaged);
  }

  section.appendChild(list);
  return section;
}

function createWorktreeSection(title, files) {
  const section = document.createElement('div');
  section.className = 'sc-section sc-worktree-section';

  const header = document.createElement('div');
  header.className = 'sc-section-header sc-worktree-header';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'sc-section-header-left';
  leftGroup.style.display = 'flex';
  leftGroup.style.alignItems = 'center';
  leftGroup.style.gap = '4px';
  leftGroup.style.cursor = 'pointer';

  const arrow = document.createElement('span');
  arrow.className = 'sc-tree-arrow';
  arrow.textContent = worktreeCollapsed ? '▸' : '▾';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'sc-section-title';
  titleSpan.textContent = title;

  leftGroup.appendChild(arrow);
  leftGroup.appendChild(titleSpan);

  const actions = document.createElement('div');
  actions.className = 'sc-section-actions';

  const countSpan = document.createElement('span');
  countSpan.className = 'sc-section-count';
  countSpan.textContent = files.length;

  // Stage all button
  const allBtn = document.createElement('button');
  allBtn.className = 'sc-action-btn';
  allBtn.title = 'Stage all';
  allBtn.textContent = '+';
  allBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const f of files) {
      wsSend({ type: 'git_stage', sessionId: S.activeSessionId, filePath: f.path });
    }
  });

  actions.appendChild(allBtn);
  actions.appendChild(countSpan);
  header.appendChild(leftGroup);
  header.appendChild(actions);

  // Toggle collapse on header click
  leftGroup.addEventListener('click', () => {
    worktreeCollapsed = !worktreeCollapsed;
    renderSourceControl();
  });

  section.appendChild(header);

  if (!worktreeCollapsed) {
    const list = document.createElement('div');
    list.className = 'sc-section-list';
    renderListView(list, files, false);
    section.appendChild(list);
  }

  return section;
}

function renderListView(parent, files, isStaged) {
  for (const file of files) {
    const item = createFileItem(file, isStaged);
    parent.appendChild(item);
  }
}

function renderTreeView(parent, files, isStaged) {
  // Build tree structure from file paths
  const tree = {};
  for (const file of files) {
    const parts = file.path.split('/');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]]) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = file;
  }

  function renderNode(parentEl, node, prefix, depth) {
    const entries = Object.entries(node).sort(([a, av], [b, bv]) => {
      const aIsDir = typeof av === 'object' && !av.status;
      const bIsDir = typeof bv === 'object' && !bv.status;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.localeCompare(b);
    });

    for (const [name, value] of entries) {
      const fullPath = prefix ? `${prefix}/${name}` : name;
      if (value && typeof value === 'object' && !value.status) {
        // Directory
        const dirItem = document.createElement('div');
        dirItem.className = 'sc-tree-dir';
        dirItem.style.paddingLeft = (12 + depth * 14) + 'px';
        const isExpanded = expandedTreeDirs.has(fullPath);
        dirItem.innerHTML = `<span class="sc-tree-arrow">${isExpanded ? '▾' : '▸'}</span>` +
          `<span class="sc-tree-dir-name">${escHtml(name)}</span>`;
        dirItem.addEventListener('click', () => {
          if (expandedTreeDirs.has(fullPath)) expandedTreeDirs.delete(fullPath);
          else expandedTreeDirs.add(fullPath);
          renderSourceControl();
        });
        parentEl.appendChild(dirItem);

        if (isExpanded) {
          renderNode(parentEl, value, fullPath, depth + 1);
        }
      } else {
        // File
        const item = createFileItem(value, isStaged, depth);
        parentEl.appendChild(item);
      }
    }
  }

  renderNode(parent, tree, '', 0);
}

function createFileItem(file, isStaged, treeDepth) {
  const item = document.createElement('div');
  item.className = 'sc-file-item';
  if (treeDepth !== undefined) {
    item.style.paddingLeft = (12 + treeDepth * 14) + 'px';
  }

  const statusClass = getStatusClass(file.status);
  const statusLabel = getStatusLabel(file.status);
  const fileName = file.path.split('/').pop();
  const dirPath = (treeDepth === undefined && file.path.includes('/'))
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';

  // File info
  const nameSpan = document.createElement('span');
  nameSpan.className = 'sc-file-name';
  nameSpan.textContent = fileName;

  const rightGroup = document.createElement('div');
  rightGroup.className = 'sc-file-right';

  if (dirPath) {
    const dirSpan = document.createElement('span');
    dirSpan.className = 'sc-file-dir';
    dirSpan.textContent = dirPath;
    rightGroup.appendChild(dirSpan);
  }

  // Discard button (only for unstaged changes, not untracked)
  if (!isStaged && file.status !== 'U' && file.status !== '?') {
    const discardBtn = document.createElement('button');
    discardBtn.className = 'sc-file-action sc-file-discard';
    discardBtn.title = 'Discard changes';
    discardBtn.textContent = '↩';
    discardBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wsSend({ type: 'git_discard', sessionId: S.activeSessionId, filePath: file.path });
    });
    rightGroup.appendChild(discardBtn);
  }

  // Stage/Unstage button
  const actionBtn = document.createElement('button');
  actionBtn.className = 'sc-file-action';
  actionBtn.title = isStaged ? 'Unstage' : 'Stage';
  actionBtn.textContent = isStaged ? '−' : '+';
  actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isStaged) {
      wsSend({ type: 'git_unstage', sessionId: S.activeSessionId, filePath: file.path });
    } else {
      wsSend({ type: 'git_stage', sessionId: S.activeSessionId, filePath: file.path });
    }
  });

  const statusSpan = document.createElement('span');
  statusSpan.className = `sc-file-status ${statusClass}`;
  statusSpan.textContent = statusLabel;

  rightGroup.appendChild(actionBtn);
  rightGroup.appendChild(statusSpan);

  item.appendChild(nameSpan);
  item.appendChild(rightGroup);

  const key = makeKey(file, isStaged);
  item.dataset.fileKey = key;

  // Right-click context menu
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // If right-clicked item is not in selection, select it alone
    if (!selectedItems.has(key)) {
      selectedItems.clear();
      selectedItems.add(key);
      lastClickedKey = key;
      updateSelectionVisuals();
    }
    ctxTarget = { path: file.path, staged: isStaged, status: file.status };
    showScContextMenu(e.clientX, e.clientY);
  });

  // Click for select
  item.addEventListener('click', (e) => {
    if (e.target.closest('.sc-file-action')) return;
    handleFileItemClick(e, file, isStaged, key);
  });

  // Double-click for diff modal
  item.addEventListener('dblclick', (e) => {
    if (e.target.closest('.sc-file-action')) return;
    handleFileItemDblClick(file, isStaged);
  });

  item.title = file.path;
  return item;
}

function getStatusClass(status) {
  const map = { 'M': 'sc-modified', 'A': 'sc-added', 'D': 'sc-deleted', 'R': 'sc-renamed', 'C': 'sc-copied', 'U': 'sc-untracked', '?': 'sc-untracked' };
  return map[status] || 'sc-modified';
}

function getStatusLabel(status) {
  const map = { 'M': 'M', 'A': 'A', 'D': 'D', 'R': 'R', 'C': 'C', 'U': 'U', '?': 'U' };
  return map[status] || status;
}

export function onSourceControlSessionChange() {
  requestGitStatus();
}

// ─── Multi-select helpers ────────────────────────────
function makeKey(file, isStaged) {
  return (isStaged ? 'staged:' : 'unstaged:') + file.path;
}

function parseKey(key) {
  const staged = key.startsWith('staged:');
  const path = key.replace(/^(staged|unstaged):/, '');
  const file = gitStatusFiles.find(f => f.path === path && f.staged === staged);
  return { path, staged, file };
}

function getSelectedFileInfos() {
  return [...selectedItems].map(parseKey).filter(x => x.file);
}

function clearSelection() {
  selectedItems.clear();
  lastClickedKey = null;
  updateSelectionVisuals();
}

function updateSelectionVisuals() {
  const container = document.getElementById('sc-file-list');
  if (!container) return;
  container.querySelectorAll('.sc-file-item').forEach(el => {
    const key = el.dataset.fileKey;
    if (key && selectedItems.has(key)) {
      el.classList.add('sc-selected');
    } else {
      el.classList.remove('sc-selected');
    }
  });
}

function getKeysInRange(key1, key2) {
  const i1 = allFileKeys.indexOf(key1);
  const i2 = allFileKeys.indexOf(key2);
  if (i1 === -1 || i2 === -1) return [key2];
  const start = Math.min(i1, i2);
  const end = Math.max(i1, i2);
  return allFileKeys.slice(start, end + 1);
}

function handleFileItemClick(e, _file, _isStaged, key) {
  const isMeta = e.metaKey || e.ctrlKey;
  const isShift = e.shiftKey;

  if (isShift && lastClickedKey) {
    // Range select
    const range = getKeysInRange(lastClickedKey, key);
    if (!isMeta) selectedItems.clear();
    range.forEach(k => selectedItems.add(k));
  } else if (isMeta) {
    // Toggle individual
    if (selectedItems.has(key)) selectedItems.delete(key);
    else selectedItems.add(key);
    lastClickedKey = key;
  } else {
    // Single select (don't open diff, just select)
    selectedItems.clear();
    selectedItems.add(key);
    lastClickedKey = key;
  }
  updateSelectionVisuals();
}

function handleFileItemDblClick(file, isStaged) {
  selectedFile = file.path;
  const overlay = document.getElementById('diff-overlay');
  const titleFile = document.getElementById('diff-title-file');
  const diffContent = document.getElementById('diff-content');
  const diffLoading = document.getElementById('diff-loading');
  if (titleFile) titleFile.textContent = file.path;
  if (diffContent) diffContent.innerHTML = '';
  if (diffLoading) diffLoading.style.display = '';
  if (overlay) overlay.classList.add('open');
  wsSend({ type: 'git_diff', sessionId: S.activeSessionId, filePath: file.path, staged: isStaged });
}

// Drag-select: rubber band
function initDragSelect() {
  const container = document.getElementById('sc-file-list');
  if (!container) return;

  // Create lasso overlay
  let lasso = document.getElementById('sc-lasso');
  if (!lasso) {
    lasso = document.createElement('div');
    lasso.id = 'sc-lasso';
    document.body.appendChild(lasso);
  }

  container.addEventListener('mousedown', (e) => {
    // Only left button, ignore buttons/actions
    if (e.button !== 0) return;
    if (e.target.closest('.sc-file-action, .sc-action-btn, .sc-section-header, .sc-tree-dir')) return;

    dragStartedInside = true;
    dragContainer = container;
    dragStartY = e.clientY;
    dragStartX = e.clientX;
    dragCurrentY = e.clientY;
    dragCurrentX = e.clientX;
    dragMoved = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragStartedInside) return;

    const dx = Math.abs(e.clientX - dragStartX);
    const dy = Math.abs(e.clientY - dragStartY);
    if (!dragSelecting && (dx > 4 || dy > 4)) {
      dragSelecting = true;
      if (!e.metaKey && !e.ctrlKey) selectedItems.clear();
    }

    if (!dragSelecting) return;

    dragCurrentY = e.clientY;
    dragCurrentX = e.clientX;

    // Update lasso visual
    const top = Math.min(dragStartY, dragCurrentY);
    const bottom = Math.max(dragStartY, dragCurrentY);
    const left = Math.min(dragStartX, dragCurrentX);
    const right = Math.max(dragStartX, dragCurrentX);
    lasso.style.display = 'block';
    lasso.style.top = top + 'px';
    lasso.style.left = left + 'px';
    lasso.style.width = (right - left) + 'px';
    lasso.style.height = (bottom - top) + 'px';

    // Check which items are in the lasso rect
    const items = dragContainer.querySelectorAll('.sc-file-item');
    items.forEach(el => {
      const rect = el.getBoundingClientRect();
      const overlaps = rect.bottom > top && rect.top < bottom && rect.right > left && rect.left < right;
      const key = el.dataset.fileKey;
      if (!key) return;
      if (overlaps) {
        selectedItems.add(key);
      } else if (!e.metaKey && !e.ctrlKey) {
        selectedItems.delete(key);
      }
    });
    updateSelectionVisuals();
  });

  document.addEventListener('mouseup', (e) => {
    if (dragSelecting) {
      lasso.style.display = 'none';
      dragSelecting = false;
    }
    dragStartedInside = false;
  });
}

// ─── Source Control Context Menu ─────────────────────
function showScContextMenu(x, y) {
  const menu = document.getElementById('sc-ctx-menu');
  if (!menu || !ctxTarget) return;

  const sel = getSelectedFileInfos();
  const hasUnstaged = sel.some(s => !s.staged);
  const hasStaged = sel.some(s => s.staged);
  const hasDiscardable = sel.some(s => !s.staged && s.file && s.file.status !== 'U' && s.file.status !== '?');
  const multiCount = sel.length;

  // Show/hide items based on context
  const stageItem = document.getElementById('sctx-stage');
  const unstageItem = document.getElementById('sctx-unstage');
  const discardItem = document.getElementById('sctx-discard');
  const diffItem = document.getElementById('sctx-diff');
  const deleteItem = document.getElementById('sctx-delete');

  if (stageItem) {
    stageItem.style.display = hasUnstaged ? '' : 'none';
    stageItem.textContent = multiCount > 1 ? `+ Stage (${multiCount})` : '+ Stage';
  }
  if (unstageItem) {
    unstageItem.style.display = hasStaged ? '' : 'none';
    unstageItem.textContent = multiCount > 1 ? `− Unstage (${multiCount})` : '− Unstage';
  }
  if (discardItem) {
    discardItem.style.display = hasDiscardable ? '' : 'none';
    discardItem.textContent = multiCount > 1 ? `↩ Discard Changes (${multiCount})` : '↩ Discard Changes';
  }
  if (diffItem) {
    diffItem.style.display = multiCount <= 1 ? '' : 'none';
  }
  if (deleteItem) {
    deleteItem.textContent = multiCount > 1 ? `✕ Delete Files (${multiCount})` : '✕ Delete File';
  }

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('visible');
}

function hideScContextMenu() {
  const menu = document.getElementById('sc-ctx-menu');
  if (menu) menu.classList.remove('visible');
}

function initScContextMenu() {
  document.addEventListener('click', hideScContextMenu);

  document.getElementById('sctx-diff')?.addEventListener('click', () => {
    if (!ctxTarget || !S.activeSessionId) return;
    const overlay = document.getElementById('diff-overlay');
    const titleFile = document.getElementById('diff-title-file');
    const diffContent = document.getElementById('diff-content');
    const diffLoading = document.getElementById('diff-loading');
    if (titleFile) titleFile.textContent = ctxTarget.path;
    if (diffContent) diffContent.innerHTML = '';
    if (diffLoading) diffLoading.style.display = '';
    if (overlay) overlay.classList.add('open');
    wsSend({ type: 'git_diff', sessionId: S.activeSessionId, filePath: ctxTarget.path, staged: ctxTarget.staged });
  });

  document.getElementById('sctx-stage')?.addEventListener('click', () => {
    if (!S.activeSessionId) return;
    const sel = getSelectedFileInfos().filter(s => !s.staged);
    if (sel.length === 0 && ctxTarget) {
      wsSend({ type: 'git_stage', sessionId: S.activeSessionId, filePath: ctxTarget.path });
    } else {
      for (const s of sel) {
        wsSend({ type: 'git_stage', sessionId: S.activeSessionId, filePath: s.path });
      }
    }
    clearSelection();
  });

  document.getElementById('sctx-unstage')?.addEventListener('click', () => {
    if (!S.activeSessionId) return;
    const sel = getSelectedFileInfos().filter(s => s.staged);
    if (sel.length === 0 && ctxTarget) {
      wsSend({ type: 'git_unstage', sessionId: S.activeSessionId, filePath: ctxTarget.path });
    } else {
      for (const s of sel) {
        wsSend({ type: 'git_unstage', sessionId: S.activeSessionId, filePath: s.path });
      }
    }
    clearSelection();
  });

  document.getElementById('sctx-discard')?.addEventListener('click', () => {
    if (!S.activeSessionId) return;
    const sel = getSelectedFileInfos().filter(s => !s.staged && s.file && s.file.status !== 'U' && s.file.status !== '?');
    if (sel.length === 0 && ctxTarget) {
      wsSend({ type: 'git_discard', sessionId: S.activeSessionId, filePath: ctxTarget.path });
    } else {
      for (const s of sel) {
        wsSend({ type: 'git_discard', sessionId: S.activeSessionId, filePath: s.path });
      }
    }
    clearSelection();
  });

  document.getElementById('sctx-delete')?.addEventListener('click', () => {
    if (!S.activeSessionId) return;
    const sel = getSelectedFileInfos();
    const paths = sel.length > 0 ? sel.map(s => s.path) : (ctxTarget ? [ctxTarget.path] : []);
    if (paths.length === 0) return;
    const msg = paths.length === 1
      ? `Delete "${paths[0]}"?`
      : `Delete ${paths.length} files?\n${paths.join('\n')}`;
    if (!confirm(msg)) return;
    for (const p of paths) {
      wsSend({ type: 'file_delete', sessionId: S.activeSessionId, filePath: p });
    }
    clearSelection();
    setTimeout(requestGitStatus, 300);
  });
}

function renderWorktrees() {
  const section = document.getElementById('sc-worktree-section');
  const list = document.getElementById('sc-worktree-list');
  const countEl = document.getElementById('sc-worktree-count');
  if (!section || !list) return;

  if (worktrees.length <= 1) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  if (countEl) countEl.textContent = worktrees.length;

  list.innerHTML = '';
  for (const wt of worktrees) {
    const item = document.createElement('div');
    item.className = 'sc-worktree-item';

    const isCurrent = normalizePath(wt.path) === normalizePath(currentWorktreePath);
    if (isCurrent) item.classList.add('active');

    const marker = document.createElement('span');
    marker.className = 'sc-worktree-marker';
    marker.textContent = isCurrent ? '●' : '';

    const info = document.createElement('div');
    info.className = 'sc-worktree-info';

    const branchSpan = document.createElement('span');
    branchSpan.className = 'sc-worktree-branch';
    branchSpan.textContent = wt.branch || '(no branch)';

    const pathSpan = document.createElement('span');
    pathSpan.className = 'sc-worktree-path';
    const shortPath = wt.path.split('/').slice(-2).join('/');
    pathSpan.textContent = shortPath;
    pathSpan.title = wt.path;

    info.appendChild(branchSpan);
    info.appendChild(pathSpan);

    const head = document.createElement('span');
    head.className = 'sc-worktree-head';
    head.textContent = wt.head || '';

    item.appendChild(marker);
    item.appendChild(info);
    item.appendChild(head);

    if (!wt.isMain && !isCurrent) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'sc-worktree-remove';
      removeBtn.title = 'Remove worktree';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wsSend({ type: 'git_worktree_remove', sessionId: S.activeSessionId, path: wt.path });
      });
      item.appendChild(removeBtn);
    }

    if (!isCurrent) {
      item.addEventListener('click', () => {
        wsSend({ type: 'git_worktree_switch', sessionId: S.activeSessionId, path: wt.path });
      });
    }

    list.appendChild(item);
  }
}

function normalizePath(p) {
  return (p || '').replace(/\/+$/, '');
}
