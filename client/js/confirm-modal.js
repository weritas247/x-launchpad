// Global custom confirm modal — replaces native confirm()
// Usage: const ok = await confirmModal('Delete file?', 'Delete');

const overlay = document.getElementById('global-confirm-overlay');
const msgEl = document.getElementById('global-confirm-message');
const okBtn = document.getElementById('global-confirm-ok');
const cancelBtn = document.getElementById('global-confirm-cancel');

let _resolve = null;

function close(result) {
  if (!_resolve) return;
  overlay.classList.remove('open');
  _resolve(result);
  _resolve = null;
}

okBtn.addEventListener('click', () => close(true));
cancelBtn.addEventListener('click', () => close(false));
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) close(false);
});

document.addEventListener('keydown', (e) => {
  if (!overlay.classList.contains('open')) return;
  if (e.key === 'Escape') {
    e.stopPropagation();
    close(false);
  }
  if (e.key === 'Enter') {
    e.stopPropagation();
    close(true);
  }
});

/**
 * @param {string} message
 * @param {string} [okText='OK']
 * @returns {Promise<boolean>}
 */
export function confirmModal(message, okText = 'OK') {
  msgEl.textContent = message;
  okBtn.textContent = okText;
  overlay.classList.add('open');
  okBtn.focus();
  return new Promise((resolve) => {
    _resolve = resolve;
  });
}
