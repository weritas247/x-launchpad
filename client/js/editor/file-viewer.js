// ─── FILE VIEWER: opens files from explorer as tabs in main view ───
import { S, terminalMap, tabBar, tabAddBtn, termWrapper, escHtml } from '../core/state.js';
import { wsSend } from '../core/websocket.js';
import { registerAction } from '../core/keyboard.js';

// Map<filePath, { tabEl, paneEl, contentEl, headerEl, editorView, filePath, originalContent, isEditing }>
const fileTabs = new Map();
let activeFilePath = null;
let previewFilePath = null; // single preview tab (replaced on next click)

export function openFileTab(filePath, content, opts = {}) {
  const isBinary = opts.binary;
  const isImage = opts.isImage;
  const imageData = opts.imageData;
  const imageMime = opts.imageMime;
  const error = opts.error;

  // If there's a preview tab and it's a different file, replace it
  if (previewFilePath && previewFilePath !== filePath && fileTabs.has(previewFilePath)) {
    closeFileTab(previewFilePath);
  }

  if (fileTabs.has(filePath)) {
    // Already open — just activate and update content
    activateFileTab(filePath);
    updateFileContent(filePath, content, {
      binary: isBinary,
      isImage,
      imageData,
      imageMime,
      error,
    });
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
    <span class="tab-unsaved-dot" style="display:none">●</span>
    <button class="tab-close-btn">✕</button>
  `;
  tabEl.title = filePath;

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close-btn')) {
      closeFileTab(filePath);
      return;
    }
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

  // Header bar with edit controls
  const headerEl = document.createElement('div');
  headerEl.className = 'file-pane-header';
  const pathParts = filePath.split('/');
  const shortPath = pathParts.length > 3 ? '…/' + pathParts.slice(-3).join('/') : filePath;
  headerEl.innerHTML = `
    <span class="file-pane-path">${escHtml(shortPath)}</span>
    <div class="file-pane-actions">
      <span class="file-pane-status">READ ONLY</span>
      <button class="file-pane-edit-btn">Edit</button>
    </div>
  `;
  paneEl.appendChild(headerEl);

  // Content area
  const contentEl = document.createElement('div');
  contentEl.className = 'file-pane-content';
  paneEl.appendChild(contentEl);

  termWrapper.appendChild(paneEl);

  const entry = {
    tabEl,
    paneEl,
    contentEl,
    headerEl,
    editorView: null,
    filePath,
    originalContent: null,
    isEditing: false,
  };
  fileTabs.set(filePath, entry);
  previewFilePath = filePath;

  // Wire up Edit button
  const editBtn = headerEl.querySelector('.file-pane-edit-btn');
  editBtn.addEventListener('click', () => {
    enterEditMode(filePath);
  });

  // Escape key exits edit mode
  paneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && entry.isEditing) {
      exitEditMode(filePath);
    }
  });

  updateFileContent(filePath, content, { binary: isBinary, isImage, imageData, imageMime, error });
  activateFileTab(filePath);
}

function updateFileContent(filePath, content, opts = {}) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;

  const { contentEl } = entry;

  // Destroy any existing editor before replacing content
  if (entry.editorView) {
    window.FileEditor.destroyEditor(entry.editorView);
    entry.editorView = null;
  }

  if (opts.error) {
    contentEl.innerHTML = `<div class="file-pane-error">${escHtml(opts.error)}</div>`;
    return;
  }

  // Image preview
  if (opts.isImage && opts.imageData && opts.imageMime) {
    const dataUrl = `data:${opts.imageMime};base64,${opts.imageData}`;
    contentEl.innerHTML = `<div class="file-pane-image">
      <img src="${dataUrl}" alt="${escHtml(filePath.split('/').pop())}" />
      <div class="file-pane-image-info">${escHtml(filePath.split('/').pop())}</div>
    </div>`;
    // Hide edit button for images
    const editBtn = entry.headerEl.querySelector('.file-pane-edit-btn');
    if (editBtn) editBtn.style.display = 'none';
    return;
  }

  if (opts.binary) {
    contentEl.innerHTML = '<div class="file-pane-error">Binary file — cannot preview</div>';
    // Hide edit button for binary
    const editBtn = entry.headerEl.querySelector('.file-pane-edit-btn');
    if (editBtn) editBtn.style.display = 'none';
    return;
  }

  const text = content || '';

  // Clear the content element for CodeMirror
  contentEl.innerHTML = '';

  const onSave = (saveContent) => {
    wsSend({ type: 'file_save', sessionId: S.activeSessionId, filePath, content: saveContent });
  };

  const onChange = (newContent) => {
    const currentEntry = fileTabs.get(filePath);
    if (!currentEntry) return;
    const isDirty = newContent !== currentEntry.originalContent;
    const dot = currentEntry.tabEl.querySelector('.tab-unsaved-dot');
    if (isDirty) {
      currentEntry.tabEl.classList.add('unsaved');
      if (dot) dot.style.display = '';
    } else {
      currentEntry.tabEl.classList.remove('unsaved');
      if (dot) dot.style.display = 'none';
    }
  };

  // Create CodeMirror editor (read-only by default)
  const editorView = window.FileEditor.createEditor(contentEl, text, filePath, {
    readOnly: true,
    onSave,
    onChange,
  });

  entry.editorView = editorView;
  entry.originalContent = text;
  entry.isEditing = false;

  // Reset header to read-only state
  renderReadonlyHeader(entry);
}

function renderReadonlyHeader(entry) {
  const actionsEl = entry.headerEl.querySelector('.file-pane-actions');
  if (!actionsEl) return;
  actionsEl.innerHTML = `
    <span class="file-pane-status">READ ONLY</span>
    <button class="file-pane-edit-btn">Edit</button>
  `;
  actionsEl.querySelector('.file-pane-edit-btn').addEventListener('click', () => {
    enterEditMode(entry.filePath);
  });
}

function renderEditingHeader(entry) {
  const actionsEl = entry.headerEl.querySelector('.file-pane-actions');
  if (!actionsEl) return;
  actionsEl.innerHTML = `
    <span class="file-pane-status editing">EDITING</span>
    <span class="file-pane-save-hint">Ctrl+S to save</span>
    <button class="file-pane-save-btn">Save</button>
    <button class="file-pane-cancel-btn">Cancel</button>
  `;
  actionsEl.querySelector('.file-pane-save-btn').addEventListener('click', () => {
    if (entry.editorView) {
      const currentContent = window.FileEditor.getContent(entry.editorView);
      wsSend({ type: 'file_save', sessionId: S.activeSessionId, filePath: entry.filePath, content: currentContent });
    }
  });
  actionsEl.querySelector('.file-pane-cancel-btn').addEventListener('click', () => {
    exitEditMode(entry.filePath);
  });
}

function enterEditMode(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry || !entry.editorView) return;
  window.FileEditor.setReadOnly(entry.editorView, false);
  entry.isEditing = true;
  renderEditingHeader(entry);
  entry.editorView.focus();
}

function exitEditMode(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry || !entry.editorView) return;

  // Restore original content if changed
  const currentContent = window.FileEditor.getContent(entry.editorView);
  if (currentContent !== entry.originalContent) {
    // Use the view's dispatch to replace all content
    const view = entry.editorView;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: entry.originalContent },
    });
  }

  window.FileEditor.setReadOnly(entry.editorView, true);
  entry.isEditing = false;
  renderReadonlyHeader(entry);

  // Clear unsaved indicator since we restored content
  entry.tabEl.classList.remove('unsaved');
  const dot = entry.tabEl.querySelector('.tab-unsaved-dot');
  if (dot) dot.style.display = 'none';
}

export function activateFileTab(filePath) {
  if (!fileTabs.has(filePath)) return;

  activeFilePath = filePath;

  // Deactivate all terminal tabs/panes
  terminalMap.forEach(({ div, tabEl }) => {
    div.classList.remove('active');
    tabEl.classList.remove('active');
  });

  // Deactivate all file tabs/panes, activate target
  fileTabs.forEach(({ tabEl, paneEl }, fp) => {
    const isActive = fp === filePath;
    tabEl.classList.toggle('active', isActive);
    paneEl.classList.toggle('active', isActive);
  });
}

export function closeFileTab(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;

  // Confirm if unsaved changes exist
  if (entry.isEditing && entry.editorView) {
    const current = window.FileEditor.getContent(entry.editorView);
    if (current !== entry.originalContent) {
      if (!confirm('Unsaved changes. Close anyway?')) return;
    }
  }

  // Destroy CodeMirror editor if present
  if (entry.editorView) {
    window.FileEditor.destroyEditor(entry.editorView);
    entry.editorView = null;
  }

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

function showHeaderMessage(entry, message, type) {
  const existing = entry.headerEl.querySelector('.file-pane-message');
  if (existing) existing.remove();
  const el = document.createElement('span');
  el.className = `file-pane-message file-pane-message-${type}`;
  el.textContent = message;
  const actions = entry.headerEl.querySelector('.file-pane-actions');
  if (actions) actions.prepend(el);
  setTimeout(() => el.remove(), 3000);
}

export function handleFileSaveResult(filePath, success, error) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;
  if (success) {
    if (entry.editorView) {
      entry.originalContent = window.FileEditor.getContent(entry.editorView);
    }
    entry.tabEl.classList.remove('unsaved');
    const dot = entry.tabEl.querySelector('.tab-unsaved-dot');
    if (dot) dot.style.display = 'none';
    showHeaderMessage(entry, 'Saved', 'success');
  } else {
    showHeaderMessage(entry, `Save failed: ${error}`, 'error');
  }
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap = {
    js: '📜',
    ts: '📘',
    jsx: '⚛',
    tsx: '⚛',
    json: '{}',
    md: '📝',
    css: '🎨',
    html: '🌐',
    py: '🐍',
    rs: '🦀',
    go: '🐹',
    rb: '💎',
    sh: '$_',
    yml: '⚙',
    yaml: '⚙',
    toml: '⚙',
    png: '🖼',
    jpg: '🖼',
    gif: '🖼',
    svg: '🖼',
    webp: '🖼',
    lock: '🔒',
  };
  return iconMap[ext] || '📄';
}

// Register the toggleFileEdit action (keybinding assigned in main.js)
registerAction('toggleFileEdit', () => {
  const entry = fileTabs.get(activeFilePath);
  if (!entry || !entry.editorView) return;
  if (entry.isEditing) exitEditMode(activeFilePath);
  else enterEditMode(activeFilePath);
});

// Lazy import to avoid circular dependency
let _activateSession = null;
export function setActivateSessionFn(fn) {
  _activateSession = fn;
}
