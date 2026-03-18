// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────
let container = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'toast-container';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a toast notification
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} type - Toast style
 * @param {number} duration - Auto-dismiss in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const wrap = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${message}</span>`;

  wrap.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}
