/**
 * Generic modal resize handle initializer.
 * Finds all `.modal-resize-handle[data-modal]` elements and wires up
 * drag-to-resize behaviour with optional localStorage persistence.
 */

const STORAGE_PREFIX = 'modal-size-';

function restoreSize(modal: HTMLElement, key: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(key)!);
    if (saved?.w && saved?.h) {
      modal.style.width = saved.w + 'px';
      modal.style.height = saved.h + 'px';
    }
  } catch {}
}

function saveSize(modal: HTMLElement, key: string) {
  try {
    localStorage.setItem(key, JSON.stringify({ w: modal.offsetWidth, h: modal.offsetHeight }));
  } catch {}
}

export function initModalResize() {
  const handles = document.querySelectorAll<HTMLElement>('.modal-resize-handle[data-modal]');

  handles.forEach((handle) => {
    const modalId = handle.dataset.modal!;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    const storageKey = STORAGE_PREFIX + modalId;
    const minW = parseInt(getComputedStyle(modal).minWidth) || 320;
    const minH = parseInt(getComputedStyle(modal).minHeight) || 200;

    // Restore persisted size
    restoreSize(modal, storageKey);

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = modal.offsetWidth;
      const startH = modal.offsetHeight;

      function onMove(ev: MouseEvent) {
        const w = Math.max(minW, startW + (ev.clientX - startX));
        const h = Math.max(minH, startH + (ev.clientY - startY));
        modal.style.width = w + 'px';
        modal.style.height = h + 'px';
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        saveSize(modal, storageKey);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}
