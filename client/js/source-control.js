// ─── SOURCE CONTROL PANEL ────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { showToast } from './toast.js';

let gitStatusFiles = [];
let gitBranch = '';
let gitRoot = '';
let isGitRepo = false;
let viewMode = 'list'; // 'list' | 'tree'
let expandedTreeDirs = new Set();
let selectedFile = null;

export function initSourceControl() {
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

export function requestGitStatus() {
  if (!S.activeSessionId) return;
  wsSend({ type: 'git_status', sessionId: S.activeSessionId });
}

export function handleGitStatusData(msg) {
  gitStatusFiles = msg.files || [];
  gitBranch = msg.branch || '';
  gitRoot = msg.root || '';
  isGitRepo = msg.isRepo || false;
  renderSourceControl();
}

export function handleGitDiffData(msg) {
  const diffPanel = document.getElementById('sc-diff-panel');
  if (!diffPanel) return;
  if (!msg.diff) {
    diffPanel.style.display = 'none';
    return;
  }
  diffPanel.style.display = '';
  const diffContent = document.getElementById('sc-diff-content');
  if (diffContent) {
    diffContent.innerHTML = renderDiffHtml(msg.diff);
  }
}

function renderDiffHtml(diff) {
  const lines = diff.split('\n');
  return lines.map(line => {
    const escaped = escHtml(line);
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<div class="diff-add">${escaped}</div>`;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return `<div class="diff-del">${escaped}</div>`;
    } else if (line.startsWith('@@')) {
      return `<div class="diff-hunk">${escaped}</div>`;
    }
    return `<div class="diff-ctx">${escaped}</div>`;
  }).join('');
}

function renderSourceControl() {
  const container = document.getElementById('sc-file-list');
  const branchEl = document.getElementById('sc-branch-name');
  const emptyEl = document.getElementById('sc-empty');
  const countEl = document.getElementById('sc-change-count');
  if (!container) return;

  if (branchEl) branchEl.textContent = gitBranch || '—';
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
  const changes = gitStatusFiles.filter(f => !f.staged);

  container.innerHTML = '';

  if (staged.length > 0) {
    const section = createSection('STAGED CHANGES', staged, true);
    container.appendChild(section);
  }

  if (changes.length > 0) {
    const section = createSection('CHANGES', changes, false);
    container.appendChild(section);
  }
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

  // Click for diff preview
  item.addEventListener('click', () => {
    selectedFile = file.path;
    wsSend({ type: 'git_diff', sessionId: S.activeSessionId, filePath: file.path, staged: isStaged });
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
