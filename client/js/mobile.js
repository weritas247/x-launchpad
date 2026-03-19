// mobile.js — Mobile UI/UX module for Super Terminal
import { switchPanel, getActivePanel } from './activity-bar.js';
import { openSettings } from './settings.js';

// ─── Mobile Detection ───
const MQ = window.matchMedia('(max-width: 768px)');
export function isMobile() {
  return MQ.matches;
}

// ─── DOM refs ───
let bottomNav, overlay, overlayTitle, overlayContent, overlayClose;
let currentOverlayPanel = null;
const panelParentMap = new Map();

const PANEL_TITLES = {
  search: 'SEARCH',
  explorer: 'EXPLORER',
  'source-control': 'SOURCE CONTROL',
  plan: 'PLAN',
  'input-history': 'INPUT HISTORY',
};

// ─── Init ───
export function initMobile() {
  bottomNav = document.getElementById('bottom-nav');
  overlay = document.getElementById('mobile-sidebar-overlay');
  if (!overlay) return;
  overlayTitle = overlay.querySelector('.mobile-sidebar-title');
  overlayContent = document.getElementById('mobile-sidebar-content');
  overlayClose = document.getElementById('mobile-sidebar-close');

  if (!bottomNav) return;

  bottomNav.addEventListener('click', (e) => {
    const btn = e.target.closest('.bnav-btn');
    if (!btn) return;

    if (btn.id === 'bnav-settings') {
      closeMobileOverlay();
      openSettings();
      return;
    }

    const panel = btn.dataset.panel;
    if (!panel) return;

    if (panel === 'input-history') {
      toggleInputHistory();
      return;
    }

    if (currentOverlayPanel === panel) {
      closeMobileOverlay();
    } else {
      openMobileOverlay(panel);
    }
  });

  overlayClose.addEventListener('click', () => closeMobileOverlay());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMobileOverlay();
  });

  MQ.addEventListener('change', onMediaChange);

  if (isMobile()) onEnterMobile();

  initTouchGestures();
  initViewportHandler();
}

// ─── Overlay Management ───
export function openMobileOverlay(panelName) {
  restorePanel();

  const panelEl = document.getElementById('panel-' + panelName);
  if (!panelEl) return;

  panelParentMap.set(panelName, {
    parent: panelEl.parentElement,
    nextSibling: panelEl.nextElementSibling,
  });

  overlayContent.appendChild(panelEl);
  panelEl.classList.add('active');

  switchPanel(panelName);

  overlayTitle.textContent = PANEL_TITLES[panelName] || panelName.toUpperCase();
  overlay.classList.add('open');
  overlay.offsetHeight; // force reflow

  currentOverlayPanel = panelName;
  updateBottomNavActive(panelName);
}

export function closeMobileOverlay() {
  restorePanel();
  overlay.classList.remove('open');
  currentOverlayPanel = null;
  updateBottomNavActive(null);
}

function restorePanel() {
  if (!currentOverlayPanel) return;
  const info = panelParentMap.get(currentOverlayPanel);
  const panelEl = document.getElementById('panel-' + currentOverlayPanel);
  if (info && panelEl) {
    if (info.nextSibling) {
      info.parent.insertBefore(panelEl, info.nextSibling);
    } else {
      info.parent.appendChild(panelEl);
    }
    const desktopActive = getActivePanel();
    if (currentOverlayPanel !== desktopActive) {
      panelEl.classList.remove('active');
    }
  }
  panelParentMap.delete(currentOverlayPanel);
}

function updateBottomNavActive(panelName) {
  if (!bottomNav) return;
  bottomNav.querySelectorAll('.bnav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === panelName);
  });
}

// ─── Input History Bottom Sheet ───
function toggleInputHistory() {
  const panel = document.getElementById('input-panel');
  if (!panel) return;

  if (panel.classList.contains('mobile-sheet')) {
    panel.classList.remove('mobile-sheet');
    panel.classList.add('collapsed');
    updateBottomNavActive(null);
  } else {
    closeMobileOverlay();
    panel.classList.remove('collapsed');
    panel.classList.add('mobile-sheet');
    const content = panel.querySelector('.input-panel-content');
    if (content) content.style.display = 'flex';
    updateBottomNavActive('input-history');
  }
}

// ─── Media Query Change ───
function onMediaChange(e) {
  if (e.matches) onEnterMobile();
  else onLeaveMobile();
}

function onEnterMobile() {
  const inputPanel = document.getElementById('input-panel');
  if (inputPanel) {
    inputPanel.classList.add('collapsed');
    inputPanel.classList.remove('mobile-sheet');
  }
}

function onLeaveMobile() {
  closeMobileOverlay();
  const inputPanel = document.getElementById('input-panel');
  if (inputPanel) inputPanel.classList.remove('mobile-sheet');
}

// ─── Touch Gestures ───
let touchStartX = 0,
  touchStartY = 0,
  touchStartTime = 0;

function initTouchGestures() {
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
}

function onTouchStart(e) {
  if (!isMobile()) return;
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
  touchStartTime = Date.now();
}

function onTouchEnd(e) {
  if (!isMobile()) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  const dt = Date.now() - touchStartTime;

  if (dt > 300) return;
  if (Math.abs(dy) > Math.abs(dx)) return;

  const THRESHOLD = 50;

  // Left edge swipe -> sidebar
  if (touchStartX < 20 && dx > THRESHOLD) {
    const lastPanel = getActivePanel() || 'search';
    openMobileOverlay(lastPanel);
    return;
  }

  // Right edge swipe -> input history
  if (touchStartX > window.innerWidth - 20 && dx < -THRESHOLD) {
    toggleInputHistory();
    return;
  }

  // Swipe down on overlay -> close
  if (overlay && overlay.classList.contains('open') && dy > 80 && touchStartY < 80) {
    closeMobileOverlay();
  }
}

// ─── Visual Viewport Keyboard Handler ───
function initViewportHandler() {
  if (!window.visualViewport) return;

  window.visualViewport.addEventListener('resize', () => {
    if (!isMobile()) return;
    const diff = window.innerHeight - window.visualViewport.height;

    if (diff > 100) {
      // Keyboard open
      document.documentElement.style.setProperty('--keyboard-h', diff + 'px');
      if (bottomNav) bottomNav.style.display = 'none';
      const main = document.getElementById('main');
      if (main) main.style.paddingBottom = '0';
    } else {
      document.documentElement.style.removeProperty('--keyboard-h');
      if (bottomNav) bottomNav.style.display = '';
      const main = document.getElementById('main');
      if (main) main.style.paddingBottom = '';
    }
  });
}

// ─── Long Press Helper ───
export function registerLongPress(element, callback, threshold = 350) {
  let timer = null,
    startX,
    startY;

  element.addEventListener(
    'touchstart',
    (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      timer = setTimeout(() => {
        callback(e);
      }, threshold);
    },
    { passive: true }
  );

  element.addEventListener(
    'touchmove',
    (e) => {
      if (!timer) return;
      const dx = Math.abs(e.touches[0].clientX - startX);
      const dy = Math.abs(e.touches[0].clientY - startY);
      if (dx > 10 || dy > 10) {
        clearTimeout(timer);
        timer = null;
      }
    },
    { passive: true }
  );

  element.addEventListener('touchend', () => {
    clearTimeout(timer);
    timer = null;
  });
  element.addEventListener('touchcancel', () => {
    clearTimeout(timer);
    timer = null;
  });
}

// ─── Auto-init ───
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobile);
} else {
  initMobile();
}
