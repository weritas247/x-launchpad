# Split Pane Feature Design
Date: 2026-03-17

## Overview
Add up to 4-way terminal split pane support to Super Terminal. Users drag tabs to split the terminal area, resize panes by dragging dividers, and each pane hosts an independent session.

---

## Architecture

### Layout Tree (Binary Tree)

```
SplitNode
├── type: "split"
├── direction: "h" | "v"   (h = top/bottom, v = left/right)
├── ratio: number           (0.2 – 0.8, default 0.5)
└── children: [SplitNode | PaneNode, SplitNode | PaneNode]

PaneNode
├── type: "pane"
├── sessionId: string
└── element: HTMLElement (.term-pane)
```

### Split Mode vs Single Mode

- **Single mode** (default): `layoutTree = null`. `#terminal-wrapper` behaves exactly as today — `.term-pane { display:none }` / `.term-pane.active { display:block }`.
- **Split mode**: `layoutTree` is a `SplitNode`. `#split-root` (`position:absolute; inset:0; z-index:0`) is created inside `#terminal-wrapper`. All pane divs are moved into `#split-root`. CSS rule `.split-root .term-pane { display:block !important; position:absolute }` makes all panes visible. `renderSplitLayout()` sets `left/top/width/height` as percentages on each pane div.

### renderSplitLayout(node, rect)

Recursively walks the tree:
- `rect = { left, top, width, height }` in percentages (root = `{0,0,100,100}`)
- For `SplitNode(h)`: child[0] gets `{left, top, width, height*ratio}`, child[1] gets `{left, top+height*ratio, width, height*(1-ratio)}`
- For `SplitNode(v)`: child[0] gets `{left, top, width*ratio, height}`, child[1] gets `{left+width*ratio, top, width*(1-ratio), height}`
- For `PaneNode`: sets `element.style.left/top/width/height` as `${val}%`
- After positioning, clears and re-renders all `.split-divider` elements inside `#split-root`
- Divider for a `SplitNode`: `position:absolute`, same rect as the node, with a 8px strip at the ratio boundary

---

## Input Routing

The server routes keyboard input by `sessionId` in each `input` message (not by server-side active session state):
```js
wsSend({ type: 'input', sessionId, data });
```
Each xterm `onData` handler already includes `sessionId` in the message. In split mode, the `activeSessionId === sessionId` guard in `onData` is **preserved unchanged** — only the pane that has been clicked/activated via `activateSession()` accepts keyboard input. No change to server-side code needed.

---

## activateSession() — modified for split mode

```js
function activateSession(id) {
  if (!terminalMap.has(id)) return;
  activeSessionId = id;

  if (layoutTree === null) {
    // single mode: show/hide as before
    terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
      const a = sid === id;
      div.classList.toggle('active', a);
      tabEl.classList.toggle('active', a);
      sidebarEl.classList.toggle('active', a);
    });
  } else {
    // split mode: all panes visible, only highlight changes
    terminalMap.forEach(({ div, tabEl, sidebarEl }, sid) => {
      const a = sid === id;
      div.classList.toggle('split-active', a);
      div.classList.toggle('split-inactive', !a);
      tabEl.classList.toggle('active', a);
      sidebarEl.classList.toggle('active', a);
    });
    // Still send session_attach so server keeps session alive
    wsSend({ type: 'session_attach', sessionId: id });
  }

  const entry = terminalMap.get(id);
  if (entry) {
    entry.fitAddon.fit();
    entry.term.focus();
    sbActiveName.textContent = (sessionMeta.get(id) || {}).name || id;
    sbSize.textContent = `${entry.term.cols}×${entry.term.rows}`;
  }
  updateStatusBar();
}
```

---

## attachTerminal() — modified for split mode

```js
function attachTerminal(sessionId, name) {
  // ... existing terminal/xterm setup unchanged ...

  const container = layoutTree !== null
    ? document.getElementById('split-root')
    : termWrapper;
  container.appendChild(div);

  // mousedown to focus pane in split mode
  div.addEventListener('mousedown', () => {
    if (layoutTree !== null) activateSession(sessionId);
  });

  // ... rest unchanged ...
}
```

In split mode, pane div is appended to `#split-root`. `renderSplitLayout()` is **not** called here — it is called by `insertSplitPane()` after the tree is updated.

---

## session_created handler — modified for split mode

```js
case 'session_created': {
  const { sessionId, name } = msg;
  attachTerminal(sessionId, name);

  if (pendingSplitQueue.length > 0) {
    // split-mode creation: pop next pending item
    const pending = pendingSplitQueue.shift();
    pending.resolve(sessionId);
    // do NOT call activateSession here
  } else {
    // normal creation: activate as usual
    activateSession(sessionId);
    wsSend({ type: 'session_attach', sessionId });
  }
  break;
}
```

---

## Async Session Creation for Split

```js
// Queue item: { role: 'tl'|'tr'|'bl'|'br'|'left'|'right'|'top'|'bottom', resolve: fn }
let pendingSplitQueue = [];

function createSplitSession(role) {
  return new Promise(resolve => {
    pendingSplitQueue.push({ role, resolve });
    wsSend({ type: 'session_create', name: 'split', cmd: settings?.shell?.defaultShell || '' });
  });
}
```

### Error handling
If WebSocket is offline or `session_created` does not arrive within 8 seconds, a timeout clears `pendingSplitQueue` and shows a brief error toast. Any `session_created` that fires after the timeout is treated as a normal (non-split) creation.

### No session picker modal
Split-created sessions never show `#session-picker`. The `showSessionPicker()` function is not called during split DnD.

---

## Tab DnD → Split

### DnD Data Type
On tab `dragstart`, both types are set:
```js
e.dataTransfer.setData('text/tab-session', sessionId);
e.dataTransfer.setData('text/split-tab', sessionId);
```
Drop handlers on `.dz-*` elements check `text/split-tab`. Existing tab-reorder drop handler checks `text/tab-session` — unchanged.

Sidebar DnD (`text/sidebar-session`) does **not** trigger split drops. Only tab drags activate the drop zone overlay.

### Drop Zone Overlay
```html
<div id="drop-zone-overlay">
  <div class="dz dz-top" data-zone="top"></div>
  <div class="dz dz-bottom" data-zone="bottom"></div>
  <div class="dz dz-left" data-zone="left"></div>
  <div class="dz dz-right" data-zone="right"></div>
  <div class="dz dz-center" data-zone="center"></div>
</div>
```

- `#drop-zone-overlay`: `position:absolute; inset:0; z-index:500; pointer-events:none` (default)
- On tab dragstart: `pointer-events:all; display:block`
- Each `.dz` zone has `pointer-events:all` and handles `dragover` / `drop`
- On tab dragstart: shown only when pane count < 4. If pane count >= 4, skip overlay entirely.
- `#drop-zone-overlay` is a child of `#terminal-wrapper`

### Drop Zone Geometry
```
┌──────────────────────────────┐
│           .dz-top            │  25% height strip
├───────┬──────────────┬───────┤
│       │              │       │
│ .dz   │  .dz-center  │ .dz   │  middle 50% height
│ -left │              │ -right│  left/right: 25% width
│       │              │       │
├───────┴──────────────┴───────┤
│          .dz-bottom          │  25% height strip
└──────────────────────────────┘
```

### Drop Actions

| Drop Zone | Condition | Action |
|-----------|-----------|--------|
| Left | pane count < 4 | Split active pane vertically; new session on left |
| Right | pane count < 4 | Split active pane vertically; new session on right |
| Top | pane count < 4 | Split active pane horizontally; new session on top |
| Bottom | pane count < 4 | Split active pane horizontally; new session on bottom |
| Center | pane count == 1 only | Create 2×2 layout (3 new sessions) |

Center drop zone is hidden (CSS `display:none`) when pane count >= 2.

### 2×2 Tree Structure (Center Drop)

```
SplitNode(h, ratio=0.5)
├── SplitNode(v, ratio=0.5)
│   ├── PaneNode(existingSessionId)   ← top-left (role: 'tl')
│   └── PaneNode(newSession1)          ← top-right (role: 'tr')
└── SplitNode(v, ratio=0.5)
    ├── PaneNode(newSession2)           ← bottom-left (role: 'bl')
    └── PaneNode(newSession3)           ← bottom-right (role: 'br')
```

Center drop flow:
1. Build the tree structure above with `existingSessionId` already in `terminalMap`.
2. Queue 3 `createSplitSession()` promises for roles `tr`, `bl`, `br`.
3. As each resolves, update the corresponding `PaneNode.sessionId` in the tree.
4. After all 3 resolve, call `renderSplitLayout()` and `refitAllPanes()`.
5. Call `activateSession(existingSessionId)` to set keyboard focus to top-left pane.

---

## Divider Drag Resize

### Divider Elements
Rendered by `renderSplitLayout()`. For each `SplitNode`, one `<div class="split-divider split-divider-v|h">` is inserted into `#split-root`:
- `position:absolute`, sized to the 8px strip at the ratio boundary
- `cursor: col-resize` (v) or `row-resize` (h)
- Style: `background: var(--border-lit)`, hover `box-shadow: 0 0 6px var(--accent-glow)`
- `z-index: 10` (above pane content)

### Resize Logic
```js
divider.addEventListener('mousedown', e => {
  e.preventDefault();
  const rect = splitRoot.getBoundingClientRect();
  const parentSize = node.direction === 'v' ? rect.width : rect.height;
  const startPos = node.direction === 'v' ? e.clientX : e.clientY;
  const startRatio = node.ratio;

  const onMove = e => {
    const delta = (node.direction === 'v' ? e.clientX : e.clientY) - startPos;
    node.ratio = Math.min(0.8, Math.max(0.2, startRatio + delta / parentSize));
    renderSplitLayout(layoutTree, { left:0, top:0, width:100, height:100 });
    refitAllPanes();
  };
  const onUp = () => document.removeEventListener('mousemove', onMove);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp, { once: true });
});
```

### refitAllPanes()
```js
function refitAllPanes() {
  terminalMap.forEach(({ fitAddon, div }) => {
    // only fit panes currently in the layout tree (visible in split-root)
    if (layoutTree === null) return;
    if (div.parentElement === splitRoot) fitAddon.fit();
  });
}
```

---

## Active Pane Highlighting

```css
.split-root .term-pane { display: block !important; position: absolute; }

.term-pane.split-active {
  border: 1px solid var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
  opacity: 1;
  filter: none;
}
.term-pane.split-inactive {
  opacity: 0.6;
  filter: brightness(0.7);
  border: 1px solid var(--border);
}
```

### Click-to-Focus
`mousedown` listener added in `attachTerminal()` (see above). xterm canvas events bubble up to the pane div.

### Keyboard Navigation: Ctrl+Shift+Arrow
Algorithm:
1. Collect all `PaneNode`s from tree with their computed `getBoundingClientRect()`.
2. From active pane's center point, for each candidate pane, compute angle from active center to candidate center.
3. Filter to candidates within ±45° cone of the pressed direction (Left=180°, Right=0°, Up=270°, Down=90°).
4. Select nearest by **primary-axis distance** (horizontal distance for Left/Right, vertical for Up/Down). Tiebreaker: smaller perpendicular distance.
5. If no candidates in cone, do nothing.

---

## Pane Close / Merge

`closeSession(sessionId)` is modified:

```js
function closeSession(sessionId) {
  // ... existing: send session_kill, remove tab, sidebar entry ...

  // Always dispose xterm instance to release WebGL contexts and listeners
  const entry = terminalMap.get(sessionId);
  if (entry) entry.term.dispose();

  if (layoutTree !== null) {
    removeSplitPane(sessionId);
    // div removal handled inside removeSplitPane
  } else {
    entry.div.remove(); // existing behavior
  }
}
```

`removeSplitPane(sessionId)`:
1. Find `PaneNode` with matching `sessionId` in tree. Remove its `element` from DOM.
2. Find parent `SplitNode`. Replace it in the grandparent (or root) with the sibling node.
3. If tree is now a single `PaneNode`: set `layoutTree = null`, move pane div back to `termWrapper`, add `.active` class, destroy `#split-root`, call `activateSession()`.
4. Otherwise: call `renderSplitLayout()` + `refitAllPanes()`.

---

## insertSplitPane(direction, existingSessionId, newSessionId)

Finds `PaneNode(existingSessionId)` in tree (or creates root). Replaces it with:

```
SplitNode(direction, ratio=0.5)
├── PaneNode(newSessionId)    [position: left|top depending on direction]
└── PaneNode(existingSessionId)
```

For Left/Top drops: new session is child[0]. For Right/Bottom: new session is child[1].

After insertion: calls `renderSplitLayout()` + `refitAllPanes()` + `activateSession(newSessionId)`.

**First split activation flow:**
1. `layoutTree` is `null`. Create `#split-root`. Move existing active pane div from `termWrapper` to `splitRoot`. Set `layoutTree` to the new `SplitNode`.

---

## Affected Code (client/index.html)

**CSS additions:**
- `#split-root`, `#drop-zone-overlay`, `.dz`, `.dz-top/bottom/left/right/center`, `.dz-hover`
- `.split-divider`, `.split-divider-v`, `.split-divider-h`
- `.term-pane.split-active`, `.term-pane.split-inactive`
- `.split-root .term-pane`

**JS additions:**
- `let layoutTree = null`
- `let splitRoot = null`
- `let pendingSplitQueue = []`
- `renderSplitLayout(node, rect)`
- `insertSplitPane(direction, existingId, newId)`
- `removeSplitPane(sessionId)`
- `refitAllPanes()`
- `createSplitSession(role)` — promise-based async session create
- `showDropZoneOverlay()` / `hideDropZoneOverlay()`
- `Ctrl+Shift+Arrow` handler in existing keydown listener

**JS modifications:**
- `activateSession()` — split-mode branch
- `attachTerminal()` — container selection + mousedown listener
- `closeSession()` — calls `removeSplitPane()` in split mode
- `session_created` handler — checks `pendingSplitQueue`
- Tab `dragstart` — set `text/split-tab` + show overlay
- Tab `dragend` — hide overlay

---

## WebSocket Reconnect Behavior

Split layout is not persisted. On WebSocket reconnect, the existing `syncSessionList()` handler runs:

1. If `layoutTree !== null` when reconnect fires: call `teardownSplitLayout()` first.
   - `teardownSplitLayout()`: set `layoutTree = null`, destroy `#split-root`, move all pane divs back to `termWrapper`, remove `.split-active`/`.split-inactive` classes.
2. `syncSessionList()` then proceeds normally in single mode.
3. The first session in the list is activated.

This means any in-progress split layout is silently torn down on reconnect. This is acceptable per the non-goal of layout persistence.

---

## Non-Goals
- Saving/restoring split layout across page reload
- More than 4 panes
- Arbitrary free-form placement
- Animated pane transitions
- Sidebar item drag-to-split
