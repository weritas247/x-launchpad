// ─── FILE VIEWER: opens files from explorer as tabs in main view ───
import { S, terminalMap, tabBar, tabAddBtn, termWrapper, sbActiveName, sbSize, escHtml } from './state.js';

// Map<filePath, { tabEl, paneEl }>
const fileTabs = new Map();
let activeFilePath = null;
let previewFilePath = null; // single preview tab (replaced on next click)

export function openFileTab(filePath, content, opts = {}) {
  const isBinary = opts.binary;
  const error = opts.error;

  // If there's a preview tab and it's a different file, replace it
  if (previewFilePath && previewFilePath !== filePath && fileTabs.has(previewFilePath)) {
    closeFileTab(previewFilePath);
  }

  if (fileTabs.has(filePath)) {
    // Already open — just activate and update content
    activateFileTab(filePath);
    updateFileContent(filePath, content, { binary: isBinary, error });
    return;
  }

  // Create tab
  const tabEl = document.createElement('div');
  tabEl.className = 'tab file-tab preview-tab';
  tabEl.dataset.filePath = filePath;
  const fileName = filePath.split('/').pop();
  tabEl.innerHTML = `
    <span class="tab-file-icon">${getFileIcon(fileName)}</span>
    <span class="tab-name">${escHtml(fileName)}</span>
    <button class="tab-close-btn">✕</button>
  `;
  tabEl.title = filePath;

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close-btn')) { closeFileTab(filePath); return; }
    activateFileTab(filePath);
  });

  // Double click → pin (no longer preview)
  tabEl.addEventListener('dblclick', () => {
    pinFileTab(filePath);
  });

  tabBar.insertBefore(tabEl, tabAddBtn);

  // Create pane
  const paneEl = document.createElement('div');
  paneEl.className = 'file-pane';
  paneEl.dataset.filePath = filePath;

  // Header bar
  const headerEl = document.createElement('div');
  headerEl.className = 'file-pane-header';
  const pathParts = filePath.split('/');
  const shortPath = pathParts.length > 3 ? '…/' + pathParts.slice(-3).join('/') : filePath;
  headerEl.innerHTML = `<span class="file-pane-path">${escHtml(shortPath)}</span>`;
  paneEl.appendChild(headerEl);

  // Content area
  const contentEl = document.createElement('div');
  contentEl.className = 'file-pane-content';
  paneEl.appendChild(contentEl);

  termWrapper.appendChild(paneEl);

  fileTabs.set(filePath, { tabEl, paneEl, contentEl });
  previewFilePath = filePath;

  updateFileContent(filePath, content, { binary: isBinary, error });
  activateFileTab(filePath);
}

function updateFileContent(filePath, content, opts = {}) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;

  const { contentEl } = entry;

  if (opts.error) {
    contentEl.innerHTML = `<div class="file-pane-error">${escHtml(opts.error)}</div>`;
    return;
  }

  if (opts.binary) {
    contentEl.innerHTML = '<div class="file-pane-error">Binary file — cannot preview</div>';
    return;
  }

  const text = content || '';
  const lines = text.split('\n');
  const gutterWidth = String(lines.length).length;

  contentEl.innerHTML = lines.map((line, i) =>
    `<div class="fl"><span class="fl-ln" style="min-width:${gutterWidth}ch">${i + 1}</span><span class="fl-code">${escHtml(line) || ' '}</span></div>`
  ).join('');
}

export function activateFileTab(filePath) {
  if (!fileTabs.has(filePath)) return;

  activeFilePath = filePath;

  // Deactivate all terminal tabs/panes
  terminalMap.forEach(({ div, tabEl, sidebarEl }) => {
    div.classList.remove('active');
    tabEl.classList.remove('active');
    sidebarEl.classList.remove('active');
  });

  // Deactivate all file tabs/panes, activate target
  fileTabs.forEach(({ tabEl, paneEl }, fp) => {
    const isActive = fp === filePath;
    tabEl.classList.toggle('active', isActive);
    paneEl.classList.toggle('active', isActive);
  });

  // Update status bar
  const fileName = filePath.split('/').pop();
  sbActiveName.textContent = fileName;
  sbSize.textContent = '';
}

export function closeFileTab(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;

  entry.tabEl.remove();
  entry.paneEl.remove();
  fileTabs.delete(filePath);

  if (previewFilePath === filePath) previewFilePath = null;

  // If this was the active file, switch to another tab
  if (activeFilePath === filePath) {
    activeFilePath = null;
    // Try to activate another file tab, or fall back to active session
    if (fileTabs.size > 0) {
      activateFileTab(fileTabs.keys().next().value);
    } else if (S.activeSessionId && terminalMap.has(S.activeSessionId)) {
      deactivateAllFileTabs();
      if (_activateSession) _activateSession(S.activeSessionId);
    }
  }
}

function pinFileTab(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;
  entry.tabEl.classList.remove('preview-tab');
  if (previewFilePath === filePath) previewFilePath = null;
}

export function deactivateAllFileTabs() {
  activeFilePath = null;
  fileTabs.forEach(({ tabEl, paneEl }) => {
    tabEl.classList.remove('active');
    paneEl.classList.remove('active');
  });
}

export function getActiveFilePath() {
  return activeFilePath;
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

// Lazy import to avoid circular dependency
let _activateSession = null;
export function setActivateSessionFn(fn) {
  _activateSession = fn;
}
