# Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a VS Code-style command palette with Cmd+P (file/session switch) and Cmd+Shift+P (command execution) to x-launchpad.

**Architecture:** A centralized command registry (`command-registry.ts`) replaces keyboard.ts's internal `actionMap`. Palette UI (`command-palette.ts`) queries the registry and renders a searchable dropdown. Each module registers its own commands at init time.

**Tech Stack:** TypeScript, ES modules, existing xterm.js/WebSocket stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-03-21-command-palette-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `client/js/core/command-registry.ts` | Command registry: register, query, execute, recent history |
| Create | `client/js/ui/command-palette.ts` | Palette UI: overlay, fuzzy search, keyboard nav, rendering |
| Modify | `client/js/core/keyboard.ts` | Remove `actionMap`, delegate to command-registry |
| Modify | `client/js/core/constants.ts:331-348` | Add `openPalette` and `openCommandPalette` to KB_DEFS |
| Modify | `server/config.ts:47-65` | Add default keybindings for palette |
| Modify | `client/js/core/main.ts:275-299` | Register palette actions, update Esc chain |
| Modify | `client/js/core/main.ts:301-360` | Add palette to Esc priority, early return when palette open |
| Modify | `client/js/ui/themes.ts:10-23` | Add `preview` flag to skip `updateSwatches()` |
| Modify | `client/index.html` | Add palette overlay HTML |
| Modify | `client/styles.css` | Add palette CSS + palette theme variables |

---

### Task 1: Command Registry

**Files:**
- Create: `client/js/core/command-registry.ts`

- [ ] **Step 1: Create command-registry.ts with types and core API**

```typescript
// client/js/core/command-registry.ts

export interface Command {
  id: string;
  label: string;
  category: string;
  icon?: string;
  execute: () => void | Promise<void>;
  when?: () => boolean;
}

const registry = new Map<string, Command>();

const RECENT_KEY = 'x-launchpad-recent-commands';
const MAX_RECENT = 10;

export function registerCommand(cmd: Command): void {
  registry.set(cmd.id, cmd);
}

export function getCommands(): Command[] {
  return [...registry.values()].filter((c) => !c.when || c.when());
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function executeCommand(id: string): void {
  const cmd = registry.get(id);
  if (cmd && (!cmd.when || cmd.when())) {
    cmd.execute();
    addRecentCommand(id);
  }
}

export function getRecentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addRecentCommand(id: string): void {
  const recent = getRecentCommands().filter((r) => r !== id);
  recent.unshift(id);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit client/js/core/command-registry.ts`
Expected: No errors (or only errors from missing imports that don't exist yet)

- [ ] **Step 3: Commit**

```bash
git add client/js/core/command-registry.ts
git commit -m "feat(command-palette): add command registry module"
```

---

### Task 2: Migrate keyboard.ts to use command-registry

**Files:**
- Modify: `client/js/core/keyboard.ts`

- [ ] **Step 1: Replace actionMap with command-registry**

Update `keyboard.ts` to import from command-registry and remove the internal `actionMap`:

```typescript
// client/js/core/keyboard.ts
import { S } from './state';
import { normalizeKey, KB_DEFS } from './constants';
import { registerCommand, executeCommand, getCommand } from './command-registry';

// Remove: const actionMap = new Map();

// ... shortcut overlay code stays the same ...

export function registerAction(name: string, fn: () => void) {
  // Backward-compatible wrapper: registers as a command with empty category
  // Modules that call registerAction() will still work; they can migrate to
  // registerCommand() later with full metadata.
  registerCommand({ id: name, label: name, category: '', execute: fn });
}

// ... buildCombo, matchCombo stay the same ...

export function tryKeybinding(e) {
  if (!S.settings) return false;
  if (e.type !== 'keydown') return false;
  if (e._kbHandled) return true;

  const combo = buildCombo(e);
  const action = matchCombo(combo);
  if (!action) return false;

  const cmd = getCommand(action);
  if (cmd) {
    e.preventDefault();
    e._kbHandled = true;
    showShortcutOverlay(combo, action);
    executeCommand(action);
    return true;
  }
  return false;
}

// xtermKeyHandler stays the same
```

- [ ] **Step 2: Verify existing keybindings still work**

Run: `npm run build`
Expected: Compiles without errors. Existing keybindings (Ctrl+Shift+T for new session, etc.) should still work because `registerAction()` now delegates to `registerCommand()`.

- [ ] **Step 3: Commit**

```bash
git add client/js/core/keyboard.ts
git commit -m "refactor(keyboard): migrate actionMap to command-registry"
```

---

### Task 3: Add palette keybindings to KB_DEFS and server defaults

**Files:**
- Modify: `client/js/core/constants.ts:331-348`
- Modify: `server/config.ts:47-65`

- [ ] **Step 1: Add to KB_DEFS in constants.ts**

After line 347 (`{ key: 'toggleFileEdit', label: 'Toggle File Edit' },`), add:

```typescript
  { key: 'openPalette', label: 'Quick Open' },
  { key: 'openCommandPalette', label: 'Command Palette' },
```

- [ ] **Step 2: Add default keybindings in server/config.ts**

In the `keybindings` object (after `toggleFileEdit: 'Ctrl+e'`), add:

```typescript
    openPalette: 'Meta+p',
    openCommandPalette: 'Meta+Shift+p',
```

Note: This will conflict with the existing `planModal: 'Ctrl+p'`. `Meta+p` (Cmd+P on macOS) is different from `Ctrl+p`, so no conflict on macOS. On other platforms, users may need to rebind.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/js/core/constants.ts server/config.ts
git commit -m "feat(command-palette): add keybinding definitions"
```

---

### Task 4: Palette HTML and CSS

**Files:**
- Modify: `client/index.html`
- Modify: `client/styles.css`

- [ ] **Step 1: Add palette overlay HTML to index.html**

Add before the closing `</body>` tag (or near other overlay elements like `settings-overlay`):

```html
<!-- COMMAND PALETTE -->
<div id="command-palette-overlay">
  <div id="command-palette-modal">
    <div id="command-palette-input-wrapper">
      <input id="command-palette-input" type="text" placeholder="검색..." autocomplete="off" spellcheck="false" />
    </div>
    <div id="command-palette-list"></div>
    <div id="command-palette-footer"></div>
  </div>
</div>
```

- [ ] **Step 2: Add palette CSS to styles.css**

Add palette styles. Key design points:
- Overlay covers full screen with semi-transparent background
- Modal is centered horizontally, positioned near the top (like VS Code)
- Uses palette-specific CSS variables for theming
- Width ~520px, max-height 400px with overflow scroll

```css
/* ── Command Palette ── */
#command-palette-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.5);
  justify-content: center;
  padding-top: 15vh;
}
#command-palette-overlay.open {
  display: flex;
}
#command-palette-modal {
  width: 520px;
  max-height: 400px;
  display: flex;
  flex-direction: column;
  background: var(--palette-bg, var(--bg-deep));
  border: 1px solid var(--palette-border, var(--border-lit));
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  align-self: flex-start;
}
#command-palette-input-wrapper {
  padding: 8px;
  border-bottom: 1px solid var(--palette-separator, var(--border));
}
#command-palette-input {
  width: 100%;
  background: var(--palette-input-bg, var(--bg-surface));
  border: 1px solid var(--palette-border, var(--border));
  border-radius: 4px;
  padding: 6px 10px;
  color: var(--text-bright);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
#command-palette-input:focus {
  border-color: var(--accent);
}
#command-palette-list {
  overflow-y: auto;
  flex: 1;
}
.cp-section-label {
  padding: 4px 14px;
  color: var(--palette-category, var(--text-ghost));
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.cp-item {
  padding: 6px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  color: var(--text-main);
  font-size: 13px;
}
.cp-item:hover,
.cp-item.active {
  background: var(--palette-hover, var(--bg-hover));
  border-left: 2px solid var(--accent);
  padding-left: 12px;
}
.cp-item-label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cp-item-category {
  color: var(--accent);
  font-size: 11px;
  min-width: 50px;
}
.cp-item-shortcut {
  color: var(--text-ghost);
  font-size: 11px;
  background: var(--bg-surface);
  padding: 2px 6px;
  border-radius: 3px;
}
.cp-match {
  color: var(--accent);
  font-weight: bold;
}
#command-palette-footer {
  padding: 4px 14px;
  color: var(--text-ghost);
  font-size: 11px;
  border-top: 1px solid var(--palette-separator, var(--border));
}
```

- [ ] **Step 3: Add palette CSS variables to each theme in constants.ts**

In each theme's `css` object in `THEMES` array (`client/js/core/constants.ts`), add palette-specific variables. Example for `cyber` theme:

```typescript
'--palette-bg': '#0d0d18',
'--palette-border': '#1e1e38',
'--palette-input-bg': '#111120',
'--palette-hover': 'rgba(0, 255, 229, 0.08)',
'--palette-separator': '#1e1e38',
'--palette-category': '#00ffe5',
```

Repeat for each theme (matrix, amber, frost, blood, violet) using their accent colors. The fallbacks in CSS already reference `var(--bg-deep)` etc., so themes that don't define palette-specific vars will still work.

- [ ] **Step 4: Verify build + visual check**

Run: `npm run build`
Expected: No errors. Open browser to verify overlay HTML is present in DOM.

- [ ] **Step 5: Commit**

```bash
git add client/index.html client/styles.css client/js/core/constants.ts
git commit -m "feat(command-palette): add HTML overlay and CSS styles"
```

---

### Task 5: Theme preview support

**Files:**
- Modify: `client/js/ui/themes.ts`

This must be done before the palette UI module, since the palette calls `applyTheme(theme, true)`.

- [ ] **Step 1: Add preview flag to applyTheme()**

Modify `applyTheme` to accept an optional `preview` parameter:

```typescript
export function applyTheme(t, preview = false) {
  S.currentTheme = t;
  document.body.className = '';
  if (t.css) {
    const root = document.documentElement;
    for (const [prop, val] of Object.entries(t.css)) {
      root.style.setProperty(prop, val as string);
    }
  }
  terminalMap.forEach(({ term }) => {
    term.options.theme = t.term;
  });
  if (!preview) {
    updateSwatches();
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: No errors. Existing `applyTheme(t)` calls still work (default `preview = false`).

- [ ] **Step 3: Commit**

```bash
git add client/js/ui/themes.ts
git commit -m "feat(command-palette): add preview mode to applyTheme"
```

---

### Task 6: Command Palette UI Module

**Files:**
- Create: `client/js/ui/command-palette.ts`

This is the largest task. The module handles: opening/closing, mode switching, fuzzy search, keyboard navigation, rendering, and theme preview sublist.

- [ ] **Step 1: Create command-palette.ts with core open/close logic**

```typescript
// client/js/ui/command-palette.ts
import { S, sessionMeta } from '../core/state';
import { getCommands, executeCommand, getRecentCommands, getCommand } from '../core/command-registry';
import { THEMES } from '../core/constants';
import { applyTheme } from './themes';

type PaletteMode = 'quick-open' | 'command' | 'theme';

let overlay: HTMLElement;
let input: HTMLInputElement;
let list: HTMLElement;
let footer: HTMLElement;

let mode: PaletteMode = 'quick-open';
let activeIndex = 0;
let currentItems: PaletteItem[] = [];
let savedTheme: any = null; // for theme preview restore

interface PaletteItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  icon?: string;
  meta?: string; // e.g. CWD for sessions
  matchPositions?: number[];
  execute: () => void;
}

export function initCommandPalette() {
  overlay = document.getElementById('command-palette-overlay')!;
  input = document.getElementById('command-palette-input') as HTMLInputElement;
  list = document.getElementById('command-palette-list')!;
  footer = document.getElementById('command-palette-footer')!;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePalette();
  });

  input.addEventListener('input', () => onInput());
  input.addEventListener('keydown', (e) => onKeydown(e));
}

export function openPalette(initialMode: 'quick-open' | 'command' = 'quick-open') {
  mode = initialMode;
  activeIndex = 0;
  overlay.classList.add('open');
  input.value = initialMode === 'command' ? '> ' : '';
  input.focus();
  onInput();
}

export function closePalette() {
  overlay.classList.remove('open');
  input.value = '';
  currentItems = [];
  list.innerHTML = '';
  // Restore theme if in theme preview mode
  if (mode === 'theme' && savedTheme) {
    applyTheme(savedTheme);
    savedTheme = null;
  }
  mode = 'quick-open';
}

export function isPaletteOpen(): boolean {
  return overlay.classList.contains('open');
}
```

- [ ] **Step 2: Add fuzzy search function**

Add to command-palette.ts:

```typescript
interface FuzzyResult {
  score: number;
  positions: number[];
}

function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const lq = query.toLowerCase();
  const lt = text.toLowerCase();
  let qi = 0;
  let score = 0;
  const positions: number[] = [];
  let prevMatch = -1;

  for (let ti = 0; ti < lt.length && qi < lq.length; ti++) {
    if (lt[ti] === lq[qi]) {
      positions.push(ti);
      // Consecutive match bonus
      if (prevMatch === ti - 1) score += 5;
      // Word start bonus
      if (ti === 0 || /[\s_\-.]/.test(text[ti - 1])) score += 10;
      // Exact case bonus
      if (text[ti] === query[qi]) score += 1;
      score += 1;
      prevMatch = ti;
      qi++;
    }
  }

  if (qi < lq.length) return null; // not all chars matched
  return { score, positions };
}

function highlightMatch(text: string, positions: number[]): string {
  if (!positions.length) return escapeHtml(text);
  let result = '';
  let last = 0;
  for (const pos of positions) {
    result += escapeHtml(text.slice(last, pos));
    result += `<span class="cp-match">${escapeHtml(text[pos])}</span>`;
    last = pos + 1;
  }
  result += escapeHtml(text.slice(last));
  return result;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 3: Add item building functions**

Add to command-palette.ts:

```typescript
function buildCommandItems(query: string): PaletteItem[] {
  const commands = getCommands();
  const kb = S.settings?.keybindings || {};
  const items: (PaletteItem & { score: number })[] = [];

  for (const cmd of commands) {
    if (!cmd.category) continue; // skip bare registerAction() wrappers without category
    const match = query ? fuzzyMatch(query, cmd.label) : { score: 0, positions: [] };
    if (!match && query) continue;
    items.push({
      id: cmd.id,
      label: cmd.label,
      category: cmd.category,
      shortcut: kb[cmd.id] ? formatShortcut(kb[cmd.id]) : undefined,
      matchPositions: match?.positions || [],
      score: match?.score || 0,
      execute: () => executeCommand(cmd.id),
    });
  }

  if (query) {
    items.sort((a, b) => b.score - a.score);
  }
  return items;
}

function buildQuickOpenItems(query: string): PaletteItem[] {
  const items: (PaletteItem & { score: number })[] = [];

  // Sessions
  sessionMeta.forEach((meta, id) => {
    const label = meta.name || id;
    const match = query ? fuzzyMatch(query, label) : { score: 0, positions: [] };
    if (!match && query) return;
    items.push({
      id: `session:${id}`,
      label,
      category: 'Session',
      meta: meta.cwd || '',
      icon: meta.ai ? '✦' : '⬚',
      matchPositions: match?.positions || [],
      score: match?.score || 0,
      execute: () => {
        // Import dynamically to avoid circular deps
        import('../terminal/session').then(({ activateSession }) => {
          activateSession(id);
          import('../core/websocket').then(({ wsSend }) => {
            wsSend({ type: 'session_attach', sessionId: id });
          });
        });
      },
    });
  });

  // Open file tabs
  const fileTabs = document.querySelectorAll('.tab[data-file-path]');
  fileTabs.forEach((tab) => {
    const filePath = (tab as HTMLElement).dataset.filePath!;
    const fileName = filePath.split('/').pop() || filePath;
    const match = query ? fuzzyMatch(query, fileName) : { score: 0, positions: [] };
    if (!match && query) return;
    items.push({
      id: `file:${filePath}`,
      label: fileName,
      category: 'File',
      meta: filePath,
      icon: '📄',
      matchPositions: match?.positions || [],
      score: match?.score || 0,
      execute: () => {
        const clickEvt = new MouseEvent('click');
        tab.dispatchEvent(clickEvt);
      },
    });
  });

  if (query) {
    items.sort((a, b) => b.score - a.score);
  }
  return items;
}

function buildThemeItems(query: string): PaletteItem[] {
  return THEMES
    .map((t) => {
      const match = query ? fuzzyMatch(query, t.label) : { score: 0, positions: [] };
      if (!match && query) return null;
      return {
        id: `theme:${t.id}`,
        label: t.label,
        category: 'Theme',
        matchPositions: match?.positions || [],
        score: match?.score || 0,
        execute: () => {
          applyTheme(t);
          savedTheme = null; // confirmed choice
          // Save to settings
          if (S.pendingSettings) {
            S.pendingSettings.appearance.theme = t.id;
          }
          if (S.settings) {
            S.settings.appearance.theme = t.id;
          }
        },
      } as PaletteItem & { score: number };
    })
    .filter(Boolean)
    .sort((a, b) => (b as any).score - (a as any).score) as PaletteItem[];
}

function formatShortcut(combo: string): string {
  return combo
    .replace('Meta', '⌘')
    .replace('Ctrl', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace(/\+/g, '');
}
```

- [ ] **Step 4: Add input handler with mode detection**

Add to command-palette.ts:

```typescript
function onInput() {
  const raw = input.value;

  // Mode detection: ">" prefix switches to command mode
  if (mode !== 'theme') {
    if (raw.startsWith('> ') || raw === '>') {
      mode = 'command';
    } else if (!raw.startsWith('>')) {
      mode = 'quick-open';
    }
  }

  const query = mode === 'command' ? raw.replace(/^>\s*/, '') : raw;

  let items: PaletteItem[];
  if (mode === 'theme') {
    items = buildThemeItems(query);
  } else if (mode === 'command') {
    items = buildCommandItems(query);
  } else {
    items = buildQuickOpenItems(query);
  }

  // Prepend recent commands (command mode only, no query)
  if (mode === 'command' && !query) {
    const recentIds = getRecentCommands();
    const recentItems: PaletteItem[] = [];
    for (const rid of recentIds) {
      const existing = items.find((i) => i.id === rid);
      if (existing) {
        recentItems.push({ ...existing, category: '최근 사용' });
      }
    }
    if (recentItems.length) {
      items = [...recentItems, ...items];
    }
  }

  currentItems = items;
  activeIndex = 0;
  renderList();
}
```

- [ ] **Step 5: Add rendering**

Add to command-palette.ts:

```typescript
function renderList() {
  let html = '';
  let lastCategory = '';

  for (let i = 0; i < currentItems.length; i++) {
    const item = currentItems[i];
    if (item.category !== lastCategory) {
      html += `<div class="cp-section-label">${escapeHtml(item.category)}</div>`;
      lastCategory = item.category;
    }
    const activeClass = i === activeIndex ? ' active' : '';
    const labelHtml = item.matchPositions?.length
      ? highlightMatch(item.label, item.matchPositions)
      : escapeHtml(item.label);
    const shortcutHtml = item.shortcut
      ? `<span class="cp-item-shortcut">${escapeHtml(item.shortcut)}</span>`
      : '';
    const metaHtml = item.meta
      ? `<span class="cp-item-shortcut">${escapeHtml(item.meta)}</span>`
      : '';

    html += `<div class="cp-item${activeClass}" data-index="${i}">
      <div class="cp-item-label">
        ${item.icon ? `<span>${item.icon}</span>` : ''}
        <span>${labelHtml}</span>
      </div>
      ${shortcutHtml || metaHtml}
    </div>`;
  }

  list.innerHTML = html;
  footer.textContent = `${currentItems.length}개 결과`;

  // Click handlers
  list.querySelectorAll('.cp-item').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt((el as HTMLElement).dataset.index!);
      selectItem(idx);
    });
    el.addEventListener('mouseenter', () => {
      const idx = parseInt((el as HTMLElement).dataset.index!);
      setActive(idx);
    });
  });
}

function setActive(idx: number) {
  activeIndex = idx;
  list.querySelectorAll('.cp-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  // Scroll active item into view
  const activeEl = list.querySelector('.cp-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });

  // Theme preview on hover
  if (mode === 'theme' && currentItems[idx]) {
    const themeId = currentItems[idx].id.replace('theme:', '');
    const theme = THEMES.find((t) => t.id === themeId);
    if (theme) applyTheme(theme, true);
  }
}

function selectItem(idx: number) {
  const item = currentItems[idx];
  if (!item) return;

  // Special: "Change Theme" command enters theme sublist
  if (item.id === 'ui:changeTheme') {
    mode = 'theme';
    savedTheme = S.currentTheme;
    input.value = '';
    input.placeholder = '테마 선택...';
    onInput();
    return;
  }

  closePalette();
  item.execute();
}
```

- [ ] **Step 6: Add keyboard navigation**

Add to command-palette.ts:

```typescript
function onKeydown(e: KeyboardEvent) {
  e.stopPropagation(); // Prevent bubbling to main.ts keydown handler

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, currentItems.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
      break;
    case 'Enter':
      e.preventDefault();
      selectItem(activeIndex);
      break;
    case 'Escape':
      e.preventDefault();
      closePalette();
      break;
  }
}
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add client/js/ui/command-palette.ts
git commit -m "feat(command-palette): add palette UI module with fuzzy search"
```

---

### Task 7: Wire up palette in main.ts

**Files:**
- Modify: `client/js/core/main.ts`

- [ ] **Step 1: Import and initialize palette**

At the top of `main.ts`, add import:

```typescript
import { initCommandPalette, openPalette, closePalette, isPaletteOpen } from '../ui/command-palette';
```

- [ ] **Step 2: Register palette actions**

After the existing `registerAction` calls (around line 299), add:

```typescript
registerAction('openPalette', () => {
  isPaletteOpen() ? closePalette() : openPalette('quick-open');
});
registerAction('openCommandPalette', () => {
  isPaletteOpen() ? closePalette() : openPalette('command');
});
```

- [ ] **Step 3: Update Esc handler to prioritize palette**

In the `document.addEventListener('keydown', ...)` handler, add palette check as the first Esc handler (before session-picker check at line 308):

```typescript
if (e.key === 'Escape') {
  if (isPaletteOpen()) {
    closePalette();
    return;
  }
  // ... existing session-picker, plan modal, settings checks ...
}
```

- [ ] **Step 4: Add early return when palette is open**

**Before** the existing `if (isPlanModalOpen()) return;` line (line 323), add:

```typescript
if (isPaletteOpen()) return;
```

This must come before `isPlanModalOpen()` to match the Esc priority chain (palette > plan modal). This prevents other keybindings from firing while the palette is open (keyboard events are handled by the palette's own `onKeydown`).

- [ ] **Step 5: Call initCommandPalette() in the DOMContentLoaded or init block**

Find where other init functions are called (like `initSettingsUI()`, `initFolderDnD()`, etc.) and add:

```typescript
initCommandPalette();
```

- [ ] **Step 6: Verify build and test**

Run: `npm run build && npm run dev`
Expected: Build succeeds. In browser, Cmd+P opens quick-open palette, Cmd+Shift+P opens command palette.

- [ ] **Step 7: Commit**

```bash
git add client/js/core/main.ts
git commit -m "feat(command-palette): wire up palette in main entry point"
```

---

### Task 8: Register extended commands from modules

**Files:**
- Modify: `client/js/core/main.ts` (or each module individually)

- [ ] **Step 1: Register commands with full metadata**

After the existing `registerAction()` calls, register all commands with proper categories using `registerCommand()` directly. This gives them full metadata that the palette can display:

```typescript
import { registerCommand } from './command-registry';

// Override the bare registerAction calls with full metadata
// Session commands
registerCommand({ id: 'newSession', label: 'New Session', category: 'Session', execute: () => newSession() });
registerCommand({ id: 'closeTab', label: 'Close Tab', category: 'Session', execute: closeTabAction });
registerCommand({ id: 'renameSession', label: 'Rename Session', category: 'Session', execute: () => { if (S.activeSessionId) promptRenameSession(S.activeSessionId); }, when: () => !!S.activeSessionId });
registerCommand({ id: 'nextTab', label: 'Next Tab', category: 'Session', execute: () => switchTabBy(1) });
registerCommand({ id: 'prevTab', label: 'Previous Tab', category: 'Session', execute: () => switchTabBy(-1) });

// Terminal commands
registerCommand({ id: 'clearTerminal', label: 'Clear Terminal', category: 'Terminal', execute: () => clearActiveTerminal(), when: () => !!S.activeSessionId });
registerCommand({ id: 'toggleInputPanel', label: 'Toggle Input Panel', category: 'Terminal', execute: () => toggleInputPanel() });

// UI commands
registerCommand({ id: 'toggleSidebar', label: 'Toggle Sidebar', category: 'UI', execute: () => toggleSidebarExport() });
registerCommand({ id: 'openSettings', label: 'Open Settings', category: 'UI', execute: () => openSettings() });
registerCommand({ id: 'fullscreen', label: 'Toggle Fullscreen', category: 'UI', execute: () => toggleFullscreen() });
registerCommand({ id: 'focusSearch', label: 'Focus Search', category: 'UI', execute: () => switchPanel('search') });
registerCommand({ id: 'focusExplorer', label: 'Focus Explorer', category: 'UI', execute: () => switchPanel('explorer') });
registerCommand({ id: 'focusSourceControl', label: 'Focus Source Control', category: 'UI', execute: () => switchPanel('source-control') });
registerCommand({ id: 'ui:changeTheme', label: 'Change Theme', category: 'UI', execute: () => {} }); // Handled specially by palette

// Git commands
registerCommand({ id: 'gitGraph', label: 'Git Graph', category: 'Git', execute: () => { isGitGraphOpen() ? closeGitGraph() : openGitGraph(); } });
registerCommand({ id: 'git:status', label: 'Git: Status', category: 'Git', execute: () => { switchPanel('source-control'); } });
registerCommand({ id: 'git:commit', label: 'Git: Commit', category: 'Git', execute: () => { switchPanel('source-control'); /* Focus commit input after panel switch */ setTimeout(() => { const commitInput = document.getElementById('sc-commit-msg'); if (commitInput) commitInput.focus(); }, 100); } });
registerCommand({ id: 'git:push', label: 'Git: Push', category: 'Git', execute: () => { import('../core/websocket').then(({ wsSend }) => wsSend({ type: 'git_push' })); } });
registerCommand({ id: 'git:pull', label: 'Git: Pull', category: 'Git', execute: () => { import('../core/websocket').then(({ wsSend }) => wsSend({ type: 'git_pull' })); } });

// File commands
registerCommand({ id: 'file:newFile', label: 'New File', category: 'File', execute: () => { switchPanel('explorer'); import('../sidebar/explorer').then((m) => { if (m.createNewFile) m.createNewFile(); }); } });
registerCommand({ id: 'file:newFolder', label: 'New Folder', category: 'File', execute: () => { switchPanel('explorer'); import('../sidebar/explorer').then((m) => { if (m.createNewFolder) m.createNewFolder(); }); } });
registerCommand({ id: 'file:revealInFinder', label: 'Reveal in Finder', category: 'File', execute: () => { const meta = sessionMeta.get(S.activeSessionId); const cwd = meta?.cwd || ''; import('../core/websocket').then(({ apiFetch }) => apiFetch('/api/reveal-in-finder', { method: 'POST', body: JSON.stringify({ path: cwd }) })); }, when: () => !!S.activeSessionId });

// Plan
registerCommand({ id: 'planModal', label: 'Plan Notes', category: 'Plan', execute: () => { isPlanModalOpen() ? closePlanModal() : openPlanModal(); } });

// Palette itself
registerCommand({ id: 'openPalette', label: 'Quick Open', category: 'UI', execute: () => { isPaletteOpen() ? closePalette() : openPalette('quick-open'); } });
registerCommand({ id: 'openCommandPalette', label: 'Command Palette', category: 'UI', execute: () => { isPaletteOpen() ? closePalette() : openPalette('command'); } });
```

Note: Since `registerCommand` and `registerAction` both write to the same registry, calling `registerCommand` after `registerAction` for the same ID will overwrite with the full metadata version. This is the intended migration path — existing `registerAction` calls can be removed later.

- [ ] **Step 2: Remove duplicate registerAction calls**

Remove the old `registerAction()` calls for the same IDs that are now registered via `registerCommand()`. This avoids double-registration.

- [ ] **Step 3: Verify build and test all commands appear**

Run: `npm run build && npm run dev`
Expected: Build succeeds. Cmd+Shift+P shows all commands with categories. Cmd+P shows sessions/files.

- [ ] **Step 4: Commit**

```bash
git add client/js/core/main.ts
git commit -m "feat(command-palette): register all commands with full metadata"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 2: Manual testing checklist**

Run: `npm run dev` and verify in browser:

1. **Cmd+P** opens quick-open mode — shows sessions and file tabs
2. **Cmd+Shift+P** opens command mode — shows all commands with categories
3. Typing `>` in Cmd+P mode switches to command mode
4. Deleting `>` switches back to quick-open mode
5. **Fuzzy search** works — "ns" finds "New Session"
6. **↑↓** navigates, **Enter** executes, **Esc** closes
7. **Shortcuts displayed** correctly next to commands
8. **Recent commands** appear at top after executing some commands
9. **Change Theme** enters sublist — hover/↑↓ previews, Enter confirms, Esc restores
10. Clicking outside palette closes it
11. Existing keybindings still work (Ctrl+Shift+T, Ctrl+W, etc.)
12. **Settings UI** shows new palette keybindings and they are rebindable

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(command-palette): polish and bug fixes"
```
