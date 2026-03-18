# Mobile UI/UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Super Terminal's almost all features usable on mobile devices (phones/tablets) via responsive CSS + a mobile JS module.

**Architecture:** CSS-only responsive layout at `@media (max-width: 768px)` breakpoint hides desktop chrome (activity bar, sidebar) and restructures the grid. A new `mobile.js` module handles bottom navigation, sidebar overlay, touch gestures, and keyboard viewport adjustments. Existing JS modules receive minimal hooks (exported functions, mobile-aware positioning).

**Tech Stack:** Vanilla CSS media queries, Vanilla JS (ES modules), Touch Events API, Visual Viewport API

**Spec:** `docs/superpowers/specs/2026-03-18-mobile-ui-ux-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `client/js/mobile.js` (~450 lines) | Mobile detection, bottom nav, sidebar overlay, touch gestures, viewport keyboard handling, input panel bottom sheet, split pane switcher |

### Modified Files
| File | Changes |
|------|---------|
| `client/styles.css` | Append `@media (max-width: 768px)` block (~300 lines) |
| `client/index.html` | Add bottom nav HTML, mobile overlay HTML, import `mobile.js` |
| `client/js/main.js` | Import and call `initMobile()` |
| `client/js/context-menu.js` | Add `_isMobile()` check in `show()` for action sheet positioning |
| `client/js/activity-bar.js` | Already exports `switchPanel()` — no changes needed |

---

## Task 1: Mobile CSS — Layout & Header

**Files:**
- Modify: `client/styles.css` (append at end)

- [ ] **Step 1: Add mobile layout grid override**

Append to `client/styles.css`:

```css
/* ═══════════════════════════════════════════════════
   MOBILE RESPONSIVE (max-width: 768px)
═══════════════════════════════════════════════════ */
@media (max-width: 768px) {
  /* Layout: single column */
  #app {
    grid-template-columns: 1fr;
    grid-template-rows: 38px 1fr 0; /* bottomnav height set by JS */
    grid-template-areas: "header" "main";
  }

  /* Hide desktop chrome */
  #activity-bar { display: none !important; }
  #sidebar { display: none !important; }
  .sidebar-resize { display: none !important; }

  /* Header simplification */
  #header { height: 38px; padding: 0 10px; gap: 8px; }
  .logo-text-super, .logo-text-term, .header-slash { display: none; }
  .header-meta { gap: 8px; }
  .meta-item:nth-child(3), /* SYN count */
  .meta-item:nth-child(4)  /* RESTORING */ { display: none; }
  .latency-indicator { display: none; }
  #btn-settings { width: 36px; height: 36px; font-size: 15px; }

  /* Breadcrumb hidden */
  .breadcrumb-bar { display: none; }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .mobile-sidebar-overlay,
  .bnav-btn,
  #bottom-nav { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 2: Verify desktop is unaffected**

Open in desktop browser (>768px) and confirm no visual changes.

- [ ] **Step 3: Commit**

```bash
git add client/styles.css
git commit -m "style: 모바일 레이아웃 기본 CSS 추가 (768px breakpoint)"
```

---

## Task 2: Mobile CSS — Tab Bar, Terminal, Status Bar, Empty State

**Files:**
- Modify: `client/styles.css` (append inside the `@media` block)

- [ ] **Step 1: Add tab bar, terminal, status bar mobile styles**

Append inside the `@media (max-width: 768px)` block:

```css
  /* Tab bar */
  #tab-bar { overflow-x: auto; scroll-snap-type: x mandatory; }
  .tab { max-width: none; min-width: 80px; flex-shrink: 0; scroll-snap-align: start; }
  .tab-close-btn { opacity: 1; } /* always visible on mobile */
  .tab-add-btn { min-width: 44px; min-height: 36px; }

  /* Terminal */
  .term-pane { padding: 4px; }

  /* Input panel: hidden by default, restyled as bottom sheet */
  .input-panel { display: none !important; }
  .input-panel.mobile-sheet {
    display: flex !important;
    position: fixed;
    left: 0; right: 0; bottom: 0;
    width: 100%; height: 50vh;
    z-index: 5500;
    flex-direction: column;
    background: var(--bg-panel);
    border-top: 1px solid var(--border-lit);
    border-radius: 12px 12px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    transform: translateY(0);
    transition: height 0.2s ease, transform 0.2s ease;
  }
  .input-panel.mobile-sheet .input-panel-toggle { display: none; }
  .input-panel.mobile-sheet .input-panel-content {
    display: flex; margin-left: 0; width: 100%;
  }
  .input-panel.mobile-sheet .input-entry { min-height: 44px; align-items: center; }

  /* Status bar */
  #statusbar { font-size: 10px; padding: 0 8px; gap: 6px; }
  .sb-branch-group { display: none !important; }
  #sb-clock { display: none; }
  #sb-size { display: none; }

  /* Empty state */
  .empty-art { display: none; }
  .ai-quick-btns { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .btn-start { width: 100%; padding: 12px 24px; }
  .btn-ai-quick { padding: 10px 12px; }
```

- [ ] **Step 2: Commit**

```bash
git add client/styles.css
git commit -m "style: 모바일 탭바, 터미널, 상태바, 빈 상태 CSS"
```

---

## Task 3: Mobile CSS — Modals Fullscreen

**Files:**
- Modify: `client/styles.css` (append inside the `@media` block)

- [ ] **Step 1: Add fullscreen modal styles**

Append inside the `@media (max-width: 768px)` block:

```css
  /* Settings modal: fullscreen */
  #settings-modal {
    width: 100vw; height: 100vh;
    max-width: 100vw; max-height: 100vh;
    border-radius: 0;
  }
  .settings-body { flex-direction: column; }
  .settings-nav {
    width: 100%; border-right: none; border-bottom: 1px solid var(--border);
    display: flex; flex-direction: row; overflow-x: auto;
    padding: 0; flex-shrink: 0; height: 40px;
  }
  .nav-item {
    padding: 8px 14px; flex-shrink: 0; white-space: nowrap;
    border-left: none; border-bottom: 2px solid transparent;
  }
  .nav-item.active { border-left-color: transparent; border-bottom-color: var(--accent); }
  .nav-sep { display: none; }
  .settings-content { padding: 16px 14px; }
  .field-row { flex-direction: column; align-items: stretch; gap: 6px; }
  .field-label { width: auto; }
  .settings-footer { padding: 10px 14px; }
  .settings-footer .btn-save, .settings-footer .btn-cancel { flex: 1; }
  .settings-titlebar { padding: 0 14px; padding-top: env(safe-area-inset-top); }

  /* Git graph modal: fullscreen */
  #git-graph-modal {
    width: 100vw; height: 100vh;
    max-width: 100vw; max-height: 100vh;
    min-width: unset; min-height: unset;
    border-radius: 0;
  }
  .gg-titlebar { padding: 0 10px; padding-top: env(safe-area-inset-top); gap: 6px; flex-wrap: wrap; }
  .gg-author { display: none; }
  .gg-time { display: none; }
  .gg-stat { display: none; }
  .gg-file-panel {
    position: fixed; bottom: 0; left: 0; right: 0;
    width: 100%; height: 60vh; max-height: 60vh;
    border-left: none; border-top: 1px solid var(--border-lit);
    border-radius: 12px 12px 0 0;
    z-index: 10;
  }
  .gg-resize-handle { display: none; }
  .gg-row { padding: 0 8px; gap: 6px; }
  .gg-hash { width: 50px; font-size: 10px; }
  .gg-branch-trigger { font-size: 10px; }

  /* Diff modal: fullscreen */
  #diff-modal {
    width: 100vw; height: 100vh;
    max-width: 100vw; max-height: 100vh;
    border-radius: 0;
  }
  .diff-titlebar { padding: 0 10px; padding-top: env(safe-area-inset-top); }
  .diff-body { font-size: 12px; overflow-x: auto; }

  /* Session picker: 2 columns */
  .sp-grid { grid-template-columns: repeat(2, 1fr); }
  .sp-btn { padding: 20px 16px; }
  .sp-btn img { width: 40px; height: 40px; }
  #session-picker-box { min-width: unset; width: 90vw; }

  /* Context menu as action sheet */
  .ctx-menu.mobile-action-sheet {
    position: fixed !important;
    bottom: 0 !important; left: 0 !important; right: 0 !important;
    top: auto !important;
    width: 100%; max-width: 100%;
    border-radius: 12px 12px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
    animation: slideUp 0.2s ease;
  }
  .ctx-menu.mobile-action-sheet .ctx-item { min-height: 48px; padding: 12px 20px; font-size: 14px; }
  @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
```

- [ ] **Step 2: Commit**

```bash
git add client/styles.css
git commit -m "style: 모바일 모달 풀스크린 + 액션시트 CSS"
```

---

## Task 4: Mobile CSS — Bottom Nav & Sidebar Overlay

**Files:**
- Modify: `client/styles.css` (append inside the `@media` block)

- [ ] **Step 1: Add bottom nav and sidebar overlay styles**

Append inside the `@media (max-width: 768px)` block:

```css
  /* Bottom Navigation */
  #bottom-nav {
    position: fixed; bottom: 0; left: 0; right: 0;
    height: calc(48px + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--bg-deep);
    border-top: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-around;
    z-index: 4000;
  }
  .bnav-btn {
    background: none; border: none; color: var(--text-ghost);
    width: 48px; height: 48px;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    cursor: pointer; transition: color 0.15s;
    position: relative;
  }
  .bnav-btn svg { width: 20px; height: 20px; }
  .bnav-btn.active { color: var(--accent); }
  .bnav-btn.active::after {
    content: ''; position: absolute; top: 0; left: 25%; right: 25%;
    height: 2px; background: var(--accent); border-radius: 0 0 2px 2px;
  }
  .bnav-label { font-size: 9px; letter-spacing: 0.04em; }

  /* Mobile Sidebar Overlay */
  #mobile-sidebar-overlay {
    position: fixed; inset: 0; z-index: 5000;
    background: var(--bg-panel);
    display: none; flex-direction: column;
    transform: translateY(100%);
    transition: transform 0.25s ease;
  }
  #mobile-sidebar-overlay.open {
    display: flex; transform: translateY(0);
  }
  .mobile-sidebar-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; padding-top: calc(12px + env(safe-area-inset-top));
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .mobile-sidebar-title {
    font-size: 12px; font-weight: 700; letter-spacing: 0.14em;
    color: var(--accent); text-transform: uppercase;
  }
  .mobile-sidebar-close {
    background: none; border: 1px solid var(--border); border-radius: 4px;
    color: var(--text-dim); font-size: 16px;
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer; font-family: var(--font-mono);
  }
  .mobile-sidebar-close:hover { color: var(--danger); border-color: var(--danger); }
  .mobile-sidebar-content {
    flex: 1; overflow: hidden; display: flex; flex-direction: column;
    font-size: var(--sidebar-font-size);
  }
  /* Ensure moved panels display correctly inside overlay */
  .mobile-sidebar-content .sidebar-panel { display: flex !important; flex: 1; overflow: hidden; }
  .mobile-sidebar-content .sidebar-header { padding-top: 8px; }

  /* Adjust main area for bottom nav */
  #main { padding-bottom: calc(48px + env(safe-area-inset-bottom)); }
```

Also add **outside** the media query (desktop hidden):

```css
/* Bottom nav & mobile overlay: hidden on desktop */
#bottom-nav { display: none; }
#mobile-sidebar-overlay { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git add client/styles.css
git commit -m "style: 모바일 하단 네비게이션 + 사이드바 오버레이 CSS"
```

---

## Task 5: HTML — Add Bottom Nav & Mobile Overlay Elements

**Files:**
- Modify: `client/index.html`

- [ ] **Step 1: Add bottom nav HTML before closing `</div>` of `#app`**

Insert after `</main>` (line 265) and before the closing `</div>` of `#app`:

```html
  <!-- BOTTOM NAV (mobile only) -->
  <nav id="bottom-nav">
    <button class="bnav-btn" data-panel="search" title="Search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><path d="M16 16l4.5 4.5"/></svg>
      <span class="bnav-label">Search</span>
    </button>
    <button class="bnav-btn" data-panel="explorer" title="Explorer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7V5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
      <span class="bnav-label">Explorer</span>
    </button>
    <button class="bnav-btn" data-panel="source-control" title="Source Control">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M12 8.5V12M12 12C12 14 6 14 6 15.5M12 12C12 14 18 14 18 15.5"/></svg>
      <span class="bnav-label">Git</span>
    </button>
    <button class="bnav-btn" data-panel="plan" title="Plan">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>
      <span class="bnav-label">Plan</span>
    </button>
    <button class="bnav-btn" data-panel="input-history" title="Input History">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
      <span class="bnav-label">History</span>
    </button>
    <button class="bnav-btn" id="bnav-settings" title="Settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      <span class="bnav-label">Settings</span>
    </button>
  </nav>

  <!-- MOBILE SIDEBAR OVERLAY -->
  <div id="mobile-sidebar-overlay">
    <div class="mobile-sidebar-header">
      <span class="mobile-sidebar-title">PANEL</span>
      <button class="mobile-sidebar-close" id="mobile-sidebar-close">✕</button>
    </div>
    <div class="mobile-sidebar-content" id="mobile-sidebar-content"></div>
  </div>
```

- [ ] **Step 2: Add mobile.js import**

Add before the existing `<script type="module" src="js/main.js">` line:

```html
<script type="module" src="js/mobile.js"></script>
```

- [ ] **Step 3: Commit**

```bash
git add client/index.html
git commit -m "feat: 모바일 하단 네비게이션 + 사이드바 오버레이 HTML 추가"
```

---

## Task 6: mobile.js — Core Module (Detection, Bottom Nav, Overlay)

**Files:**
- Create: `client/js/mobile.js`

- [ ] **Step 1: Create mobile.js with core functionality**

```javascript
// mobile.js — Mobile UI/UX module for Super Terminal
import { switchPanel, getActivePanel } from './activity-bar.js';
import { openSettings } from './settings.js';
import { S } from './state.js';

// ─── Mobile Detection ───
const MQ = window.matchMedia('(max-width: 768px)');
export function isMobile() { return MQ.matches; }

// ─── DOM refs ───
let bottomNav, overlay, overlayTitle, overlayContent, overlayClose;
let currentOverlayPanel = null;
const panelParentMap = new Map(); // track original parent of moved panels

// ─── Panel name mapping ───
const PANEL_TITLES = {
  'search': 'SEARCH',
  'explorer': 'EXPLORER',
  'source-control': 'SOURCE CONTROL',
  'plan': 'PLAN',
  'input-history': 'INPUT HISTORY',
};

// ─── Init ───
export function initMobile() {
  bottomNav = document.getElementById('bottom-nav');
  overlay = document.getElementById('mobile-sidebar-overlay');
  overlayTitle = overlay.querySelector('.mobile-sidebar-title');
  overlayContent = document.getElementById('mobile-sidebar-content');
  overlayClose = document.getElementById('mobile-sidebar-close');

  if (!bottomNav || !overlay) return;

  // Bottom nav click handlers
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

  // Close button
  overlayClose.addEventListener('click', () => closeMobileOverlay());

  // Close on backdrop (click on overlay itself, not content)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeMobileOverlay();
  });

  // Listen for media query changes
  MQ.addEventListener('change', onMediaChange);

  // If already mobile on load, adjust
  if (isMobile()) {
    onEnterMobile();
  }

  // Touch gestures
  initTouchGestures();

  // Keyboard viewport handling
  initViewportHandler();
}

// ─── Overlay Management ───
function openMobileOverlay(panelName) {
  // First, restore any previously moved panel
  restorePanel();

  // Get the sidebar panel element
  const panelEl = document.getElementById('panel-' + panelName);
  if (!panelEl) return;

  // Remember original parent
  panelParentMap.set(panelName, {
    parent: panelEl.parentElement,
    nextSibling: panelEl.nextElementSibling,
  });

  // Move into overlay
  overlayContent.appendChild(panelEl);
  panelEl.classList.add('active');

  // Trigger data load via switchPanel (handles requestFileTree, etc.)
  switchPanel(panelName);

  // Update UI
  overlayTitle.textContent = PANEL_TITLES[panelName] || panelName.toUpperCase();
  overlay.classList.add('open');
  // Force reflow then animate
  overlay.offsetHeight;

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
    // Restore active state based on desktop active panel
    const desktopActive = getActivePanel();
    if (currentOverlayPanel !== desktopActive) {
      panelEl.classList.remove('active');
    }
  }
  panelParentMap.delete(currentOverlayPanel);
}

function updateBottomNavActive(panelName) {
  if (!bottomNav) return;
  bottomNav.querySelectorAll('.bnav-btn').forEach(btn => {
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
    closeMobileOverlay(); // close sidebar overlay if open
    panel.classList.remove('collapsed');
    panel.classList.add('mobile-sheet');
    // Make content visible
    const content = panel.querySelector('.input-panel-content');
    if (content) content.style.display = 'flex';
    updateBottomNavActive('input-history');
  }
}

// ─── Media Query Change ───
function onMediaChange(e) {
  if (e.matches) {
    onEnterMobile();
  } else {
    onLeaveMobile();
  }
}

function onEnterMobile() {
  // Ensure bottom nav is visible (CSS handles this via media query)
  // Close any desktop sidebar state
  const inputPanel = document.getElementById('input-panel');
  if (inputPanel) {
    inputPanel.classList.add('collapsed');
    inputPanel.classList.remove('mobile-sheet');
  }
}

function onLeaveMobile() {
  // Restore any moved panels
  closeMobileOverlay();
  // Remove mobile-sheet class from input panel
  const inputPanel = document.getElementById('input-panel');
  if (inputPanel) {
    inputPanel.classList.remove('mobile-sheet');
  }
}

// ─── Touch Gestures ───
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

function initTouchGestures() {
  document.addEventListener('touchstart', onTouchStart, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true });
}

function onTouchStart(e) {
  if (!isMobile()) return;
  const touch = e.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  touchStartTime = Date.now();
}

function onTouchEnd(e) {
  if (!isMobile()) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;
  const dt = Date.now() - touchStartTime;

  // Must be a quick swipe (< 300ms) with significant horizontal movement
  if (dt > 300) return;
  if (Math.abs(dy) > Math.abs(dx)) return; // vertical swipe, ignore

  const THRESHOLD = 50;

  // Left edge swipe -> open sidebar
  if (touchStartX < 20 && dx > THRESHOLD) {
    e.preventDefault?.();
    const lastPanel = getActivePanel() || 'search';
    openMobileOverlay(lastPanel);
    return;
  }

  // Right edge swipe -> open input history
  if (touchStartX > window.innerWidth - 20 && dx < -THRESHOLD) {
    e.preventDefault?.();
    toggleInputHistory();
    return;
  }

  // Swipe down on overlay header -> close
  if (overlay.classList.contains('open') && dy > 80 && touchStartY < 80) {
    closeMobileOverlay();
  }
}

// ─── Visual Viewport Keyboard Handler ───
function initViewportHandler() {
  if (!window.visualViewport) return;

  window.visualViewport.addEventListener('resize', () => {
    if (!isMobile()) return;
    const vvh = window.visualViewport.height;
    const wh = window.innerHeight;
    const diff = wh - vvh;

    // If keyboard is open (significant height difference)
    if (diff > 100) {
      document.documentElement.style.setProperty('--keyboard-h', diff + 'px');
      // Hide bottom nav when keyboard is open
      if (bottomNav) bottomNav.style.display = 'none';
      // Shrink main area
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

// ─── Long Press Helper (for context menus) ───
export function registerLongPress(element, callback, threshold = 350) {
  let timer = null;
  let startX, startY;

  element.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    timer = setTimeout(() => {
      // Create a synthetic contextmenu-like event
      callback(e);
    }, threshold);
  }, { passive: true });

  element.addEventListener('touchmove', (e) => {
    if (!timer) return;
    const dx = Math.abs(e.touches[0].clientX - startX);
    const dy = Math.abs(e.touches[0].clientY - startY);
    if (dx > 10 || dy > 10) {
      clearTimeout(timer);
      timer = null;
    }
  }, { passive: true });

  element.addEventListener('touchend', () => {
    clearTimeout(timer);
    timer = null;
  });

  element.addEventListener('touchcancel', () => {
    clearTimeout(timer);
    timer = null;
  });
}

// ─── Auto-init on DOM ready ───
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobile);
} else {
  initMobile();
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/mobile.js
git commit -m "feat: mobile.js 코어 모듈 (하단 네비, 오버레이, 터치 제스처, 키보드 핸들링)"
```

---

## Task 7: Context Menu — Mobile Action Sheet Support

**Files:**
- Modify: `client/js/context-menu.js`

- [ ] **Step 1: Read context-menu.js to confirm show() location**

Read `client/js/context-menu.js` and locate the `show()` method.

- [ ] **Step 2: Add mobile detection and action sheet positioning**

In the `show()` method of `ContextMenu` class, after the menu element is created and items are added, add mobile positioning logic:

```javascript
// Inside show() method, after menu DOM is built but before positioning:
const isMobileView = window.matchMedia('(max-width: 768px)').matches;

if (isMobileView) {
  // Action sheet style
  this.el.classList.add('mobile-action-sheet');
  // Position at bottom of screen
  this.el.style.left = '0';
  this.el.style.right = '0';
  this.el.style.bottom = '0';
  this.el.style.top = 'auto';
  this.el.style.width = '100%';
  this.el.style.maxWidth = '100%';
  // Add backdrop
  this._backdrop = document.createElement('div');
  this._backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:8999';
  this._backdrop.addEventListener('click', () => this.hide());
  document.body.appendChild(this._backdrop);
} else {
  this.el.classList.remove('mobile-action-sheet');
  // ... existing desktop positioning code ...
}
```

In the `hide()` method, add backdrop cleanup:

```javascript
// Inside hide():
if (this._backdrop) {
  this._backdrop.remove();
  this._backdrop = null;
}
```

- [ ] **Step 3: Commit**

```bash
git add client/js/context-menu.js
git commit -m "feat: 컨텍스트 메뉴 모바일 액션시트 지원"
```

---

## Task 8: Main.js — Import Mobile Module

**Files:**
- Modify: `client/js/main.js`

- [ ] **Step 1: Add mobile import**

Add to imports section of `main.js`:

```javascript
import { isMobile } from './mobile.js';
```

Note: `mobile.js` auto-initializes via DOMContentLoaded, so no explicit `initMobile()` call needed in main.js. The import ensures the module is loaded.

- [ ] **Step 2: Commit**

```bash
git add client/js/main.js
git commit -m "feat: main.js에서 mobile 모듈 임포트"
```

---

## Task 9: Mobile Split Pane Switcher

**Files:**
- Modify: `client/js/mobile.js` (add split pane switcher)
- Modify: `client/styles.css` (add switcher styles)

- [ ] **Step 1: Add split pane switcher to mobile.js**

Add to `mobile.js` before the auto-init section:

```javascript
// ─── Split Pane Mobile Switcher ───
// When splits exist on mobile, show a tab strip to switch between panes
export function updateMobileSplitSwitcher() {
  if (!isMobile()) return;
  const existing = document.getElementById('mobile-split-switcher');
  if (!S.layoutTree || !S.layoutTree.children || S.layoutTree.children.length <= 1) {
    if (existing) existing.remove();
    return;
  }

  let switcher = existing;
  if (!switcher) {
    switcher = document.createElement('div');
    switcher.id = 'mobile-split-switcher';
    switcher.className = 'mobile-split-switcher';
    const termWrapper = document.getElementById('terminal-wrapper');
    if (termWrapper) termWrapper.parentElement.insertBefore(switcher, termWrapper);
  }

  // Build dots/tabs for each pane
  switcher.innerHTML = '';
  const panes = S.layoutTree.children;
  panes.forEach((pane, i) => {
    const dot = document.createElement('button');
    dot.className = 'split-dot' + (pane.active ? ' active' : '');
    dot.textContent = (i + 1).toString();
    dot.addEventListener('click', () => {
      // Activate this pane (emit to split-pane system)
      const paneEl = document.querySelector(`.term-pane[data-session="${pane.sessionId}"]`);
      if (paneEl) paneEl.click();
    });
    switcher.appendChild(dot);
  });
}
```

- [ ] **Step 2: Add switcher CSS**

Append inside the `@media (max-width: 768px)` block in `styles.css`:

```css
  /* Split pane switcher */
  .mobile-split-switcher {
    display: flex; justify-content: center; gap: 6px;
    padding: 4px 0; background: var(--bg-deep); border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .split-dot {
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--bg-surface); border: 1px solid var(--border);
    color: var(--text-dim); font-size: 11px; font-family: var(--font-mono);
    cursor: pointer; display: flex; align-items: center; justify-content: center;
  }
  .split-dot.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); }

  /* Hide split dividers on mobile */
  .split-divider { display: none !important; }
```

- [ ] **Step 3: Commit**

```bash
git add client/js/mobile.js client/styles.css
git commit -m "feat: 모바일 분할 패널 스위처 UI"
```

---

## Task 10: Integration Testing & Final Adjustments

**Files:**
- Possibly: `client/styles.css`, `client/js/mobile.js` (bug fixes)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test in mobile viewport (Chrome DevTools)**

Open Chrome DevTools → Toggle device toolbar → Select iPhone 14 Pro (393px).

Verify:
1. Bottom nav appears with 6 icons
2. Activity bar and sidebar are hidden
3. Header shows only logo icon + connection dot + time + settings
4. Tapping bottom nav icons opens fullscreen overlay with correct panel
5. Closing overlay returns panel to original position
6. Settings button opens settings modal fullscreen
7. Tab bar scrolls horizontally
8. Terminal fills available space
9. Session picker shows 2-column grid

- [ ] **Step 3: Test modals**

1. Open settings → verify horizontal nav, stacked fields
2. Open git graph (Ctrl+G) → verify fullscreen, hidden columns
3. Open diff modal → verify fullscreen

- [ ] **Step 4: Test touch gestures**

1. Swipe from left edge → sidebar overlay opens
2. Swipe from right edge → input history opens
3. Swipe down on overlay header → closes

- [ ] **Step 5: Test keyboard**

1. Tap terminal to focus
2. Verify on-screen keyboard triggers viewport resize
3. Bottom nav hides when keyboard is open
4. Terminal resizes to visible area

- [ ] **Step 6: Fix any issues found**

Apply CSS/JS fixes as needed.

- [ ] **Step 7: Test desktop regression**

Resize browser to >768px. Verify:
1. Desktop layout unchanged
2. Bottom nav hidden
3. Activity bar and sidebar visible
4. All modals at normal size
5. No visual changes

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "fix: 모바일 UI/UX 통합 테스트 후 수정사항"
```

---

## Task Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Mobile CSS: Layout & Header | styles.css |
| 2 | Mobile CSS: Tab bar, Terminal, Status bar, Empty state | styles.css |
| 3 | Mobile CSS: Modals fullscreen | styles.css |
| 4 | Mobile CSS: Bottom nav & Overlay | styles.css |
| 5 | HTML: Bottom nav & Overlay elements | index.html |
| 6 | mobile.js: Core module | mobile.js (new) |
| 7 | Context menu: Action sheet support | context-menu.js |
| 8 | Main.js: Import mobile module | main.js |
| 9 | Mobile split pane switcher | mobile.js, styles.css |
| 10 | Integration testing & fixes | various |
