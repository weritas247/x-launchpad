# Split Pane Feature Design
Date: 2026-03-17

## Overview
Add up to 4-way terminal split pane support to Super Terminal. Users drag tabs to split the terminal area, resize panes by dragging dividers, and each pane hosts an independent session.

---

## Architecture

### Layout Tree (Flexbox Nested)

```
SplitNode
├── type: "horizontal" | "vertical"
├── ratio: number  (0.2 – 0.8)
└── children: [SplitNode | PaneNode, SplitNode | PaneNode]

PaneNode
├── sessionId: string
└── element: HTMLElement (.term-pane)
```

- `#terminal-wrapper` retains `position:relative`
- A new `#split-root` div is inserted inside `#terminal-wrapper`
- `renderSplitLayout(node, rect)` recursively positions each `PaneNode` using `position:absolute` + percentage coordinates
- Existing `terminalMap`, `activateSession`, `attachTerminal` are **unchanged**
- Layout is a pure rendering layer on top of existing session management

### Single-pane (default) mode
When only one session exists, split mode is inactive. `#terminal-wrapper` behaves exactly as today (`.term-pane.active` visible). Split mode activates on first DnD split action.

---

## Tab DnD → Split

### Drop Zone Overlay
- Shown when a tab drag begins over `#terminal-wrapper`
- 5 drop zones rendered as semi-transparent overlays:
  - **Left / Right / Top / Bottom**: 25% strips along each edge
  - **Center grid**: 2×2 grid covering the center, triggers 4-way split
- Hovered zone highlights with `var(--accent)` fill at 20% opacity + accent border
- Disabled (hidden) when pane count is already 4

### Drop Actions
| Drop Zone | Action |
|-----------|--------|
| Left | Split active pane vertically (left=new, right=existing) |
| Right | Split active pane vertically (left=existing, right=new) |
| Top | Split active pane horizontally (top=new, bottom=existing) |
| Bottom | Split active pane horizontally (top=existing, bottom=new) |
| Center grid | Replace active pane with 2×2 SplitNode tree; create 3 new sessions |

### New Session on Split
Each new pane immediately spawns a new shell session via existing `createSession()` flow.

### Pane Count Limit
Maximum 4 panes total. Drop zones are hidden when limit is reached.

### Single-pane Tab Reorder
When only one pane exists, existing tab DnD reorder behavior is preserved unchanged.

---

## Divider Drag Resize

### Divider Element
- `position:absolute`, 8px click target, 1px visual line
- `cursor: col-resize` (vertical split) or `row-resize` (horizontal split)
- Styled: `background: var(--border-lit)`, hover glow `var(--accent-glow)`

### Resize Logic
- `mousedown` on divider → enter resize mode
- `mousemove` → recalculate `ratio = delta / parentSize`
- `mouseup` → exit resize mode, call `renderSplitLayout()`
- Ratio clamped to `[0.2, 0.8]`

---

## Active Pane Highlighting

- **Active pane**: `border: 1px solid var(--accent)` + `box-shadow: 0 0 8px var(--accent-glow)`
- **Inactive panes**: `opacity: 0.6` + `filter: brightness(0.7)`
- Clicking any pane calls `activateSession(sessionId)` and updates active pane state
- Keyboard navigation: `Ctrl+Shift+ArrowLeft/Right/Up/Down` moves focus between panes

---

## Pane Close / Merge

- Closing a session removes its `PaneNode` from the tree
- Sibling node expands to fill parent space
- If only 1 pane remains, split mode deactivates and layout reverts to default single-pane mode

---

## Data Model

```js
// layoutTree: SplitNode | PaneNode | null
// null = no split (default mode)

// PaneNode: { type: 'pane', sessionId: string, element: HTMLElement }
// SplitNode: { type: 'split', direction: 'h'|'v', ratio: number, children: [node, node] }
```

---

## Affected Files

- `client/index.html` — all changes (CSS + JS in single file)
  - Add CSS: `.split-root`, `.split-divider`, `.drop-zone-overlay`, `.drop-zone-*`, active/inactive pane styles
  - Add JS: `layoutTree`, `renderSplitLayout()`, `insertSplitPane()`, `removeSplitPane()`, drop zone DnD handlers, divider resize handlers, `Ctrl+Shift+Arrow` keyboard handler
  - Modify JS: tab `dragstart`/`dragend` to show/hide drop zone overlay

---

## Non-Goals
- Saving/restoring split layout across page reload
- More than 4 panes
- Arbitrary free-form placement (non-binary-tree layouts)
