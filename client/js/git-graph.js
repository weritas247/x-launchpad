import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { BRANCH_COLORS } from './constants.js';

// ─── STATE ───────────────────────────────────────────
let isOpen = false;
let selectedHash = null;
let cachedCommits = [];
let githubBaseUrl = null;
let pendingCheckoutBranch = null;
let dropdownAbort = null;
let focusedRowIdx = -1;

// ─── DOM REFS ────────────────────────────────────────
const overlay   = document.getElementById('git-graph-overlay');
const repoName  = document.getElementById('gg-repo-name');
const branchBdg = document.getElementById('gg-branch-badge');
const loading   = document.getElementById('gg-loading');
const errorEl   = document.getElementById('gg-error');
const content   = document.getElementById('gg-content');
const svgEl     = document.getElementById('gg-svg');
const commitBox = document.getElementById('gg-commits');
const filePanel = document.getElementById('gg-file-panel');
const fileList  = document.getElementById('gg-file-list');
const fileTitle = document.getElementById('gg-file-title');
const commitBody = document.getElementById('gg-commit-body');
const sbBranch  = document.getElementById('sb-branch');
const sbBrSep   = document.getElementById('sb-branch-sep');
const sbBrName  = document.getElementById('sb-branch-name');

// Branch dropdown
const branchDropdown = document.getElementById('gg-branch-dropdown');
const branchTrigger  = document.getElementById('gg-branch-trigger');
const branchMenu     = document.getElementById('gg-branch-menu');

// GitHub button & Pull button
const githubBtn = document.getElementById('gg-github-btn');
const pullBtn   = document.getElementById('gg-pull-btn');

// Confirm dialog
const confirmEl      = document.getElementById('gg-confirm');
const confirmMessage = document.getElementById('gg-confirm-message');
const confirmOk      = document.getElementById('gg-confirm-ok');
const confirmCancel  = document.getElementById('gg-confirm-cancel');

// Modal + resize
const modal       = document.getElementById('git-graph-modal');
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      w: modal.offsetWidth,
      h: modal.offsetHeight,
    }));
  } catch {}
}

// ─── OPEN / CLOSE ────────────────────────────────────
export function openGitGraph() {
  if (!S.activeSessionId) return;
  isOpen = true;
  selectedHash = null;
  cachedCommits = [];
  githubBaseUrl = null;
  focusedRowIdx = -1;
  restoreModalSize();
  overlay.classList.add('open');
  loading.style.display = 'flex';
  errorEl.style.display = 'none';
  content.style.display = 'none';
  filePanel.style.display = 'none';
  commitBody.style.display = 'none';
  confirmEl.style.display = 'none';
  githubBtn.style.display = 'none';
  branchMenu.classList.remove('open');

  const meta = sessionMeta.get(S.activeSessionId);
  const cwd = meta?.cwd || '';
  repoName.textContent = cwd.split('/').pop() || 'repo';
  branchBdg.textContent = sbBrName.textContent || '...';

  wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
  wsSend({ type: 'git_branch_list', sessionId: S.activeSessionId });
  wsSend({ type: 'git_remote_url', sessionId: S.activeSessionId });

  // Blur terminal so keydown events reach document listener
  if (document.activeElement) document.activeElement.blur();
  modal.focus();

  // Close dropdown on outside click
  if (dropdownAbort) dropdownAbort.abort();
  dropdownAbort = new AbortController();
  document.addEventListener('click', e => {
    if (!branchDropdown.contains(e.target)) {
      branchMenu.classList.remove('open');
    }
  }, { signal: dropdownAbort.signal });
}

export function closeGitGraph() {
  isOpen = false;
  overlay.classList.remove('open');
  branchMenu.classList.remove('open');
  if (dropdownAbort) { dropdownAbort.abort(); dropdownAbort = null; }
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

  // Escape — always close modal
  if (e.key === 'Escape') {
    e.preventDefault();
    closeGitGraph();
    return true;
  }

  // Confirm dialog is open — Enter confirms
  if (confirmEl.style.display === 'flex') {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doCheckout(); return true; }
    return false;
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
  if (msg.error || !msg.commits || msg.commits.length === 0) {
    errorEl.style.display = 'flex';
    errorEl.textContent = msg.error ? 'Not a git repository' : 'No commits found';
    content.style.display = 'none';
    return;
  }
  cachedCommits = msg.commits;
  content.style.display = 'flex';
  renderGraph(msg.commits);
}

export function handleGitFileListData(msg) {
  const commit = cachedCommits.find(c => c.hash === msg.hash);

  filePanel.style.display = 'block';

  if (commit?.body) {
    commitBody.style.display = 'block';
    commitBody.textContent = commit.body;
  } else {
    commitBody.style.display = 'none';
  }

  if (!msg.files || msg.files.length === 0) {
    fileTitle.textContent = commit?.body ? 'Commit message' : 'Details';
    fileList.innerHTML = '<div class="gg-file-item" style="color:var(--text-ghost)">No changed files</div>';
    return;
  }

  fileTitle.textContent = `Changed files (${msg.files.length})`;
  fileList.innerHTML = msg.files.map(f => {
    const stat = fileStatBadge(f.additions, f.deletions);
    return `<div class="gg-file-item"><span class="gg-file-status gg-file-status-${escHtml(f.status)}">${escHtml(f.status)}</span><span class="gg-file-path">${escHtml(f.path)}</span>${stat}</div>`;
  }).join('');
}

export function handleGitBranchData(msg) {
  if (msg.branch) {
    sbBranch.style.display = '';
    sbBrSep.style.display = '';
    sbBrName.textContent = msg.branch;
  } else {
    sbBranch.style.display = 'none';
    sbBrSep.style.display = 'none';
    sbBrName.textContent = '';
  }
}

export function handleGitBranchListData(msg) {
  if (!msg.branches || msg.branches.length === 0) return;

  const local = msg.branches.filter(b => !b.isRemote);
  const remote = msg.branches.filter(b => b.isRemote);

  let html = '';
  if (local.length > 0) {
    html += '<div class="gg-branch-menu-label">LOCAL</div>';
    html += local.map(b =>
      `<div class="gg-branch-item${b.isCurrent ? ' current' : ''}" data-branch="${escHtml(b.name)}">${escHtml(b.name)}</div>`
    ).join('');
  }
  if (remote.length > 0) {
    html += '<div class="gg-branch-menu-label">REMOTE</div>';
    html += remote.map(b =>
      `<div class="gg-branch-item gg-branch-item-remote" data-branch="${escHtml(b.name)}">${escHtml(b.name)}</div>`
    ).join('');
  }
  branchMenu.innerHTML = html;
}

export function handleGitRemoteUrlData(msg) {
  githubBaseUrl = parseGithubUrl(msg.url);
  githubBtn.style.display = githubBaseUrl ? '' : 'none';
}

export function handleGitCheckoutAck(msg) {
  confirmEl.style.display = 'none';
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
  if (pullTimer) { clearTimeout(pullTimer); pullTimer = null; }
}

function doPull() {
  if (!S.activeSessionId || pullBtn.classList.contains('pulling')) return;
  resetPullBtn();
  pullBtn.classList.add('pulling');
  pullBtn.textContent = '⬇ Pulling...';
  wsSend({ type: 'git_pull', sessionId: S.activeSessionId });
  // Fallback: auto-complete after 5s even without ack
  pullTimer = setTimeout(() => {
    if (pullBtn.classList.contains('pulling')) {
      finishPull(false);
    }
  }, 5000);
}

function finishPull(isError) {
  if (pullTimer) { clearTimeout(pullTimer); pullTimer = null; }
  pullBtn.classList.remove('pulling');
  if (isError) {
    pullBtn.classList.add('pull-err');
    pullBtn.textContent = '⬇ Failed';
  } else {
    pullBtn.classList.add('pull-ok');
    pullBtn.textContent = '⬇ Done';
    if (isOpen && S.activeSessionId) {
      setTimeout(() => {
        wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
        wsSend({ type: 'git_branch_list', sessionId: S.activeSessionId });
      }, 1500);
    }
  }
  setTimeout(resetPullBtn, 3000);
}

export function handleGitPullAck(msg) {
  finishPull(!!msg.error);
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
  if (diff < 3600) return `${Math.floor(diff/60)}m`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d`;
  return `${Math.floor(diff/604800)}w`;
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

function coAuthorBadge(coAuthors) {
  if (!coAuthors.length) return '';
  return coAuthors.map(a =>
    `<span class="gg-coauthor" title="${escHtml(a.name)} &lt;${escHtml(a.email)}&gt;">${escHtml(a.name)}</span>`
  ).join('');
}

// ─── STAT BADGE ──────────────────────────────────────
function statBadge(add, del) {
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
function computeLayout(commits) {
  const ROW_H = 40;
  const COL_W = 16;
  const PAD_X = 12;
  const PAD_Y = ROW_H / 2;

  // Pass 1: assign lanes
  const lanes = [];  // active lane slots: each holds expected commit hash
  const positions = new Map(); // hash -> { x, y, col, color }
  const edges = []; // { x1, y1, x2, y2, color }

  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    let col = lanes.indexOf(c.hash);
    if (col === -1) {
      // New lane — find first empty or append
      col = lanes.indexOf(null);
      if (col === -1) { col = lanes.length; lanes.push(null); }
    }
    lanes[col] = null; // free the slot

    const x = PAD_X + col * COL_W;
    const y = PAD_Y + i * ROW_H;
    const color = BRANCH_COLORS[col % BRANCH_COLORS.length];
    positions.set(c.hash, { x, y, col, color });

    // Place parents in lanes
    for (let pi = 0; pi < c.parents.length; pi++) {
      const ph = c.parents[pi];
      if (positions.has(ph)) continue; // already placed (shouldn't happen in topo order)
      if (pi === 0) {
        // First parent: same lane
        lanes[col] = ph;
      } else {
        // Merge parent: find existing lane or assign new
        let pcol = lanes.indexOf(ph);
        if (pcol === -1) {
          pcol = lanes.indexOf(null);
          if (pcol === -1) { pcol = lanes.length; lanes.push(null); }
          lanes[pcol] = ph;
        }
      }
    }

    // Compact: trim trailing nulls
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
  }

  // Pass 2: edges
  for (const c of commits) {
    const pos = positions.get(c.hash);
    if (!pos) continue;
    for (const ph of c.parents) {
      const ppos = positions.get(ph);
      if (!ppos) continue;
      edges.push({ x1: pos.x, y1: pos.y, x2: ppos.x, y2: ppos.y, color: ppos.color });
    }
  }

  const maxCol = Math.max(...Array.from(positions.values()).map(p => p.col), 0);
  const svgWidth = PAD_X * 2 + maxCol * COL_W + 8;
  const svgHeight = PAD_Y + commits.length * ROW_H;

  return { positions, edges, svgWidth, svgHeight, ROW_H };
}

// ─── RENDER ──────────────────────────────────────────
function renderGraph(commits) {
  const { positions, edges, svgWidth, svgHeight, ROW_H } = computeLayout(commits);

  // SVG
  svgEl.setAttribute('width', svgWidth);
  svgEl.setAttribute('height', svgHeight);
  svgEl.style.width = svgWidth + 'px';
  svgEl.style.minWidth = svgWidth + 'px';

  let svg = '';

  // Edges
  for (const e of edges) {
    if (e.x1 === e.x2) {
      svg += `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" stroke="${e.color}" stroke-width="2" />`;
    } else {
      const my = (e.y1 + e.y2) / 2;
      svg += `<path d="M${e.x1},${e.y1} C${e.x1},${my} ${e.x2},${my} ${e.x2},${e.y2}" stroke="${e.color}" stroke-width="2" fill="none" />`;
    }
  }

  // Nodes
  for (const c of commits) {
    const p = positions.get(c.hash);
    if (!p) continue;
    svg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.color}" stroke="var(--bg-panel)" stroke-width="2" />`;
  }

  svgEl.innerHTML = svg;

  // Commit rows
  const hasGithub = !!githubBaseUrl;
  commitBox.innerHTML = commits.map((c, i) => {
    const refs = c.refs.length > 0 ? `<span class="gg-refs">${c.refs.map(refBadge).join('')}</span>` : '';
    const hashClass = hasGithub ? 'gg-hash gg-hash-link' : 'gg-hash';
    const coAuthors = parseCoAuthors(c.body);
    const coAuthorHtml = coAuthorBadge(coAuthors);
    return `<div class="gg-row" data-hash="${escHtml(c.hash)}" style="height:${ROW_H}px">` +
      `<span class="${hashClass}" data-hash="${escHtml(c.hash)}">${escHtml(c.hash.slice(0,7))}</span>` +
      refs +
      `<span class="gg-msg">${escHtml(c.message)}</span>` +
      `<span class="gg-stat">${statBadge(c.additions, c.deletions)}</span>` +
      `<span class="gg-author">${escHtml(c.author)}${coAuthorHtml}</span>` +
      `<span class="gg-time">${relTime(c.date)}</span>` +
      `</div>`;
  }).join('');
}

// ─── COMMIT SELECT (no toggle, for keyboard nav) ────
function selectCommit(hash) {
  if (selectedHash === hash) return;
  selectedHash = hash;
  commitBox.querySelectorAll('.gg-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.hash === hash);
  });
  const commit = cachedCommits.find(c => c.hash === hash);
  if (commit?.body) {
    commitBody.style.display = 'block';
    commitBody.textContent = commit.body;
  } else {
    commitBody.style.display = 'none';
  }
  fileList.innerHTML = '<div class="gg-file-item" style="color:var(--text-dim)">Loading...</div>';
  filePanel.style.display = 'block';
  wsSend({ type: 'git_file_list', sessionId: S.activeSessionId, hash });
}

// ─── COMMIT CLICK ────────────────────────────────────
function onCommitClick(hash) {
  if (selectedHash === hash) {
    selectedHash = null;
    filePanel.style.display = 'none';
    commitBody.style.display = 'none';
    commitBox.querySelectorAll('.gg-row').forEach(r => r.classList.remove('selected'));
    return;
  }
  selectedHash = hash;
  commitBox.querySelectorAll('.gg-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.hash === hash);
  });

  // Show body immediately if available
  const commit = cachedCommits.find(c => c.hash === hash);
  if (commit?.body) {
    commitBody.style.display = 'block';
    commitBody.textContent = commit.body;
  } else {
    commitBody.style.display = 'none';
  }

  fileList.innerHTML = '<div class="gg-file-item" style="color:var(--text-dim)">Loading...</div>';
  filePanel.style.display = 'block';
  wsSend({ type: 'git_file_list', sessionId: S.activeSessionId, hash });
}

// ─── EVENT LISTENERS ─────────────────────────────────
document.getElementById('gg-close').addEventListener('click', closeGitGraph);
overlay.addEventListener('click', e => { if (e.target === overlay) closeGitGraph(); });
document.getElementById('gg-file-close').addEventListener('click', () => {
  filePanel.style.display = 'none';
  commitBody.style.display = 'none';
});

commitBox.addEventListener('click', e => {
  // GitHub hash link click
  const hashLink = e.target.closest('.gg-hash-link');
  if (hashLink && githubBaseUrl) {
    e.stopPropagation();
    window.open(`${githubBaseUrl}/commit/${hashLink.dataset.hash}`, '_blank');
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

sbBranch.addEventListener('click', () => openGitGraph());

// Branch dropdown
branchTrigger.addEventListener('click', e => {
  e.stopPropagation();
  branchMenu.classList.toggle('open');
});

branchMenu.addEventListener('click', e => {
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

// Pull button
pullBtn.addEventListener('click', doPull);

// Confirm dialog
confirmOk.addEventListener('click', doCheckout);
confirmCancel.addEventListener('click', hideCheckoutConfirm);

// ─── RESIZE ──────────────────────────────────────────
resizeHandle.addEventListener('mousedown', e => {
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
