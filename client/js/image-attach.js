import { S, terminalMap } from './state.js';
import { wsSend } from './websocket.js';

// Per-session pending images (NOT uploaded yet): Map<sessionId, [{file, objectUrl}]>
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
  list.push({ file, objectUrl: URL.createObjectURL(file) });
  renderPreview(sessionId);
}

function removeAttachment(sessionId, idx) {
  const list = attachments.get(sessionId);
  if (!list || !list[idx]) return;
  URL.revokeObjectURL(list[idx].objectUrl);
  list.splice(idx, 1);
  if (list.length === 0) attachments.delete(sessionId);
  renderPreview(sessionId);
}

function clearAll(sessionId) {
  const list = attachments.get(sessionId);
  if (list) list.forEach(i => URL.revokeObjectURL(i.objectUrl));
  attachments.delete(sessionId);
  const entry = terminalMap.get(sessionId);
  if (entry) {
    entry.div.querySelector('.img-attach-bar')?.remove();
    adjustXtermForBar(entry, 0);
    requestAnimationFrame(() => { entry.fitAddon.fit(); entry.term.scrollToBottom(); });
  }
}

// ─── UPLOAD (only called on confirm) ─────────────────────────────
async function uploadAll(sessionId) {
  const list = attachments.get(sessionId);
  if (!list || list.length === 0) return [];
  const results = [];
  for (const item of list) {
    try {
      const res = await fetch(
        `/api/upload-image?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(item.file.name || 'image.png')}`,
        { method: 'POST', headers: { 'Content-Type': item.file.type }, body: item.file }
      );
      const result = await res.json();
      if (result.ok) results.push(result.fullPath);
    } catch {}
  }
  return results;
}

// ─── CONFIRM: upload + insert paths ──────────────────────────────
async function confirmAttachments(sessionId) {
  const paths = await uploadAndFlush(sessionId);
  if (paths) {
    wsSend({ type: 'input', sessionId, data: paths });
  }
}

// Upload all pending, clear bar, return paths string
export async function uploadAndFlush(sessionId) {
  const list = attachments.get(sessionId);
  if (!list || list.length === 0) return null;
  const paths = await uploadAll(sessionId);
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

    const img = document.createElement('img');
    img.src = item.objectUrl;
    img.alt = 'image';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'img-attach-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', e => {
      e.stopPropagation();
      removeAttachment(sessionId, idx);
    });

    thumb.addEventListener('click', e => {
      if (e.target === closeBtn) return;
      showImagePreview(item.objectUrl);
    });

    thumb.appendChild(img);
    thumb.appendChild(closeBtn);
    bar.appendChild(thumb);
  });

  // Confirm button
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'img-attach-confirm';
  confirmBtn.textContent = '↵ 첨부';
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

// ─── IMAGE PREVIEW MODAL ────────────────────────────────────────
function showImagePreview(src) {
  const overlay = document.getElementById('img-preview-overlay');
  const img = document.getElementById('img-preview-img');
  if (!overlay || !img) return;
  img.src = src;
  overlay.style.display = 'flex';
  requestAnimationFrame(() => overlay.classList.add('active'));
}

function hideImagePreview() {
  const overlay = document.getElementById('img-preview-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  setTimeout(() => { overlay.style.display = 'none'; }, 200);
}

// Wire up close handlers once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('img-preview-overlay');
  const closeBtn = document.getElementById('img-preview-close');
  if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) hideImagePreview(); });
  if (closeBtn) closeBtn.addEventListener('click', hideImagePreview);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay?.classList.contains('active')) hideImagePreview();
  });
});

// ─── PUBLIC API ──────────────────────────────────────────────────
export function setupTerminalImageHandlers(div, sessionId) {
  div.addEventListener('paste', e => handlePaste(e, sessionId), true);
  div.addEventListener('dragover', e => handleDragOver(e));
  div.addEventListener('dragleave', e => handleDragLeave(e));
  div.addEventListener('drop', e => handleDrop(e, sessionId));
}
