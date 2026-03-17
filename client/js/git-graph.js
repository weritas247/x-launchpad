import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { BRANCH_COLORS } from './constants.js';

// ─── STATE ───────────────────────────────────────────
let isOpen = false;
let selectedHash = null;

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
const sbBranch  = document.getElementById('sb-branch');
const sbBrSep   = document.getElementById('sb-branch-sep');
const sbBrName  = document.getElementById('sb-branch-name');

// ─── OPEN / CLOSE ────────────────────────────────────
export function openGitGraph() {
  if (!S.activeSessionId) return;
  isOpen = true;
  selectedHash = null;
  overlay.classList.add('open');
  loading.style.display = 'flex';
  errorEl.style.display = 'none';
  content.style.display = 'none';
  filePanel.style.display = 'none';

  const meta = sessionMeta.get(S.activeSessionId);
  const cwd = meta?.cwd || '';
  repoName.textContent = cwd.split('/').pop() || 'repo';
  branchBdg.textContent = sbBrName.textContent || '...';

  wsSend({ type: 'git_graph', sessionId: S.activeSessionId });
}

export function closeGitGraph() {
  isOpen = false;
  overlay.classList.remove('open');
}

export function isGitGraphOpen() {
  return isOpen;
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
  content.style.display = 'flex';
  renderGraph(msg.commits);
}

export function handleGitFileListData(msg) {
  if (!msg.files || msg.files.length === 0) {
    filePanel.style.display = 'none';
    return;
  }
  filePanel.style.display = 'block';
  fileTitle.textContent = `Changed files (${msg.files.length})`;
  fileList.innerHTML = msg.files.map(f =>
    `<div class="gg-file-item"><span class="gg-file-status gg-file-status-${escHtml(f.status)}">${escHtml(f.status)}</span><span class="gg-file-path">${escHtml(f.path)}</span></div>`
  ).join('');
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

// ─── REF BADGE HTML ──────────────────────────────────
function refBadge(ref) {
  const r = ref.trim();
  if (r.startsWith('HEAD -> ')) {
    const br = r.slice(8);
    return `<span class="gg-ref gg-ref-head">${escHtml(br)}</span>`;
  }
  if (r.startsWith('tag: ')) {
    return `<span class="gg-ref gg-ref-tag">${escHtml(r.slice(5))}</span>`;
  }
  if (r.includes('/')) {
    return `<span class="gg-ref gg-ref-remote">${escHtml(r)}</span>`;
  }
  return `<span class="gg-ref gg-ref-branch">${escHtml(r)}</span>`;
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
  commitBox.innerHTML = commits.map((c, i) => {
    const refs = c.refs.length > 0 ? `<span class="gg-refs">${c.refs.map(refBadge).join('')}</span>` : '';
    return `<div class="gg-row" data-hash="${escHtml(c.hash)}" style="height:${ROW_H}px">` +
      `<span class="gg-hash">${escHtml(c.hash.slice(0,7))}</span>` +
      refs +
      `<span class="gg-msg">${escHtml(c.message)}</span>` +
      `<span class="gg-author">${escHtml(c.author)}</span>` +
      `<span class="gg-time">${relTime(c.date)}</span>` +
      `</div>`;
  }).join('');
}

// ─── COMMIT CLICK ────────────────────────────────────
function onCommitClick(hash) {
  if (selectedHash === hash) {
    selectedHash = null;
    filePanel.style.display = 'none';
    commitBox.querySelectorAll('.gg-row').forEach(r => r.classList.remove('selected'));
    return;
  }
  selectedHash = hash;
  commitBox.querySelectorAll('.gg-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.hash === hash);
  });
  fileList.innerHTML = '<div class="gg-file-item" style="color:var(--text-dim)">Loading...</div>';
  filePanel.style.display = 'block';
  wsSend({ type: 'git_file_list', sessionId: S.activeSessionId, hash });
}

// ─── EVENT LISTENERS ─────────────────────────────────
document.getElementById('gg-close').addEventListener('click', closeGitGraph);
overlay.addEventListener('click', e => { if (e.target === overlay) closeGitGraph(); });
document.getElementById('gg-file-close').addEventListener('click', () => { filePanel.style.display = 'none'; });
commitBox.addEventListener('click', e => {
  const row = e.target.closest('.gg-row');
  if (row) onCommitClick(row.dataset.hash);
});
sbBranch.addEventListener('click', () => openGitGraph());
