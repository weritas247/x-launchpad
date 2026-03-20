// ─── SYSTEM TOAST NOTIFICATIONS ─────────────────────────────────
let container = null;

function ensureContainer() {
  if (container) return container;
  container =
    document.getElementById('sys-toast-container') ||
    (() => {
      const el = document.createElement('div');
      el.id = 'sys-toast-container';
      document.body.appendChild(el);
      return el;
    })();
  return container;
}

function escText(s) {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/**
 * Show a system toast notification
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} type - Toast style
 * @param {number} duration - Auto-dismiss in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
  const wrap = ensureContainer();
  const toast = document.createElement('div');
  toast.className = `sys-toast sys-toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="sys-toast-icon">${icon}</span><span class="sys-toast-msg">${escText(message)}</span>`;

  wrap.appendChild(toast);

  // Trigger slide-in animation
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    // Fallback: remove after 500ms if transitionend never fires (background tab, etc.)
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }, duration);
}
