import { S, terminalMap } from './state.js';
import { wsSend } from './websocket.js';

// Per-session attached images: Map<sessionId, [{file, objectUrl, filename, fullPath, uploaded}]>
const attachments = new Map();

// ─── PASTE HANDLER ───────────────────────────────────────────────
function handlePaste(e, sessionId) {
  const items = e.clipboardData?.items;
  if (!items) return;
  let hasImage = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) { hasImage = true; addAttachment(file, sessionId); }
    }
  }
  if (hasImage) { e.preventDefault(); e.stopPropagation(); }
}

// ─── DRAG & DROP ─────────────────────────────────────────────────
function handleDragOver(e) {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  e.currentTarget.classList.add('image-drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('image-drag-over');
}

function handleDrop(e, sessionId) {
  e.currentTarget.classList.remove('image-drag-over');
  if (e.dataTransfer?.types.includes('text/split-tab') ||
      e.dataTransfer?.types.includes('text/tab-session')) return;
  if (!e.dataTransfer?.files.length) return;

  const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  for (const file of e.dataTransfer.files) {
    if (imageTypes.includes(file.type)) {
      e.preventDefault();
      e.stopPropagation();
      addAttachment(file, sessionId);
    }
  }
}

// ─── ATTACHMENT MANAGEMENT ───────────────────────────────────────
function addAttachment(file, sessionId) {
  if (!attachments.has(sessionId)) attachments.set(sessionId, []);
  const list = attachments.get(sessionId);
  const objectUrl = URL.createObjectURL(file);
  const item = { file, objectUrl, filename: null, fullPath: null, uploaded: false, error: false };
  list.push(item);
  renderPreview(sessionId);
  uploadAttachment(item, sessionId);
}

function removeAttachment(sessionId, idx) {
  const list = attachments.get(sessionId);
  if (!list || !list[idx]) return;
  const item = list[idx];
  URL.revokeObjectURL(item.objectUrl);
  if (item.fullPath) {
    fetch('/api/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: item.fullPath }),
    }).catch(() => {});
  }
  list.splice(idx, 1);
  if (list.length === 0) attachments.delete(sessionId);
  renderPreview(sessionId);
}

function clearAll(sessionId) {
  const list = attachments.get(sessionId);
  if (list) list.forEach(i => URL.revokeObjectURL(i.objectUrl));
  attachments.delete(sessionId);
  // Force remove bar + reset xterm
  const entry = terminalMap.get(sessionId);
  if (entry) {
    entry.div.querySelector('.img-attach-bar')?.remove();
    adjustXtermForBar(entry, 0);
    requestAnimationFrame(() => { entry.fitAddon.fit(); entry.term.scrollToBottom(); });
  }
}

async function uploadAttachment(item, sessionId) {
  try {
    const res = await fetch(
      `/api/upload-image?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(item.file.name || 'image.png')}`,
      { method: 'POST', headers: { 'Content-Type': item.file.type }, body: item.file }
    );
    const result = await res.json();
    if (result.ok) {
      item.filename = result.filename;
      item.fullPath = result.fullPath;
      item.uploaded = true;
    } else {
      item.error = true;
    }
  } catch {
    item.error = true;
  }
  renderPreview(sessionId);
}

// ─── CONFIRM: insert absolute paths into terminal ────────────────
function confirmAttachments(sessionId) {
  const paths = flushAttachments(sessionId);
  if (paths) {
    wsSend({ type: 'input', sessionId, data: paths });
  }
}

// Returns paths string and clears bar, or null if nothing pending
export function flushAttachments(sessionId) {
  const list = attachments.get(sessionId);
  if (!list || list.length === 0) return null;
  const paths = list.filter(i => i.uploaded && i.fullPath).map(i => i.fullPath);
  clearAll(sessionId);
  return paths.length > 0 ? paths.join(' ') : null;
}

export function hasPendingAttachments(sessionId) {
  const list = attachments.get(sessionId);
  return list && list.length > 0;
}

// ─── PREVIEW BAR ─────────────────────────────────────────────────
function renderPreview(sessionId) {
  const entry = terminalMap.get(sessionId);
  if (!entry) return;
  const div = entry.div;

  const hadBar = !!div.querySelector('.img-attach-bar');
  div.querySelector('.img-attach-bar')?.remove();

  const list = attachments.get(sessionId);
  if (!list || list.length === 0) {
    if (hadBar) {
      adjustXtermForBar(entry, 0);
      requestAnimationFrame(() => { entry.fitAddon.fit(); entry.term.scrollToBottom(); });
    }
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'img-attach-bar';

  list.forEach((item, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'img-attach-thumb';
    if (item.error) thumb.classList.add('img-attach-error');
    if (!item.uploaded && !item.error) thumb.classList.add('img-attach-loading');

    const img = document.createElement('img');
    img.src = item.objectUrl;
    img.alt = item.filename || 'image';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'img-attach-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeAttachment(sessionId, idx);
    });

    thumb.appendChild(img);
    thumb.appendChild(closeBtn);

    if (item.uploaded && item.filename) {
      const label = document.createElement('div');
      label.className = 'img-attach-label';
      label.textContent = item.filename;
      thumb.appendChild(label);
    }

    bar.appendChild(thumb);
  });

  // Confirm button
  const allUploaded = list.some(i => i.uploaded);
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'img-attach-confirm';
  confirmBtn.textContent = '↵ 첨부';
  confirmBtn.disabled = !allUploaded;
  confirmBtn.addEventListener('click', e => {
    e.stopPropagation();
    confirmAttachments(sessionId);
  });
  bar.appendChild(confirmBtn);

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'img-attach-cancel';
  cancelBtn.textContent = '✕';
  cancelBtn.addEventListener('click', e => {
    e.stopPropagation();
    // Delete all files from server
    list.forEach(item => {
      if (item.fullPath) {
        fetch('/api/delete-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: item.fullPath }),
        }).catch(() => {});
      }
    });
    clearAll(sessionId);
  });
  bar.appendChild(cancelBtn);

  div.appendChild(bar);
  requestAnimationFrame(() => {
    adjustXtermForBar(entry, bar.offsetHeight);
    entry.fitAddon.fit();
    entry.term.scrollToBottom();
  });
}

function adjustXtermForBar(entry, barHeight) {
  const xtermEl = entry.div.querySelector('.xterm');
  if (!xtermEl) return;
  if (barHeight > 0) {
    xtermEl.style.setProperty('bottom', barHeight + 'px', 'important');
    xtermEl.style.setProperty('height', `calc(100% - ${barHeight}px)`, 'important');
  } else {
    xtermEl.style.removeProperty('bottom');
    xtermEl.style.removeProperty('height');
  }
}

// ─── PUBLIC API ──────────────────────────────────────────────────
export function setupTerminalImageHandlers(div, sessionId) {
  div.addEventListener('paste', e => handlePaste(e, sessionId), true);
  div.addEventListener('dragover', e => handleDragOver(e));
  div.addEventListener('dragleave', e => handleDragLeave(e));
  div.addEventListener('drop', e => handleDrop(e, sessionId));
}
