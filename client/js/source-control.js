// ─── SOURCE CONTROL PANEL ────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';

let gitStatusFiles = [];
let gitBranch = '';
let gitRoot = '';
let isGitRepo = false;

export function initSourceControl() {
  // Set up refresh button
  const refreshBtn = document.getElementById('sc-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', requestGitStatus);
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

function renderSourceControl() {
  const container = document.getElementById('sc-file-list');
  const branchEl = document.getElementById('sc-branch-name');
  const emptyEl = document.getElementById('sc-empty');
  if (!container) return;

  if (branchEl) branchEl.textContent = gitBranch || '—';

  if (!isGitRepo) {
    container.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.textContent = 'Not a git repository';
    }
    return;
  }

  if (gitStatusFiles.length === 0) {
    container.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = '';
      emptyEl.textContent = 'No changes detected';
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  // Group: staged vs changes
  const staged = gitStatusFiles.filter(f => f.staged);
  const changes = gitStatusFiles.filter(f => !f.staged);

  container.innerHTML = '';

  if (staged.length > 0) {
    const section = createSection('STAGED CHANGES', staged.length, staged);
    container.appendChild(section);
  }

  if (changes.length > 0) {
    const section = createSection('CHANGES', changes.length, changes);
    container.appendChild(section);
  }
}

function createSection(title, count, files) {
  const section = document.createElement('div');
  section.className = 'sc-section';

  const header = document.createElement('div');
  header.className = 'sc-section-header';
  header.innerHTML = `<span class="sc-section-title">${title}</span>` +
    `<span class="sc-section-count">${count}</span>`;
  section.appendChild(header);

  const list = document.createElement('div');
  list.className = 'sc-section-list';

  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'sc-file-item';

    const statusClass = getStatusClass(file.status);
    const statusLabel = getStatusLabel(file.status);
    const fileName = file.path.split('/').pop();
    const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';

    item.innerHTML =
      `<span class="sc-file-name">${escHtml(fileName)}</span>` +
      (dirPath ? `<span class="sc-file-dir">${escHtml(dirPath)}</span>` : '') +
      `<span class="sc-file-status ${statusClass}">${statusLabel}</span>`;

    item.title = file.path;
    list.appendChild(item);
  }

  section.appendChild(list);
  return section;
}

function getStatusClass(status) {
  const map = {
    'M': 'sc-modified',
    'A': 'sc-added',
    'D': 'sc-deleted',
    'R': 'sc-renamed',
    'C': 'sc-copied',
    'U': 'sc-untracked',
    '?': 'sc-untracked',
  };
  return map[status] || 'sc-modified';
}

function getStatusLabel(status) {
  const map = {
    'M': 'M',
    'A': 'A',
    'D': 'D',
    'R': 'R',
    'C': 'C',
    'U': 'U',
    '?': 'U',
  };
  return map[status] || status;
}

export function onSourceControlSessionChange() {
  requestGitStatus();
}
