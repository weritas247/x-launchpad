import { getNotificationConfig, playNotificationSound, getOrCreateToastZone } from './notification-config';

function escText(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/**
 * Show a system toast notification
 * @param message - Text to display
 * @param type - 'success' | 'error' | 'info'
 * @param durationOverride - 명시적 duration 지정 시 설정값 대신 사용
 */
export function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', durationOverride?: number) {
  const cfg = getNotificationConfig(type);
  if (!cfg.enabled) return;

  const duration = durationOverride ?? cfg.duration;
  const zone = getOrCreateToastZone(cfg.position);

  const toast = document.createElement('div');
  toast.className = `sys-toast sys-toast-${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span class="sys-toast-icon">${icon}</span><span class="sys-toast-msg">${escText(message)}</span>`;

  zone.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  playNotificationSound(type);

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }, duration);
}
