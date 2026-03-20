import { S, sessionMeta, escHtml } from '../core/state.js';
import { wsSend } from '../core/websocket.js';
import { BRANCH_COLORS, AI_REGISTRY } from '../core/constants.js';

// ─── STATE ───────────────────────────────────────────
let isOpen = false;
let selectedHash = null;
let cachedCommits = [];
let githubBaseUrl = null;
let pendingCheckoutBranch = null;
let dropdownAbort = null;
let focusedRowIdx = -1;

// ─── PAGINATION STATE ─────────────────────────────────
let isLoadingMore = false;
let hasMore = false;
let currentSkip = 0;
// const PAGE_SIZE = 50; // reserved for future pagination
const MAX_COMMITS = 500;
let scrollRAF = null;

// ─── SEARCH STATE ─────────────────────────────────────
let searchActive = false;
let searchQuery = '';
let searchDebounce = null;

// ─── DOM REFS ────────────────────────────────────────
const overlay = document.getElementById('git-graph-overlay');
const repoName = document.getElementById('gg-repo-name');
const branchBdg = document.getElementById('gg-branch-badge');
const loading = document.getElementById('gg-loading');
const errorEl = document.getElementById('gg-error');
const content = document.getElementById('gg-content');
const svgEl = document.getElementById('gg-svg');
const commitBox = document.getElementById('gg-commits');
// inline detail row — injected into gg-commits dynamically, no static DOM refs needed
const sbBranch = document.getElementById('sb-branch');
const sbBrSep = document.getElementById('sb-branch-sep');
const sbBrName = document.getElementById('sb-branch-name');
const loadMore = document.getElementById('gg-load-more');
const searchToggle = document.getElementById('gg-search-toggle');
const searchBar = document.getElementById('gg-search-bar');
const searchInput = document.getElementById('gg-search-input');
const searchEmpty = document.getElementById('gg-search-empty');

// Branch dropdown
const branchDropdown = document.getElementById('gg-branch-dropdown');
const branchTrigger = document.getElementById('gg-branch-trigger');
const branchMenu = document.getElementById('gg-branch-menu');

// GitHub button, Pull button & Push button
const githubBtn = document.getElementById('gg-github-btn');
const pullBtn = document.getElementById('gg-pull-btn');
const pushBtn = document.getElementById('gg-push-btn');

// Confirm dialog
const confirmEl = document.getElementById('gg-confirm');
const confirmMessage = document.getElementById('gg-confirm-message');
const confirmOk = document.getElementById('gg-confirm-ok');
const confirmCancel = document.getElementById('gg-confirm-cancel');

// Modal + resize
const modal = document.getElementById('git-graph-modal');
const resizeHandle = document.getElementById('gg-resize-handle');

const STORAGE_KEY = 'gg-modal-size';

function restoreModalSize() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.w && saved?.h) {
      modal.style.width = saved.w + 'px';
      modal.style.height = saved.h + 'px';
    }
  } catch {}
}

function saveModalSize() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        w: modal.offsetWidth,
        h: modal.offsetHeight,
      })
    );
  } catch {}
}

// ─── OPEN / CLOSE ────────────────────────────────────
export function openGitGraph() {
  if (!S.activeSessionId) return;

  const hasCached = cachedCommits.length > 0;

  isOpen = true;
  selectedHash = null;
  focusedRowIdx = -1;
  isLoadingMore = false;
  hasMore = false;
  currentSkip = 0;
  loadMore.style.display = 'none';
  searchActive = false;
  searchQuery = '';
  searchBar.style.display = 'none';
  searchToggle.classList.remove('active');
  searchEmpty.style.display = 'none';
  restoreModalSize();
  overlay.classList.add('open');
  errorEl.style.display = 'none';
  confirmEl.style.display = 'none';
  branchMenu.classList.remove('open');

  if (hasCached) {
    // Show cached data immediately while fetching fresh data
    content.style.display = 'flex';
    loading.style.display = 'none';
  } else {
    cachedCommits = [];
    githubBaseUrl = null;
    loading.style.display = 'flex';
    content.style.display = 'none';
    githubBtn.style.display = 'none';
  }

  const meta = sessionMeta.get(S.activeSessionId);
  const cwd = meta?.cwd || '';
  const wtMatch = cwd.match(/\.claude\/worktrees\/([^/]+)/);
  const repoLabel = cwd.split('/').pop() || 'repo';
  repoName.textContent = wtMatch ? `${repoLabel} [${wtMatch[1]}]` : repoLabel;
  branchBdg.textContent = sbBrName.textContent || '...';

  // Always fetch fresh data
  wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
  wsSend({ type: 'git_branch_list', sessionId: S.activeSessionId });
  wsSend({ type: 'git_remote_url', sessionId: S.activeSessionId });

  // Blur terminal so keydown events reach document listener
  if (document.activeElement) document.activeElement.blur();
  modal.focus();

  // Close dropdown on outside click
  if (dropdownAbort) dropdownAbort.abort();
  dropdownAbort = new AbortController();
  document.addEventListener(
    'click',
    (e) => {
      if (!branchDropdown.contains(e.target)) {
        branchMenu.classList.remove('open');
      }
    },
    { signal: dropdownAbort.signal }
  );
}

export function closeGitGraph() {
  isOpen = false;
  overlay.classList.remove('open');
  branchMenu.classList.remove('open');
  hideCtxMenu();
  if (dropdownAbort) {
    dropdownAbort.abort();
    dropdownAbort = null;
  }
}

function hideGitGraph() {
  isOpen = false;
  overlay.classList.remove('open');
  branchMenu.classList.remove('open');
  hideCtxMenu();
  if (dropdownAbort) {
    dropdownAbort.abort();
    dropdownAbort = null;
  }
}

export function isGitGraphOpen() {
  return isOpen;
}

// ─── KEYBOARD NAVIGATION ─────────────────────────────
function getRows() {
  return commitBox.querySelectorAll('.gg-row');
}

function updateRowFocus(rows, newIdx) {
  if (focusedRowIdx >= 0 && focusedRowIdx < rows.length) {
    rows[focusedRowIdx].classList.remove('focused');
  }
  focusedRowIdx = newIdx;
  if (focusedRowIdx >= 0 && focusedRowIdx < rows.length) {
    const row = rows[focusedRowIdx];
    row.classList.add('focused');
    row.scrollIntoView({ block: 'nearest' });
  }
}

export function handleGitGraphKeydown(e) {
  if (!isOpen) return false;

  // Escape — close search first, then modal
  if (e.key === 'Escape') {
    e.preventDefault();
    if (searchActive) {
      closeSearch();
      return true;
    }
    closeGitGraph();
    return true;
  }

  // Confirm dialog is open — Enter confirms
  if (confirmEl.style.display === 'flex') {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      doCheckout();
      return true;
    }
    return false;
  }

  // If search input is focused, ArrowDown moves to results
  if (searchActive && document.activeElement === searchInput && e.key === 'ArrowDown') {
    e.preventDefault();
    const rows = getRows();
    if (rows.length) {
      updateRowFocus(rows, 0);
      modal.focus();
    }
    return true;
  }

  // Typing while result list is focused → re-focus search input
  if (
    searchActive &&
    document.activeElement !== searchInput &&
    e.key.length === 1 &&
    !e.metaKey &&
    !e.ctrlKey
  ) {
    searchInput.focus();
    return false; // let the keystroke pass through to the input
  }

  // Branch dropdown is open — arrow/enter navigate it
  if (branchMenu.classList.contains('open')) {
    const items = [...branchMenu.querySelectorAll('.gg-branch-item')];
    if (!items.length) return false;
    const cur = branchMenu.querySelector('.gg-branch-item.gg-branch-focused');
    let idx = cur ? items.indexOf(cur) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cur) cur.classList.remove('gg-branch-focused');
      idx = idx < items.length - 1 ? idx + 1 : 0;
      items[idx].classList.add('gg-branch-focused');
      items[idx].scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cur) cur.classList.remove('gg-branch-focused');
      idx = idx > 0 ? idx - 1 : items.length - 1;
      items[idx].classList.add('gg-branch-focused');
      items[idx].scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (cur) {
        branchMenu.classList.remove('open');
        const branch = cur.dataset.branch;
        if (branch && !cur.classList.contains('current')) {
          showCheckoutConfirm(branch);
        }
      }
      return true;
    }
    return false;
  }

  // Arrow Up/Down — navigate commit rows
  const rows = getRows();
  if (!rows.length) return false;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const newIdx = focusedRowIdx < rows.length - 1 ? focusedRowIdx + 1 : 0;
    updateRowFocus(rows, newIdx);
    const hash = rows[newIdx].dataset.hash;
    if (hash) selectCommit(hash);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    const newIdx = focusedRowIdx > 0 ? focusedRowIdx - 1 : rows.length - 1;
    updateRowFocus(rows, newIdx);
    const hash = rows[newIdx].dataset.hash;
    if (hash) selectCommit(hash);
    return true;
  }

  // Enter — select focused commit
  if ((e.key === 'Enter' || e.key === ' ') && focusedRowIdx >= 0 && focusedRowIdx < rows.length) {
    e.preventDefault();
    const hash = rows[focusedRowIdx].dataset.hash;
    if (hash) onCommitClick(hash);
    return true;
  }

  return false;
}

// ─── HANDLERS ────────────────────────────────────────
export function handleGitGraphData(msg) {
  loading.style.display = 'none';

  // Discard append responses if search became active while loading
  const isAppend = msg.skip > 0;
  if (isAppend && searchActive) {
    isLoadingMore = false;
    loadMore.style.display = 'none';
    return;
  }

  if (!isAppend) {
    // Initial load
    if (msg.error || !msg.commits || msg.commits.length === 0) {
      errorEl.style.display = 'flex';
      errorEl.textContent = msg.error ? 'Not a git repository' : 'No commits found';
      content.style.display = 'none';
      return;
    }
    cachedCommits = msg.commits;
    content.style.display = 'flex';
  } else {
    // Append load
    if (msg.commits && msg.commits.length > 0) {
      cachedCommits = cachedCommits.concat(msg.commits);
    }
  }

  hasMore = !!msg.hasMore && cachedCommits.length < MAX_COMMITS;
  currentSkip = cachedCommits.length;
  isLoadingMore = false;
  loadMore.style.display = 'none';

  const scrollEl = document.getElementById('gg-scroll');
  if (isAppend && msg.commits && msg.commits.length > 0) {
    // Append-only: extend SVG and add new rows without touching existing DOM
    const prevScroll = scrollEl.scrollTop;
    appendToGraph(cachedCommits, msg.commits.length);
    scrollEl.scrollTop = prevScroll;
  } else {
    renderGraph(cachedCommits);
  }
}

// ─── INLINE DETAIL ROW ───────────────────────────────
function buildMetaHtml(commit, detail) {
  const hash = detail?.hash || commit?.hash || '';
  const parents = detail?.parents || commit?.parents || [];
  const authorName = detail?.authorName || commit?.author || '';
  const authorEmail = detail?.authorEmail || '';
  const committerName = detail?.committerName || '';
  const committerEmail = detail?.committerEmail || '';
  const date = detail?.authorDate || commit?.date || '';
  const subject = detail?.subject || commit?.message || '';
  const body = detail?.body || commit?.body || '';

  const displayBody = body
    .split('\n')
    .filter((l) => !/^Co-Authored-By:/i.test(l.trim()))
    .join('\n')
    .trim();

  const parentHtml = parents.length
    ? parents
        .map((p) => `<span class="gg-detail-hash-link" data-hash="${escHtml(p)}">${escHtml(p.slice(0, 7))}</span>`)
        .join(' ')
    : '<span style="color:var(--text-ghost)">none</span>';

  const dateFormatted = date
    ? new Date(date).toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : '';

  let meta = `<div class="gg-detail-rows">`;
  meta += `<div class="gg-detail-row"><span class="gg-detail-label">Commit</span><span class="gg-detail-value gg-detail-hash" title="${escHtml(hash)}" data-copy="${escHtml(hash)}">${escHtml(hash.slice(0, 7))}<span class="gg-detail-hash-full">${escHtml(hash)}</span></span></div>`;
  meta += `<div class="gg-detail-row"><span class="gg-detail-label">Parents</span><span class="gg-detail-value">${parentHtml}</span></div>`;
  meta += `<div class="gg-detail-row"><span class="gg-detail-label">Author</span><span class="gg-detail-value">${escHtml(authorName)}${authorEmail ? `<span class="gg-detail-email">&lt;${escHtml(authorEmail)}&gt;</span>` : ''}</span></div>`;
  if (committerName && committerName !== authorName) {
    meta += `<div class="gg-detail-row"><span class="gg-detail-label">Committer</span><span class="gg-detail-value">${escHtml(committerName)}${committerEmail ? `<span class="gg-detail-email">&lt;${escHtml(committerEmail)}&gt;</span>` : ''}</span></div>`;
  }
  meta += `<div class="gg-detail-row"><span class="gg-detail-label">Date</span><span class="gg-detail-value">${escHtml(dateFormatted)}</span></div>`;
  if (subject || displayBody) {
    meta += `<div class="gg-detail-row gg-detail-row-msg"><span class="gg-detail-label">Message</span><span class="gg-detail-value"><div class="gg-detail-subject">${escHtml(subject)}</div>${displayBody ? `<pre class="gg-detail-body">${escHtml(displayBody)}</pre>` : ''}</span></div>`;
  }
  meta += `</div>`;
  return meta;
}

function buildFilesHtml(files) {
  if (!files || files.length === 0) {
    return { title: 'Changed files', html: `<div class="gg-detail-file-item" style="color:var(--text-ghost)">No changed files</div>` };
  }
  return {
    title: `Changed files (${files.length})`,
    html: files.map((f) => {
      const stat = fileStatBadge(f.additions, f.deletions);
      return `<div class="gg-detail-file-item" data-path="${escHtml(f.path)}" style="cursor:pointer"><span class="gg-file-status gg-file-status-${escHtml(f.status)}">${escHtml(f.status)}</span><span class="gg-file-path">${escHtml(f.path)}</span>${stat}</div>`;
    }).join(''),
  };
}

const DETAIL_SPLIT_KEY = 'gg-detail-split-w';
const DETAIL_SPLIT_MIN = 160;
const DETAIL_SPLIT_MAX = 600;

function getSavedSplitWidth() {
  try { return parseInt(localStorage.getItem(DETAIL_SPLIT_KEY)) || 340; } catch { return 340; }
}

function buildInitialDetailHtml(hash) {
  return `<div class="gg-inline-detail" data-detail-hash="${escHtml(hash)}">
    <div class="gg-inline-left"></div>
    <div class="gg-inline-divider"></div>
    <div class="gg-inline-right">
      <div class="gg-inline-files-title">Changed files</div>
      <div class="gg-inline-file-list"></div>
    </div>
  </div>`;
}

function getDetailRow(hash) {
  return commitBox.querySelector(`.gg-detail-wrapper[data-detail-hash="${CSS.escape(hash)}"]`);
}

function closeDetailRow() {
  const existing = commitBox.querySelector('.gg-detail-wrapper');
  if (existing) existing.remove();
  // Sync SVG immediately after detail row removed
  requestAnimationFrame(() => rebuildSvg());
}

function insertDetailRow(hash, commit) {
  closeDetailRow();
  const row = commitBox.querySelector(`.gg-row[data-hash="${CSS.escape(hash)}"]`);
  if (!row) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'gg-detail-wrapper';
  wrapper.dataset.detailHash = hash;
  wrapper.innerHTML = buildInitialDetailHtml(hash);
  row.after(wrapper);
  // Sync SVG after browser has laid out the new wrapper
  requestAnimationFrame(() => requestAnimationFrame(() => rebuildSvg()));

  // Apply saved width
  const rightEl = wrapper.querySelector('.gg-inline-right');
  if (rightEl) rightEl.style.width = getSavedSplitWidth() + 'px';

  // Drag-to-resize divider
  const divider = wrapper.querySelector('.gg-inline-divider');
  if (divider && rightEl) {
    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightEl.offsetWidth;
      divider.classList.add('dragging');
      function onMove(ev) {
        const newW = Math.max(DETAIL_SPLIT_MIN, Math.min(DETAIL_SPLIT_MAX, startW - (ev.clientX - startX)));
        rightEl.style.width = newW + 'px';
      }
      function onUp() {
        divider.classList.remove('dragging');
        try { localStorage.setItem(DETAIL_SPLIT_KEY, rightEl.offsetWidth); } catch {}
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Populate meta immediately from cached commit data
  const leftEl = wrapper.querySelector('.gg-inline-left');
  if (leftEl && commit) leftEl.innerHTML = buildMetaHtml(commit, null);

  wrapper.addEventListener('click', (e) => {
    const copyEl = e.target.closest('[data-copy]');
    if (copyEl) {
      navigator.clipboard.writeText(copyEl.dataset.copy).then(() => {
        const orig = copyEl.textContent;
        copyEl.textContent = 'Copied!';
        setTimeout(() => { copyEl.textContent = orig; }, 1200);
      });
      return;
    }
    const parentLink = e.target.closest('.gg-detail-hash-link[data-hash]');
    if (parentLink) {
      const ph = parentLink.dataset.hash;
      const rows = commitBox.querySelectorAll('.gg-row');
      const idx = [...rows].findIndex((r) => r.dataset.hash?.startsWith(ph) || ph.startsWith(r.dataset.hash || ''));
      if (idx >= 0) {
        updateRowFocus(rows, idx);
        onCommitClick(rows[idx].dataset.hash);
      }
      return;
    }
    const fileItem = e.target.closest('.gg-detail-file-item[data-path]');
    if (fileItem) {
      wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath: fileItem.dataset.path });
      hideGitGraph();
    }
  });
}

// ─── CONTEXT MENU ────────────────────────────────────
const ctxMenu = document.getElementById('gg-ctx-menu');
const inputDialog = document.getElementById('gg-input-dialog');
const inputDialogMessage = document.getElementById('gg-input-dialog-message');
const inputDialogField = document.getElementById('gg-input-dialog-field');
const inputDialogOk = document.getElementById('gg-input-dialog-ok');
const inputDialogCancel = document.getElementById('gg-input-dialog-cancel');

let inputDialogResolve = null;

function hideCtxMenu() {
  ctxMenu.style.display = 'none';
}

function showInputDialog(message, placeholder) {
  return new Promise((resolve) => {
    inputDialogResolve = resolve;
    inputDialogMessage.textContent = message;
    inputDialogField.value = '';
    inputDialogField.placeholder = placeholder || '';
    inputDialog.style.display = 'flex';
    setTimeout(() => inputDialogField.focus(), 0);
  });
}

function closeInputDialog(value) {
  inputDialog.style.display = 'none';
  if (inputDialogResolve) {
    inputDialogResolve(value ?? null);
    inputDialogResolve = null;
  }
}

inputDialogOk.addEventListener('click', () => closeInputDialog(inputDialogField.value.trim()));
inputDialogCancel.addEventListener('click', () => closeInputDialog(null));
inputDialogField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); closeInputDialog(inputDialogField.value.trim()); }
  if (e.key === 'Escape') { e.preventDefault(); closeInputDialog(null); }
});

function ctxItem(label, fn, danger = false) {
  const btn = document.createElement('button');
  btn.className = 'gg-ctx-item' + (danger ? ' danger' : '');
  btn.textContent = label;
  btn.addEventListener('click', () => { hideCtxMenu(); fn(); });
  return btn;
}

function ctxSep() {
  const d = document.createElement('div');
  d.className = 'gg-ctx-separator';
  return d;
}

function ptyOp(op, hash) {
  wsSend({ type: 'git_pty_op', sessionId: S.activeSessionId, op, hash });
}

function showCtxMenu(x, y, hash, commit) {
  const subject = commit?.message || '';
  ctxMenu.innerHTML = '';

  ctxMenu.appendChild(ctxItem('Add Tag...', async () => {
    const name = await showInputDialog(`Tag name for ${hash.slice(0, 7)}:`, 'v1.0.0');
    if (!name) return;
    wsSend({ type: 'git_tag_create', sessionId: S.activeSessionId, hash, name });
  }));

  ctxMenu.appendChild(ctxItem('Create Branch...', async () => {
    const name = await showInputDialog(`Branch name from ${hash.slice(0, 7)}:`, 'feature/my-branch');
    if (!name) return;
    wsSend({ type: 'git_branch_create', sessionId: S.activeSessionId, hash, name });
  }));

  ctxMenu.appendChild(ctxSep());

  ctxMenu.appendChild(ctxItem('Checkout (detached HEAD)', () => ptyOp('checkout_detached', hash)));
  ctxMenu.appendChild(ctxItem('Cherry Pick', () => ptyOp('cherry_pick', hash)));
  ctxMenu.appendChild(ctxItem('Revert', () => ptyOp('revert', hash)));
  ctxMenu.appendChild(ctxItem('Merge into current branch', () => ptyOp('merge', hash)));
  ctxMenu.appendChild(ctxItem('Rebase current branch on this commit', () => ptyOp('rebase', hash)));

  ctxMenu.appendChild(ctxSep());

  ctxMenu.appendChild(ctxItem('Reset — soft', () => ptyOp('reset_soft', hash)));
  ctxMenu.appendChild(ctxItem('Reset — mixed', () => ptyOp('reset_mixed', hash)));
  ctxMenu.appendChild(ctxItem('Reset — hard', () => ptyOp('reset_hard', hash), true));

  ctxMenu.appendChild(ctxSep());

  ctxMenu.appendChild(ctxItem('Copy Commit Hash', () => navigator.clipboard.writeText(hash)));
  ctxMenu.appendChild(ctxItem('Copy Commit Subject', () => navigator.clipboard.writeText(subject)));

  // Position: keep inside viewport
  ctxMenu.style.display = 'block';
  const menuW = ctxMenu.offsetWidth || 240;
  const menuH = ctxMenu.offsetHeight || 320;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  ctxMenu.style.left = (x + menuW > vw ? vw - menuW - 8 : x) + 'px';
  ctxMenu.style.top  = (y + menuH > vh ? y - menuH : y) + 'px';
}

// Dismiss context menu on outside click or Esc
document.addEventListener('click', (e) => {
  if (ctxMenu.style.display !== 'none' && !ctxMenu.contains(e.target)) {
    hideCtxMenu();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ctxMenu.style.display !== 'none') {
    hideCtxMenu();
  }
});

export function handleGitFileListData(msg) {
  const wrapper = getDetailRow(msg.hash);
  if (!wrapper) return;

  const commit = cachedCommits.find((c) => c.hash === msg.hash);
  const detail = msg.detail || null;

  // Update left (meta) only if detail has richer data (email etc.)
  if (detail) {
    const leftEl = wrapper.querySelector('.gg-inline-left');
    if (leftEl) leftEl.innerHTML = buildMetaHtml(commit, detail);
  }

  // Update right (files) — replaces loading placeholder
  const { title, html } = buildFilesHtml(msg.files);
  const titleEl = wrapper.querySelector('.gg-inline-files-title');
  const listEl = wrapper.querySelector('.gg-inline-file-list');
  if (titleEl) titleEl.textContent = title;
  if (listEl) listEl.innerHTML = html;
}

export function handleGitBranchData(msg) {
  if (msg.branch) {
    if (sbBranch) sbBranch.style.display = '';
    if (sbBrSep) sbBrSep.style.display = '';
    if (sbBrName) sbBrName.textContent = msg.branch;
  } else {
    if (sbBranch) sbBranch.style.display = 'none';
    if (sbBrSep) sbBrSep.style.display = 'none';
    if (sbBrName) sbBrName.textContent = '';
  }
}

export function handleGitBranchListData(msg) {
  if (!msg.branches || msg.branches.length === 0) return;

  const local = msg.branches.filter((b) => !b.isRemote);
  const remote = msg.branches.filter((b) => b.isRemote);

  let html = '';
  if (local.length > 0) {
    html += '<div class="gg-branch-menu-label">LOCAL</div>';
    html += local
      .map(
        (b) =>
          `<div class="gg-branch-item${b.isCurrent ? ' current' : ''}" data-branch="${escHtml(b.name)}">${escHtml(b.name)}</div>`
      )
      .join('');
  }
  if (remote.length > 0) {
    html += '<div class="gg-branch-menu-label">REMOTE</div>';
    html += remote
      .map(
        (b) =>
          `<div class="gg-branch-item gg-branch-item-remote" data-branch="${escHtml(b.name)}">${escHtml(b.name)}</div>`
      )
      .join('');
  }
  branchMenu.innerHTML = html;
}

export function handleGitRemoteUrlData(msg) {
  githubBaseUrl = parseGithubUrl(msg.url);
  githubBtn.style.display = githubBaseUrl ? '' : 'none';
}

export function handleGitCheckoutAck(msg) {
  confirmEl.style.display = 'none';
  if (searchActive) closeSearch();
  if (msg.error) return;
  // Refresh graph and branch info after checkout
  if (S.activeSessionId) {
    requestBranch(S.activeSessionId);
    setTimeout(() => {
      if (isOpen && S.activeSessionId) {
        wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
        wsSend({ type: 'git_branch_list', sessionId: S.activeSessionId });
      }
    }, 1500);
  }
}

// ─── PULL ────────────────────────────────────────────
let pullTimer = null;

function resetPullBtn() {
  pullBtn.classList.remove('pulling', 'pull-ok', 'pull-err');
  pullBtn.textContent = '⬇ Pull';
  if (pullTimer) {
    clearTimeout(pullTimer);
    pullTimer = null;
  }
}

function doPull() {
  if (!S.activeSessionId || pullBtn.classList.contains('pulling')) return;
  resetPullBtn();
  pullBtn.classList.add('pulling');
  pullBtn.textContent = '⬇ Pulling...';
  wsSend({ type: 'git_pull', sessionId: S.activeSessionId });
  // Fallback: auto-complete after 30s even without ack
  pullTimer = setTimeout(() => {
    if (pullBtn.classList.contains('pulling')) {
      finishPull(false);
    }
  }, 30000);
}

function finishPull(isError) {
  if (pullTimer) {
    clearTimeout(pullTimer);
    pullTimer = null;
  }
  pullBtn.classList.remove('pulling');
  if (isError) {
    pullBtn.classList.add('pull-err');
    pullBtn.textContent = '⬇ Failed';
  } else {
    pullBtn.classList.add('pull-ok');
    pullBtn.textContent = '⬇ Done';
    if (isOpen && S.activeSessionId) {
      wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
      wsSend({ type: 'git_branch_list', sessionId: S.activeSessionId });
    }
  }
  setTimeout(resetPullBtn, 3000);
}

export function handleGitPullAck(msg) {
  finishPull(!!msg.error);
}

// ─── PUSH ────────────────────────────────────────────
let pushTimer = null;

function resetPushBtn() {
  pushBtn.classList.remove('pushing', 'push-ok', 'push-err');
  pushBtn.textContent = '⬆ Push';
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

function doPush() {
  if (!S.activeSessionId || pushBtn.classList.contains('pushing')) return;
  resetPushBtn();
  pushBtn.classList.add('pushing');
  pushBtn.textContent = '⬆ Pushing...';
  wsSend({ type: 'git_push', sessionId: S.activeSessionId });
  pushTimer = setTimeout(() => {
    if (pushBtn.classList.contains('pushing')) {
      finishPush(false);
    }
  }, 10000);
}

function finishPush(isError) {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  pushBtn.classList.remove('pushing');
  if (isError) {
    pushBtn.classList.add('push-err');
    pushBtn.textContent = '⬆ Failed';
  } else {
    pushBtn.classList.add('push-ok');
    pushBtn.textContent = '⬆ Done';
    if (isOpen && S.activeSessionId) {
      setTimeout(() => {
        wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
        wsSend({ type: 'git_branch_list', sessionId: S.activeSessionId });
      }, 500);
    }
  }
  setTimeout(resetPushBtn, 3000);
}

export function handleGitPushAckInGraph(msg) {
  finishPush(!!msg.error);
}

export function handleGitGraphSearchData(msg) {
  // Discard stale responses
  if (!searchActive || msg.query !== searchQuery) return;

  const q = msg.query.toLowerCase();
  const clientResults = cachedCommits.filter(
    (c) =>
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.hash.toLowerCase().startsWith(q)
  );

  // Merge server + client results, dedup by hash
  const seen = new Set(clientResults.map((c) => c.hash));
  const merged = [...clientResults];
  if (msg.commits) {
    for (const c of msg.commits) {
      if (!seen.has(c.hash)) {
        seen.add(c.hash);
        merged.push(c);
      }
    }
  }

  // Sort by date descending
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  renderSearchResults(merged, msg.query);
}

// ─── GITHUB URL PARSING ─────────────────────────────
function parseGithubUrl(remoteUrl) {
  if (!remoteUrl || !remoteUrl.includes('github.com')) return null;
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // HTTPS: https://github.com/owner/repo[.git]
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  return null;
}

// ─── CONFIRM DIALOG ─────────────────────────────────
function showCheckoutConfirm(branch) {
  pendingCheckoutBranch = branch;
  confirmMessage.innerHTML = `Switch to <strong style="color:var(--accent)">${escHtml(branch)}</strong>?<br><span style="font-size:11px;color:var(--text-dim)">Uncommitted changes may be lost.</span>`;
  confirmEl.style.display = 'flex';
}

function hideCheckoutConfirm() {
  pendingCheckoutBranch = null;
  confirmEl.style.display = 'none';
}

function doCheckout() {
  if (!pendingCheckoutBranch || !S.activeSessionId) return;
  wsSend({ type: 'git_checkout', sessionId: S.activeSessionId, branch: pendingCheckoutBranch });
}

// ─── REQUEST BRANCH ──────────────────────────────────
export function requestBranch(sessionId) {
  if (sessionId) wsSend({ type: 'git_branch', sessionId });
}

// ─── RELATIVE TIME ───────────────────────────────────
function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

function isWithinOneHour(iso) {
  return (Date.now() - new Date(iso).getTime()) / 1000 < 3600;
}

function absTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${h12}:${min}\u202F${ampm}`;
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) return `Today at ${timeStr}`;
  return `${mon[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${timeStr}`;
}

// ─── CO-AUTHOR PARSING ───────────────────────────────
function parseCoAuthors(body) {
  if (!body) return [];
  const regex = /Co-Authored-By:\s*(.+?)\s*<([^>]*)>/gi;
  const authors = [];
  let m;
  while ((m = regex.exec(body)) !== null) {
    authors.push({ name: m[1].trim(), email: m[2].trim() });
  }
  return authors;
}

function coAuthorAvatar(author) {
  const name = author.name.toLowerCase();
  // Match known AI tools
  for (const [key, reg] of Object.entries(AI_REGISTRY)) {
    if (name.includes(key)) {
      return `<img class="gg-coauthor-img" src="${reg.icon}" title="${escHtml(author.name)}" alt="${reg.label}">`;
    }
  }
  // Fallback: initial letter avatar
  const initial = author.name.charAt(0).toUpperCase();
  return `<span class="gg-coauthor-initial" title="${escHtml(author.name)} &lt;${escHtml(author.email)}&gt;">${initial}</span>`;
}

function coAuthorBadge(coAuthors) {
  if (!coAuthors.length) return '';
  return coAuthors.map((a) => coAuthorAvatar(a)).join('');
}

// ─── STAT BADGE ──────────────────────────────────────
function _statBadge(add, del) {
  // eslint-disable-line no-unused-vars
  if (!add && !del) return '';
  const parts = [];
  if (add) parts.push(`<span class="gg-stat-add">+${add}</span>`);
  if (del) parts.push(`<span class="gg-stat-del">-${del}</span>`);
  return parts.join(' ');
}

function fileStatBadge(add, del) {
  if (!add && !del) return '';
  const parts = [];
  if (add) parts.push(`<span class="gg-stat-add">+${add}</span>`);
  if (del) parts.push(`<span class="gg-stat-del">-${del}</span>`);
  return `<span class="gg-file-stat">${parts.join(' ')}</span>`;
}

// ─── REF BADGE HTML ──────────────────────────────────
function refBadge(ref) {
  const r = ref.trim();
  if (r.startsWith('HEAD -> ')) {
    const br = r.slice(8);
    return `<span class="gg-ref gg-ref-head" data-checkout-branch="${escHtml(br)}">${escHtml(br)}</span>`;
  }
  if (r.startsWith('tag: ')) {
    return `<span class="gg-ref gg-ref-tag">${escHtml(r.slice(5))}</span>`;
  }
  if (r.includes('/')) {
    return `<span class="gg-ref gg-ref-remote" data-checkout-branch="${escHtml(r)}">${escHtml(r)}</span>`;
  }
  return `<span class="gg-ref gg-ref-branch" data-checkout-branch="${escHtml(r)}">${escHtml(r)}</span>`;
}

// ─── GRAPH LAYOUT ────────────────────────────────────
const ROW_H = 40;
const COL_W = 16;
const PAD_X = 12;

function computeLayout(commits) {
  // Pass 1: assign lanes & X positions (Y is index-based here, overridden by DOM later)
  const lanes = []; // active lane slots: each holds expected commit hash
  const positions = new Map(); // hash -> { x, y, col, color }

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    let col = lanes.indexOf(c.hash);
    if (col === -1) {
      col = lanes.indexOf(null);
      if (col === -1) {
        col = lanes.length;
        lanes.push(null);
      }
    }
    lanes[col] = null;

    const x = PAD_X + col * COL_W;
    const y = ROW_H / 2 + i * ROW_H; // nominal Y; rebuilt from DOM after render
    const color = BRANCH_COLORS[col % BRANCH_COLORS.length];
    positions.set(c.hash, { x, y, col, color });

    for (let pi = 0; pi < c.parents.length; pi++) {
      const ph = c.parents[pi];
      if (positions.has(ph)) continue;
      if (pi === 0) {
        lanes[col] = ph;
      } else {
        let pcol = lanes.indexOf(ph);
        if (pcol === -1) {
          pcol = lanes.indexOf(null);
          if (pcol === -1) {
            pcol = lanes.length;
            lanes.push(null);
          }
          lanes[pcol] = ph;
        }
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  }

  const maxCol = Math.max(...Array.from(positions.values()).map((p) => p.col), 0);
  const svgWidth = PAD_X * 2 + maxCol * COL_W + 8;

  return { positions, svgWidth };
}

/** Read DOM Y position of each row relative to commitBox's offsetParent (gg-scroll) */
function readDomY(positions) {
  // commitBox may have its own offsetTop within gg-scroll; rows' offsetTop is within commitBox
  const boxTop = commitBox.offsetTop;
  const domY = new Map();
  commitBox.querySelectorAll('.gg-row[data-hash]').forEach((el) => {
    domY.set(el.dataset.hash, boxTop + el.offsetTop + ROW_H / 2);
  });
  // Fallback to nominal Y (boxTop + index * ROW_H + ROW_H/2) for rows not in DOM
  for (const [hash, pos] of positions) {
    if (!domY.has(hash)) domY.set(hash, boxTop + pos.y);
  }
  return domY;
}

function renderSvg(commits, positions, svgWidth) {
  const domY = readDomY(positions);

  // SVG height = last row's bottom edge
  const rows = commitBox.querySelectorAll('.gg-row[data-hash]');
  const lastRow = rows[rows.length - 1];
  const boxTop = commitBox.offsetTop;
  const svgHeight = lastRow
    ? boxTop + lastRow.offsetTop + ROW_H
    : boxTop + commits.length * ROW_H;

  svgEl.setAttribute('width', svgWidth);
  svgEl.setAttribute('height', svgHeight);
  svgEl.style.width = svgWidth + 'px';
  svgEl.style.minWidth = svgWidth + 'px';

  let svg = '';

  // Edges
  for (const c of commits) {
    const pos = positions.get(c.hash);
    if (!pos) continue;
    const y1 = domY.get(c.hash) ?? pos.y;
    for (const ph of c.parents) {
      const ppos = positions.get(ph);
      if (!ppos) continue;
      const y2 = domY.get(ph) ?? ppos.y;
      if (pos.x === ppos.x) {
        svg += `<line x1="${pos.x}" y1="${y1}" x2="${ppos.x}" y2="${y2}" stroke="${ppos.color}" stroke-width="1.5" />`;
      } else {
        const R = 8;
        const dx = ppos.x - pos.x;
        const dir = dx > 0 ? 1 : -1;
        const bendY = y2 - R;
        svg += `<path d="M${pos.x},${y1} L${pos.x},${bendY} Q${pos.x},${y2} ${pos.x + R * dir},${y2} L${ppos.x},${y2}" stroke="${ppos.color}" stroke-width="1.5" fill="none" />`;
      }
    }
  }

  // Nodes
  for (const c of commits) {
    const p = positions.get(c.hash);
    if (!p) continue;
    const cy = domY.get(c.hash) ?? p.y;
    svg += `<circle cx="${p.x}" cy="${cy}" r="3.5" fill="${p.color}" />`;
  }

  svgEl.innerHTML = svg;
}

// Current layout cache for SVG rebuilds (set after each render)
let _layoutCache = null;

/** Rebuild SVG using current DOM row positions (called after detail open/close) */
function rebuildSvg() {
  if (!_layoutCache) return;
  renderSvg(_layoutCache.commits, _layoutCache.positions, _layoutCache.svgWidth);
}

// ─── RENDER ──────────────────────────────────────────
function renderGraph(commits) {
  const { positions, svgWidth } = computeLayout(commits);
  _layoutCache = { commits, positions, svgWidth };

  // Render rows first so offsetTop is readable
  commitBox.innerHTML = commits
    .map((c) => {
      const refs =
        c.refs.length > 0 ? `<span class="gg-refs">${c.refs.map(refBadge).join('')}</span>` : '';
      const coAuthors = parseCoAuthors(c.body);
      const coAuthorHtml = coAuthorBadge(coAuthors);
      return (
        `<div class="gg-row" data-hash="${escHtml(c.hash)}" style="height:${ROW_H}px">` +
        `<span class="gg-msg">${refs}${escHtml(c.message)}</span>` +
        `<span class="gg-author">${escHtml(c.author)}${coAuthorHtml}</span>` +
        `<span class="gg-hash" data-hash="${escHtml(c.hash)}">${escHtml(c.hash.slice(0, 7))}</span>` +
        `<span class="gg-time">${isWithinOneHour(c.date) ? relTime(c.date) + ' ago' : absTime(c.date)}</span>` +
        `</div>`
      );
    })
    .join('');

  renderSvg(commits, positions, svgWidth);
}

// ─── APPEND RENDER (for infinite scroll) ────────────
function appendToGraph(allCommits, newCount) {
  const newCommits = allCommits.slice(-newCount);
  const { positions, svgWidth } = computeLayout(allCommits);
  _layoutCache = { commits: allCommits, positions, svgWidth };

  // Append only new rows with fade-in
  const frag = document.createDocumentFragment();
  for (const c of newCommits) {
    const refs = c.refs.length > 0 ? `<span class="gg-refs">${c.refs.map(refBadge).join('')}</span>` : '';
    const coAuthors = parseCoAuthors(c.body);
    const coAuthorHtml = coAuthorBadge(coAuthors);
    const div = document.createElement('div');
    div.className = 'gg-row gg-row-new';
    div.dataset.hash = c.hash;
    div.style.height = ROW_H + 'px';
    div.innerHTML =
      `<span class="gg-msg">${refs}${escHtml(c.message)}</span>` +
      `<span class="gg-author">${escHtml(c.author)}${coAuthorHtml}</span>` +
      `<span class="gg-hash" data-hash="${escHtml(c.hash)}">${escHtml(c.hash.slice(0, 7))}</span>` +
      `<span class="gg-time">${isWithinOneHour(c.date) ? relTime(c.date) + ' ago' : absTime(c.date)}</span>`;
    frag.appendChild(div);
  }
  commitBox.appendChild(frag);

  renderSvg(allCommits, positions, svgWidth);
}

// ─── COMMIT SELECT (no toggle, for keyboard nav) ────
function selectCommit(hash) {
  if (selectedHash === hash) return;
  selectedHash = hash;
  commitBox.querySelectorAll('.gg-row').forEach((r) => {
    r.classList.toggle('selected', r.dataset.hash === hash);
  });
  const commit = cachedCommits.find((c) => c.hash === hash);
  insertDetailRow(hash, commit);
  wsSend({ type: 'git_file_list', sessionId: S.activeSessionId, hash });
}

// ─── COMMIT CLICK ────────────────────────────────────
function onCommitClick(hash) {
  if (selectedHash === hash) {
    selectedHash = null;
    closeDetailRow();
    commitBox.querySelectorAll('.gg-row').forEach((r) => r.classList.remove('selected'));
    return;
  }
  selectedHash = hash;
  commitBox.querySelectorAll('.gg-row').forEach((r) => {
    r.classList.toggle('selected', r.dataset.hash === hash);
  });
  const commit = cachedCommits.find((c) => c.hash === hash);
  insertDetailRow(hash, commit);
  wsSend({ type: 'git_file_list', sessionId: S.activeSessionId, hash });
}

// ─── SEARCH ───────────────────────────────────────────
function openSearch() {
  searchActive = true;
  searchBar.style.display = 'block';
  searchToggle.classList.add('active');
  searchInput.value = '';
  searchQuery = '';
  searchInput.focus();
}

function closeSearch() {
  searchActive = false;
  searchBar.style.display = 'none';
  searchToggle.classList.remove('active');
  searchInput.value = '';
  searchQuery = '';
  searchEmpty.style.display = 'none';
  if (searchDebounce) {
    clearTimeout(searchDebounce);
    searchDebounce = null;
  }
  // Restore full commit list
  renderGraph(cachedCommits);
  modal.focus();
}

function doSearch(query) {
  searchQuery = query;
  if (!query) {
    renderGraph(cachedCommits);
    searchEmpty.style.display = 'none';
    return;
  }

  const q = query.toLowerCase();
  // Client-side filter first
  const clientResults = cachedCommits.filter(
    (c) =>
      c.message.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.hash.toLowerCase().startsWith(q)
  );

  if (clientResults.length >= 10) {
    renderSearchResults(clientResults, query);
  } else {
    // Show client results immediately (or clear graph), then request server
    if (clientResults.length > 0) {
      renderSearchResults(clientResults, query);
    } else {
      svgEl.innerHTML = '';
      svgEl.setAttribute('height', 0);
      commitBox.innerHTML = '';
    }
    wsSend({ type: 'git_graph_search', sessionId: S.activeSessionId, query });
  }
}

function renderSearchResults(commits, query) {
  if (commits.length === 0) {
    searchEmpty.textContent = "No commits matching '" + query + "'";
    searchEmpty.style.display = 'flex';
    svgEl.innerHTML = '';
    svgEl.setAttribute('height', 0);
    commitBox.innerHTML = '';
    return;
  }
  searchEmpty.style.display = 'none';
  renderGraph(commits);
  // Highlight matching text
  highlightMatches(query);
}

function highlightMatches(query) {
  if (!query) return;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(' + escaped + ')', 'gi');
  commitBox.querySelectorAll('.gg-msg').forEach((el) => {
    // Only highlight text nodes, preserve ref badges
    const refs = el.querySelector('.gg-refs');
    const refsHtml = refs ? refs.outerHTML : '';
    const textOnly = el.textContent.replace(refs?.textContent || '', '');
    const highlighted = escHtml(textOnly).replace(regex, '<span class="gg-highlight">$1</span>');
    el.innerHTML = refsHtml + highlighted;
  });
  commitBox.querySelectorAll('.gg-author').forEach((el) => {
    // Preserve co-author badges
    const imgs = el.querySelectorAll('.gg-coauthor-img, .gg-coauthor-initial');
    const authorText = el.childNodes[0]?.textContent || '';
    const highlighted = escHtml(authorText).replace(regex, '<span class="gg-highlight">$1</span>');
    el.innerHTML = highlighted;
    imgs.forEach((img) => el.appendChild(img));
  });
}

// ─── EVENT LISTENERS ─────────────────────────────────
document.getElementById('gg-close').addEventListener('click', closeGitGraph);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeGitGraph();
});

commitBox.addEventListener('click', (e) => {
  // Hash click → copy to clipboard
  const hashEl = e.target.closest('.gg-hash');
  if (hashEl) {
    e.stopPropagation();
    const fullHash = hashEl.dataset.hash;
    navigator.clipboard.writeText(fullHash).then(() => {
      hashEl.classList.add('gg-hash-copied');
      const orig = hashEl.textContent;
      hashEl.textContent = 'Copied!';
      setTimeout(() => {
        hashEl.textContent = orig;
        hashEl.classList.remove('gg-hash-copied');
      }, 1200);
    });
    return;
  }

  // Branch/remote ref badge click → checkout
  const refBadgeEl = e.target.closest('[data-checkout-branch]');
  if (refBadgeEl) {
    e.stopPropagation();
    showCheckoutConfirm(refBadgeEl.dataset.checkoutBranch);
    return;
  }

  // Normal row click → show files
  const row = e.target.closest('.gg-row');
  if (row) onCommitClick(row.dataset.hash);
});

// Context menu on commit rows
commitBox.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.gg-row[data-hash]');
  if (!row) return;
  e.preventDefault();
  const hash = row.dataset.hash;
  const commit = cachedCommits.find((c) => c.hash === hash);
  showCtxMenu(e.clientX, e.clientY, hash, commit);
});

sbBranch.addEventListener('click', () => openGitGraph());

// Branch dropdown
branchTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  branchMenu.classList.toggle('open');
});

branchMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.gg-branch-item');
  if (!item) return;
  branchMenu.classList.remove('open');
  const branch = item.dataset.branch;
  if (branch && !item.classList.contains('current')) {
    showCheckoutConfirm(branch);
  }
});

// GitHub button
githubBtn.addEventListener('click', () => {
  if (githubBaseUrl) window.open(githubBaseUrl, '_blank');
});

// Pull & Push buttons
pullBtn.addEventListener('click', doPull);
pushBtn.addEventListener('click', doPush);

// Confirm dialog
confirmOk.addEventListener('click', doCheckout);
confirmCancel.addEventListener('click', hideCheckoutConfirm);

// Search toggle
searchToggle.addEventListener('click', () => {
  if (searchActive) closeSearch();
  else openSearch();
});

// Search input
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => doSearch(q), 300);
});

// Cmd/Ctrl+F to toggle search
document.addEventListener('keydown', (e) => {
  if (!isOpen) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    if (searchActive) searchInput.focus();
    else openSearch();
  }
});

// ─── RESIZE ──────────────────────────────────────────
resizeHandle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = modal.offsetWidth;
  const startH = modal.offsetHeight;

  function onMove(ev) {
    const w = Math.max(480, startW + (ev.clientX - startX));
    const h = Math.max(320, startH + (ev.clientY - startY));
    modal.style.width = w + 'px';
    modal.style.height = h + 'px';
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    saveModalSize();
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

// ─── INFINITE SCROLL ──────────────────────────────────
const scrollEl = document.getElementById('gg-scroll');
scrollEl.addEventListener('scroll', () => {
  if (scrollRAF) return;
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = null;
    if (!isOpen || isLoadingMore || !hasMore || searchActive) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      isLoadingMore = true;
      loadMore.style.display = 'flex';
      wsSend({ type: 'git_graph', sessionId: S.activeSessionId, skip: currentSkip });
    }
  });
});
