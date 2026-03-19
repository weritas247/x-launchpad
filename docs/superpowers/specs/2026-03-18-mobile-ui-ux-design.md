# X-Launchpad Mobile UI/UX Design Spec

## Overview

X-Launchpad is a desktop-only browser-based terminal IDE. This spec defines how to make almost all features accessible on mobile devices (phones and tablets) using a **Responsive Overlay** approach: CSS media queries + a lightweight JS module, without modifying existing desktop behavior.

## Goals

- All major features accessible on mobile: terminal, tabs, search, explorer, source control, plan, git graph, settings, diff viewer, input history, session picker
- Touch-friendly targets (minimum 44px)
- No regression on desktop
- Minimal changes to existing JS files

## Non-Goals

- Native app wrapper (Capacitor, etc.)
- Offline support
- Mobile-specific features not present on desktop

## Breakpoint

- **768px** is the single breakpoint
- `@media (max-width: 768px)` triggers mobile layout
- JS detection: `window.matchMedia('(max-width: 768px)')` with `change` listener

## Viewport

- Existing `<meta name="viewport" content="width=device-width, initial-scale=1.0"/>` is sufficient
- Do NOT add `maximum-scale=1` or `user-scalable=no` (accessibility concern)
- All fixed-position elements must account for safe area insets on notched devices:
  - Bottom nav: `padding-bottom: env(safe-area-inset-bottom)`
  - Fullscreen modals: `padding-top: env(safe-area-inset-top)`

## Z-Index Map (Mobile)

| Layer | Z-Index | Element |
|-------|---------|---------|
| Bottom Nav | 4000 | `#bottom-nav` |
| Mobile Sidebar Overlay | 5000 | `#mobile-sidebar-overlay` |
| Diff Modal | 9500 | `#diff-overlay` (existing) |
| Context Menu / Action Sheet | 9000 | `.ctx-menu` (existing) |
| Settings Modal | 10000 | `#settings-overlay` (existing) |
| Git Graph Modal | 10000 | `#git-graph-overlay` (existing) |
| Toast Notifications | 99999 | `#toast-container` (existing) |

## Animations & Accessibility

- All slide/fade animations respect `@media (prefers-reduced-motion: reduce)` — reduce to instant transitions

---

## 1. Layout Transformation

### Desktop (current)
```
grid-template-columns: 42px 240px 4px 1fr
grid-template-areas: "header header header header"
                     "activity sidebar resize main"
```

### Mobile (new)
```
grid-template-columns: 1fr
grid-template-rows: 38px 1fr 48px
grid-template-areas: "header"
                     "main"
                     "bottomnav"
```

Changes:
- Activity bar (`#activity-bar`): `display: none`
- Sidebar (`#sidebar`): `display: none` (moved to overlay)
- Sidebar resize handle (`.sidebar-resize`): `display: none`
- Main area fills entire width
- New bottom navigation bar added

---

## 2. Bottom Navigation Bar

New DOM element appended to `#app`:

```html
<nav id="bottom-nav">
  <button class="bnav-btn" data-panel="search" title="Search">
    <svg><!-- search icon --></svg>
  </button>
  <button class="bnav-btn" data-panel="explorer" title="Explorer">
    <svg><!-- folder icon --></svg>
  </button>
  <button class="bnav-btn" data-panel="source-control" title="Source Control">
    <svg><!-- git icon --></svg>
  </button>
  <button class="bnav-btn" data-panel="plan" title="Plan">
    <svg><!-- clipboard icon --></svg>
  </button>
  <button class="bnav-btn" data-panel="input-history" title="Input History">
    <svg><!-- history icon --></svg>
  </button>
  <button class="bnav-btn" id="bnav-settings" title="Settings">
    <svg><!-- gear icon --></svg>
  </button>
</nav>
```

Styling:
- `position: fixed; bottom: 0; left: 0; right: 0; height: 48px`
- Background: `var(--bg-deep)`, border-top: `1px solid var(--border)`
- Flex layout, equal distribution
- Active state: `color: var(--accent)` with top accent line
- Hidden on desktop (`display: none` outside media query)

Behavior:
- Tapping an icon opens the corresponding sidebar panel as a fullscreen overlay
- Tapping the same icon again (or when already open) closes the overlay
- Settings button opens the settings modal directly

---

## 3. Mobile Sidebar Overlay

New DOM element:

```html
<div id="mobile-sidebar-overlay">
  <div class="mobile-sidebar-header">
    <span class="mobile-sidebar-title">SEARCH</span>
    <button class="mobile-sidebar-close">X</button>
  </div>
  <div class="mobile-sidebar-content">
    <!-- Sidebar panel content cloned/moved here -->
  </div>
</div>
```

Behavior:
- When a bottom nav button is tapped, the corresponding `.sidebar-panel` element is **moved** (not cloned) into `.mobile-sidebar-content`
- When closed, the panel element is moved back to its original position inside `#sidebar`
- Moving DOM nodes preserves all cached JS references (getElementById returns the same node)
- Overlay: `position: fixed; inset: 0; z-index: 5000`
- Background: `var(--bg-panel)`
- Slide-up animation: `transform: translateY(100%) -> translateY(0)`
- Swipe down on header to close
- Close on backdrop tap (area above content)

CSS considerations for moved panels:
- Mobile CSS must NOT use `#sidebar .sidebar-panel` descendant selectors for moved panels
- `.mobile-sidebar-content` must inherit the same CSS custom properties as `#sidebar` (e.g., `--sidebar-font-size`)
- Mobile overlay styles target `.mobile-sidebar-content .sidebar-panel` instead

---

## 4. Header Simplification

At 768px:
- Logo text (`X-LAUNCHPAD`) hidden, only icon shown
- `SYN` count hidden
- `RESTORING` badge hidden
- Latency indicator hidden
- Only shown: connection dot + status label, time, settings button
- Height reduced from 44px to 38px
- Settings button size increased to 36px for touch

---

## 5. Tab Bar Improvements

At 768px:
- Tab height remains 36px (touch-adequate)
- `max-width` on tabs removed, shrink to fit
- `+` button touch target: min 44px
- Horizontal scroll with native momentum scrolling (`overflow-x: auto`)
- Scroll snap: `scroll-snap-type: x mandatory` on tab bar
- Each tab: `scroll-snap-align: start`
- Close button always visible on mobile (no hover dependency)

---

## 6. Terminal Area

- Occupies full screen between header and bottom nav
- Terminal padding reduced: `4px`
- `fit` addon handles resize automatically
- Mobile keyboard handling:
  ```js
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      // Adjust terminal height to visible viewport
      // Prevents terminal from being hidden behind keyboard
    });
  }
  ```
- Input panel (right side) hidden by default on mobile; accessible via bottom nav

---

## 7. Session Picker

At 768px:
- Grid: `grid-template-columns: repeat(2, 1fr)` (from 3 columns, 5 items total — last row centers the single remaining item)
- Button padding increased for touch: `20px 16px`
- Icon size: 40px (from 32px)
- Modal max-width: 90vw

---

## 8. Modals - Fullscreen

All modals become fullscreen on mobile:

### Settings Modal
- `width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; border-radius: 0`
- Settings nav (170px sidebar) -> horizontal scrollable tab strip at top
  - `display: flex; overflow-x: auto; white-space: nowrap; height: 40px`
  - Nav items: `padding: 8px 14px; flex-shrink: 0`
- Settings content below tabs, full width
- Field rows stack vertically: `flex-direction: column; align-items: stretch`
- Field labels: `width: auto` (no fixed 160px)
- Footer buttons: full width

### Git Graph Modal
- Fullscreen: `width: 100vw; height: 100vh; border-radius: 0`
- Commit rows: hide author, time columns
- Hash: visible, truncated
- Refs + message fill available space
- File panel -> bottom sheet (slides up from bottom, 60vh max)
- SVG graph width reduced
- Titlebar buttons: touch-sized (36px)
- Branch dropdown: full-width on mobile

### Diff Modal
- Fullscreen
- Horizontal scroll for long lines
- Font size slightly reduced for readability

---

## 9. Context Menus -> Action Sheets

On mobile, context menus transform to bottom-anchored action sheets:

- Trigger: long-press (350ms) instead of right-click
- Position: `position: fixed; bottom: 0; left: 0; right: 0` with `padding-bottom: env(safe-area-inset-bottom)`
- Slide-up animation
- Items: 48px height, full-width
- Backdrop overlay to dismiss
- Affects: tab context menu, source control context menu, explorer context menu

Implementation:
- `context-menu.js` (`ContextMenu` class): add `_isMobile()` check in `show()` method to switch from cursor-relative positioning to bottom-fixed action sheet positioning
- Long-press detection: each consumer (tab bar, explorer, source control) registers `touchstart`/`touchend` listeners via a helper in `mobile.js` (`registerLongPress(element, callback, threshold=350)`) that wraps the existing `contextmenu` event flow

---

## 10. Touch Gestures

New module `mobile.js` handles:

### Edge Swipe - Sidebar
- Left edge swipe (start within 20px of left edge): opens sidebar overlay with last active panel
- Threshold: 50px horizontal movement
- Uses `touchstart`, `touchmove`, `touchend`

### Edge Swipe - Input History
- Right edge swipe: opens input history bottom sheet
- Same threshold logic

### Swipe Down to Close
- On overlay/bottom sheet headers: swipe down to dismiss
- Threshold: 80px vertical movement

### No pinch zoom (optional, deferred)
- Terminal font pinch-zoom can be added later

---

## 11. Status Bar

At 768px:
- Hide: git branch, separator, clock, terminal size
- Show: session name, WS status
- Height: 20px (unchanged)
- Font size: 10px

---

## 12. Input History Panel

On mobile:
- The existing `#input-panel` DOM element is reused (not recreated)
- CSS transforms it from a right-side absolute panel to a bottom sheet overlay
- Accessed via bottom nav icon
- Opens as bottom sheet (50vh height)
- Swipe up to expand to 80vh
- Swipe down to close
- List items: 44px min height for touch
- All cached references in `input-panel.js` remain valid since the same DOM node is used

---

## 13. Split Pane Behavior

On mobile:
- Split panes are NOT supported (too small)
- If a split exists, show only the active pane fullscreen
- Add a pane switcher UI: small dots/tabs at top of terminal area
- Split dividers hidden
- User can still create splits (they'll see the switcher)

---

## 14. Breadcrumb Bar

At 768px:
- Hidden (`display: none`) — saves vertical space on small screens
- Path info is already available in tab names

---

## 15. File Viewer & Chat Editor

- File viewer panes: fullscreen within terminal area, same as desktop but with full width
- Chat editor (if present): stacks below terminal, full width, min-height increased for touch input
- No special mobile treatment needed beyond the general layout changes

---

## 16. Keyboard-Triggered Panel Switches

On mobile with Bluetooth keyboard:
- `mobile.js` wraps `switchPanel()` from `activity-bar.js`
- When keybinding triggers `focusSearch`/`focusExplorer`/`focusSourceControl`, on mobile it opens the mobile sidebar overlay instead of the hidden desktop sidebar
- Implementation: `mobile.js` monkey-patches the exported `switchPanel()` to redirect to `openMobileOverlay(panelName)` when `isMobile()` is true

---

## 17. Empty State

At 768px:
- ASCII art: smaller or hidden
- AI quick buttons: 2-column grid
- `INIT SESSION` button: full width, larger padding
- Vertical spacing increased

---

## File Changes Summary

### New Files
- `client/js/mobile.js` (~400-500 lines)
  - Mobile detection
  - Bottom nav creation and behavior
  - Sidebar overlay management
  - Touch gesture handling
  - Modal fullscreen enforcement
  - Context menu -> action sheet conversion
  - VisualViewport keyboard handling
  - Split pane mobile switcher

### Modified Files
- `client/styles.css` - Add `@media (max-width: 768px)` block (~250-350 lines)
- `client/index.html` - Add bottom nav HTML + mobile-sidebar-overlay HTML + import mobile.js
- `client/js/main.js` - Import and initialize mobile module
- `client/js/context-menu.js` - Add `_isMobile()` check in `ContextMenu.show()` for action sheet positioning
- `client/js/activity-bar.js` - Export `switchPanel()` function for mobile.js to wrap

### Unchanged Files
- All server files
- `client/js/terminal.js` (fit addon handles resize)
- `client/js/settings.js` (CSS handles fullscreen)
- `client/js/git-graph.js` (CSS handles fullscreen)
- All other JS modules

---

## Testing Checklist

- [ ] Desktop: no visual or functional regression
- [ ] Mobile (iPhone SE - 375px): all panels accessible
- [ ] Mobile (iPhone 14 Pro - 393px): all panels accessible
- [ ] Tablet (iPad - 768px): verify breakpoint edge case
- [ ] Keyboard appears: terminal resizes correctly
- [ ] Orientation change: layout adapts
- [ ] All modals open fullscreen on mobile
- [ ] Context menus appear as action sheets on mobile
- [ ] Touch gestures work (edge swipe, swipe to close)
- [ ] Bottom nav state syncs with open panel
- [ ] Split panes show switcher on mobile
- [ ] Session picker grid is 2 columns on mobile
