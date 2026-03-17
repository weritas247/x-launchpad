import { S, terminalMap } from './state.js';
import { wsSend } from './websocket.js';

// ─── PASTE HANDLER ───────────────────────────────────────────────
function handlePaste(e, sessionId) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      e.stopPropagation();
      const file = item.getAsFile();
      if (file) uploadImage(file, sessionId);
      return;
    }
  }
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
      uploadImage(file, sessionId);
      return;
    }
  }
}

// ─── UPLOAD ──────────────────────────────────────────────────────
async function uploadImage(file, sessionId) {
  showIndicator(sessionId, 'uploading');
  try {
    const res = await fetch(
      `/api/upload-image?sessionId=${encodeURIComponent(sessionId)}&filename=${encodeURIComponent(file.name || 'image.png')}`,
      { method: 'POST', headers: { 'Content-Type': file.type }, body: file }
    );
    const result = await res.json();
    if (result.ok) {
      wsSend({ type: 'input', sessionId, data: `./${result.filename}` });
      showIndicator(sessionId, 'success', result.filename);
    } else {
      showIndicator(sessionId, 'error', result.error);
    }
  } catch (err) {
    showIndicator(sessionId, 'error', err.message);
  }
}

// ─── VISUAL FEEDBACK ─────────────────────────────────────────────
function showIndicator(sessionId, status, detail) {
  const entry = terminalMap.get(sessionId);
  if (!entry) return;
  entry.div.querySelector('.image-upload-indicator')?.remove();

  const el = document.createElement('div');
  el.className = `image-upload-indicator image-upload-${status}`;
  if (status === 'uploading') el.textContent = '이미지 업로드 중...';
  else if (status === 'success') el.textContent = `이미지 저장: ${detail}`;
  else el.textContent = `업로드 실패: ${detail}`;

  entry.div.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, status === 'uploading' ? 10000 : 3000);
}

// ─── PUBLIC API ──────────────────────────────────────────────────
export function setupTerminalImageHandlers(div, sessionId) {
  div.addEventListener('paste', e => handlePaste(e, sessionId), true);
  div.addEventListener('dragover', e => handleDragOver(e));
  div.addEventListener('dragleave', e => handleDragLeave(e));
  div.addEventListener('drop', e => handleDrop(e, sessionId));
}
