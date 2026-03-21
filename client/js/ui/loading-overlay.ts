// ─── Loading Overlay Module ────────────────────────────
// Fullscreen overlay: app init + WS reconnect
// Session overlay: per-pane for session switch / restore

const LOGO_SVG = `<svg viewBox="0 0 64 64" width="40" height="40">
  <rect width="64" height="64" rx="14" fill="var(--bg-surface, #111120)"/>
  <polygon points="36,8 20,36 30,36 28,56 44,28 34,28" fill="var(--accent, #00ffe5)"/>
</svg>`;

const appOverlay = document.getElementById('app-loading-overlay');

// ─── Fullscreen API ───

export function showAppLoading(): void {
  if (!appOverlay) return;
  appOverlay.style.display = '';
  // Force reflow so transition works after display change
  appOverlay.offsetHeight;
  appOverlay.classList.remove('hidden');
}

export function hideAppLoading(): void {
  if (!appOverlay) return;
  appOverlay.classList.add('hidden');
  appOverlay.addEventListener('transitionend', () => {
    appOverlay.style.display = 'none';
  }, { once: true });
  setTimeout(() => { appOverlay.style.display = 'none'; }, 500);
}

export function isAppLoadingVisible(): boolean {
  return !!appOverlay && !appOverlay.classList.contains('hidden') && appOverlay.style.display !== 'none';
}

// ─── Session API ───

export function showSessionLoading(paneEl: HTMLElement, message = '세션 연결 중...'): void {
  if (!paneEl || paneEl.querySelector('.session-loading-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'session-loading-overlay';
  overlay.innerHTML = `
    <div class="loading-logo">${LOGO_SVG}</div>
    <div class="loading-status">${message}</div>
  `;
  paneEl.appendChild(overlay);
  // Fallback: auto-hide after 5s to prevent stuck overlays
  setTimeout(() => hideSessionLoading(paneEl), 5000);
}

export function hideSessionLoading(paneEl: HTMLElement): void {
  if (!paneEl) return;
  const overlay = paneEl.querySelector('.session-loading-overlay') as HTMLElement;
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 400);
}
