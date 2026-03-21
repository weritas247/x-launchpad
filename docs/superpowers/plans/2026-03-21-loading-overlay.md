# Loading Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add loading overlays with the project logo at points where users perceive the app as frozen — fullscreen for app init / WS reconnect, per-pane for session switch / restore.

**Architecture:** Two overlay types — a static fullscreen overlay in HTML (visible on page load, reused for WS reconnect) and dynamic per-pane session overlays injected into `.term-pane` elements. A shared module `loading-overlay.ts` exposes `showAppLoading()`, `hideAppLoading()`, `showSessionLoading()`, `hideSessionLoading()` APIs.

**Tech Stack:** Vanilla TS, CSS transitions, inline SVG

**Spec:** `docs/superpowers/specs/2026-03-21-loading-overlay-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `client/index.html` | Modify | Add `#app-loading-overlay` static HTML |
| `client/styles.css` | Modify | Fullscreen + session overlay styles |
| `client/js/ui/loading-overlay.ts` | Create | Overlay show/hide API module |
| `client/js/core/main.ts` | Modify | Hide app overlay on first `session_list` |
| `client/js/core/websocket.ts` | Modify | Show/hide app overlay on WS disconnect/reconnect |
| `client/js/terminal/terminal.ts` | Modify | Session overlay for attach/restore; export `dataWs` state |

---

### Task 1: Add fullscreen overlay HTML and CSS

**Files:**
- Modify: `client/index.html:11-12` (after `<body>`, before `#screen-dim`)
- Modify: `client/styles.css:61` (before `#screen-dim` section)

- [ ] **Step 1: Add static overlay HTML to index.html**

Insert after `<body>`, before `<div id="screen-dim">`:

```html
<!-- LOADING OVERLAY -->
<div id="app-loading-overlay">
  <div class="loading-logo">
    <svg viewBox="0 0 64 64" width="64" height="64">
      <rect width="64" height="64" rx="14" fill="var(--bg-surface, #111120)"/>
      <polygon points="36,8 20,36 30,36 28,56 44,28 34,28" fill="var(--accent, #00ffe5)"/>
    </svg>
  </div>
  <div class="loading-text">X-LAUNCHPAD</div>
  <div class="loading-dots"><span></span><span></span><span></span></div>
</div>
```

- [ ] **Step 2: Add fullscreen overlay CSS to styles.css**

Insert before the `/* ═══ SCREEN DIM OVERLAY ═══ */` section:

```css
/* ═══ APP LOADING OVERLAY ═══ */
#app-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: var(--bg-void);
    transition: opacity 0.4s ease;
}

#app-loading-overlay.hidden {
    opacity: 0;
    pointer-events: none;
}

#app-loading-overlay .loading-logo {
    filter: drop-shadow(0 0 8px var(--accent));
    animation: pulse-logo 3s ease-in-out infinite;
}

#app-loading-overlay .loading-text {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.2em;
}

.loading-dots {
    display: flex;
    gap: 6px;
}

.loading-dots span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: loading-bounce 1.4s ease-in-out infinite;
}

.loading-dots span:nth-child(2) { animation-delay: 0.16s; }
.loading-dots span:nth-child(3) { animation-delay: 0.32s; }

@keyframes loading-bounce {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
}
```

- [ ] **Step 3: Add session overlay CSS**

Append after the fullscreen overlay CSS:

```css
/* ═══ SESSION LOADING OVERLAY ═══ */
.session-loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(5, 5, 8, 0.85);
    transition: opacity 0.3s ease;
}

.session-loading-overlay.hidden {
    opacity: 0;
    pointer-events: none;
}

.session-loading-overlay .loading-logo {
    filter: drop-shadow(0 0 6px var(--accent));
    animation: pulse-logo 3s ease-in-out infinite;
}

.session-loading-overlay .loading-status {
    color: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 12px;
}
```

- [ ] **Step 4: Verify page still loads**

Run: `npm run dev`
Expected: Page loads with overlay visible (stays on because nothing hides it yet)

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/styles.css
git commit -m "feat(ui): add loading overlay HTML and CSS"
```

---

### Task 2: Create loading-overlay.ts module

**Files:**
- Create: `client/js/ui/loading-overlay.ts`

- [ ] **Step 1: Create the module**

```typescript
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
  appOverlay.classList.remove('hidden');
}

export function hideAppLoading(): void {
  if (!appOverlay) return;
  appOverlay.classList.add('hidden');
  appOverlay.addEventListener('transitionend', () => {
    appOverlay.style.display = 'none';
  }, { once: true });
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
}

export function isAppLoadingVisible(): boolean {
  return !!appOverlay && !appOverlay.classList.contains('hidden') && appOverlay.style.display !== 'none';
}

export function hideSessionLoading(paneEl: HTMLElement): void {
  if (!paneEl) return;
  const overlay = paneEl.querySelector('.session-loading-overlay') as HTMLElement;
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add client/js/ui/loading-overlay.ts
git commit -m "feat(ui): add loading-overlay module with fullscreen and session APIs"
```

---

### Task 3: Integrate fullscreen overlay — app init (#1)

**Files:**
- Modify: `client/js/core/main.ts:125-135` (handleMessage `session_list` branch)

- [ ] **Step 1: Import hideAppLoading in main.ts**

Add to imports at top of `main.ts`:

```typescript
import { hideAppLoading } from '../ui/loading-overlay';
```

- [ ] **Step 2: Track first session_list and hide overlay**

In `handleMessage()`, inside the `msg.type === 'session_list'` branch, add at the very beginning (before `syncSessionList`):

```typescript
  if (msg.type === 'session_list') {
    if (!_initialListReceived) {
      _initialListReceived = true;
      hideAppLoading();
    }
    syncSessionList(msg.sessions, S.wsJustReconnected);
```

Declare the flag near the top of the file (after imports):

```typescript
let _initialListReceived = false;
```

- [ ] **Step 3: Verify overlay hides on load**

Run: `npm run dev`
Expected: Overlay appears briefly, fades out when first `session_list` arrives.

- [ ] **Step 4: Commit**

```bash
git add client/js/core/main.ts
git commit -m "feat(ui): hide app loading overlay on first session_list"
```

---

### Task 4: Integrate fullscreen overlay — WS reconnect (#12)

**Files:**
- Modify: `client/js/core/websocket.ts:57-68` (alertDisconnect / alertReconnect)

- [ ] **Step 1: Import overlay functions in websocket.ts**

Add to top of `websocket.ts`:

```typescript
import { showAppLoading, hideAppLoading } from '../ui/loading-overlay';
```

- [ ] **Step 2: Show overlay on disconnect**

In the `alertDisconnect()` function (line ~57), add `showAppLoading()`:

```typescript
function alertDisconnect(reason) {
  _disconnectTime = Date.now();
  showAppLoading();
  showToast(`서버 연결 끊김: ${reason}`, 'error', 10000);
  console.error(`[WS] 연결 끊김 — ${reason} (${new Date().toLocaleTimeString()})`);
}
```

- [ ] **Step 3: Hide overlay on reconnect**

In the `alertReconnect()` function (line ~63), add `hideAppLoading()`:

```typescript
function alertReconnect() {
  const downSec = _disconnectTime ? ((Date.now() - _disconnectTime) / 1000).toFixed(1) : '?';
  hideAppLoading();
  showToast(`서버 재연결 성공 (${downSec}s 동안 끊김)`, 'success', 5000);
  console.log(`[WS] 재연결 성공 — ${downSec}s downtime (${new Date().toLocaleTimeString()})`);
  _disconnectTime = 0;
}
```

Note: `alertDisconnect` is only called when `_wasConnected` is true, so the first connection is not affected — the initial overlay is handled by Task 3.

- [ ] **Step 4: Handle hideAppLoading re-show after initial display:none**

In `loading-overlay.ts`, update `showAppLoading()` to reset `display`:

```typescript
export function showAppLoading(): void {
  if (!appOverlay) return;
  appOverlay.style.display = '';
  // Force reflow so transition works after display change
  appOverlay.offsetHeight;
  appOverlay.classList.remove('hidden');
}
```

- [ ] **Step 5: Test reconnect flow**

Run: `npm run dev`, then stop the server, wait 3s, restart.
Expected: Overlay appears on disconnect, hides on reconnect.

- [ ] **Step 6: Commit**

```bash
git add client/js/core/websocket.ts client/js/ui/loading-overlay.ts
git commit -m "feat(ui): show/hide app loading overlay on WS disconnect/reconnect"
```

---

### Task 5: Integrate session overlay — session switch (#2)

**Files:**
- Modify: `client/js/terminal/terminal.ts:240-378` (attachTerminal — expose dataWs state)
- Modify: `client/js/core/main.ts:146-178` (session_created / session_attached handlers)

- [ ] **Step 1: Import session overlay functions in main.ts**

Update the import in `main.ts`:

```typescript
import { hideAppLoading, showSessionLoading, hideSessionLoading, isAppLoadingVisible } from '../ui/loading-overlay';
```

- [ ] **Step 2: Show session overlay on session_created (else branch only)**

In `handleMessage()`, in the `session_created` branch, add overlay **inside the else branch** (not for split-queue sessions). Skip if fullscreen overlay is visible:

```typescript
  } else if (msg.type === 'session_created') {
    attachTerminal(msg.sessionId, msg.name);
    onAiSessionCreated(msg.sessionId);
    if (S.pendingSplitQueue.length > 0) {
      const pending = S.pendingSplitQueue.shift();
      pending.resolve(msg.sessionId);
    } else {
      const entry = terminalMap.get(msg.sessionId);
      if (entry && !isAppLoadingVisible()) showSessionLoading(entry.div);
      activateSession(msg.sessionId);
```

- [ ] **Step 3: Hide session overlay on session_attached**

In `handleMessage()`, in the `session_attached` branch, hide the overlay. Note: for existing already-connected sessions this is a no-op because there's no overlay DOM element:

```typescript
  } else if (msg.type === 'session_attached') {
    activateSession(msg.sessionId);
    const entry = terminalMap.get(msg.sessionId);
    if (entry) hideSessionLoading(entry.div);
```

- [ ] **Step 4: Also hide overlay on first data from data WS**

In `terminal.ts` `attachTerminal()`, modify `setupDataWsHandlers` to hide session overlay on first data. This acts as a secondary hide trigger — whichever fires first (`session_attached` or first data) starts the fade-out; subsequent calls are no-ops because `hideSessionLoading` checks for existing overlay DOM:

```typescript
  function setupDataWsHandlers() {
    let firstData = true;
    dataWs.onopen = () => console.log(`[data-ws] Connected: ${sessionId.slice(-6)}`);
    dataWs.onmessage = (event) => {
      if (firstData) {
        firstData = false;
        import('../ui/loading-overlay').then(m => m.hideSessionLoading(div));
      }
      streamWrite(sessionId, term, event.data);
```

- [ ] **Step 5: Add 5s timeout fallback in loading-overlay.ts**

Update `showSessionLoading` to auto-hide after 5 seconds:

```typescript
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
```

- [ ] **Step 6: Test session creation**

Run: `npm run dev`, create a new session via `+` button.
Expected: Session overlay appears briefly, hides when terminal is ready.

- [ ] **Step 7: Commit**

```bash
git add client/js/core/main.ts client/js/terminal/terminal.ts client/js/ui/loading-overlay.ts
git commit -m "feat(ui): show/hide session loading overlay on session switch"
```

---

### Task 6: Integrate session overlay — session restore (#3)

**Files:**
- Modify: `client/js/terminal/terminal.ts:214-235` (isInitialLoad block in syncSessionList)

- [ ] **Step 1: Replace restore text with session overlay**

In `syncSessionList()`, replace the entire `if (isInitialLoad) { ... }` block (lines ~214-235). The changes are:
1. **ADD** `showSessionLoading` for all restored sessions (not just firstId)
2. **ADD** `hideSessionLoading` inside the `unbypassStream` timeout (alongside existing `scrollToBottom`)
3. **REMOVE** the `e.term.write('\r\n\x1b[36m  ⟳ Restoring session...\x1b[0m\r\n\r\n')` line (was only for firstId)
4. **KEEP** `bypassStream`/`unbypassStream`, `scrollToBottom`, and the `hdr-restore-badge` logic unchanged

Replace lines 214-235 with:

```typescript
    if (isInitialLoad) {
      // Show session loading overlay for all restored sessions
      newIds.forEach((id) => {
        const entry = terminalMap.get(id);
        if (entry) {
          import('../ui/loading-overlay').then(m => m.showSessionLoading(entry.div, '세션 복원 중...'));
        }
      });
      // Bypass streaming for restored sessions — dump output instantly, then scroll to bottom
      newIds.forEach((id) => {
        bypassStream(id);
        setTimeout(() => {
          unbypassStream(id);
          const entry = terminalMap.get(id);
          if (entry) {
            entry.term.scrollToBottom();
            import('../ui/loading-overlay').then(m => m.hideSessionLoading(entry.div));
          }
        }, 3000);
      });
      const badge = document.getElementById('hdr-restore-badge');
      if (badge) {
        badge.style.display = '';
        setTimeout(() => {
          badge.style.display = 'none';
        }, 2000);
      }
      // NOTE: removed old e.term.write('⟳ Restoring session...') — replaced by overlay
    }
```

- [ ] **Step 2: Test session restore**

Run: `npm run dev` with existing sessions.
Expected: Restored sessions show logo overlay instead of `⟳ Restoring session...` text, overlay fades out after ~3s.

- [ ] **Step 3: Commit**

```bash
git add client/js/terminal/terminal.ts
git commit -m "feat(ui): replace restore text with session loading overlay"
```

---

### Task 7: Final verification and cleanup

- [ ] **Step 1: Full flow test**

Test all four scenarios:
1. Fresh page load → fullscreen overlay → fades on session_list
2. Create new session → pane overlay → fades on attach
3. Session restore (refresh with sessions) → pane overlay → fades after restore
4. Kill server → fullscreen overlay → restart server → fades on reconnect

- [ ] **Step 2: Check no duplicate overlays**

Rapidly click between sessions, create/close sessions.
Expected: No stacked overlays, no orphaned overlays.

- [ ] **Step 3: Check mobile responsiveness**

Resize to mobile width.
Expected: Overlays render correctly, centered content.

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix(ui): loading overlay edge case fixes"
```
