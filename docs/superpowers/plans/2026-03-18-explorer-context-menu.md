# Explorer Context Menu Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable ContextMenu component and enhance the Explorer with folder session launching (Terminal/Claude/OpenCode/Gemini/Codex), Copy Path, and Duplicate actions.

**Architecture:** New `ContextMenu` class dynamically creates DOM menus with `when` predicates for conditional items. Explorer migrates from static HTML to this class. Server gets `cwd` passthrough on `session_create` and a new `file_duplicate` message type backed by `duplicateFile()` in git-service.

**Tech Stack:** Vanilla JS (ES6 modules), node-pty, WebSocket (ws), Express, TypeScript (server)

**Spec:** `docs/superpowers/specs/2026-03-18-explorer-context-menu-design.md`

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `client/js/context-menu.js` | Reusable ContextMenu class | **Create** |
| `client/js/explorer.js` | Explorer panel — migrate to ContextMenu, add new handlers | **Modify** |
| `client/index.html` | Remove static `explorer-ctx-menu` div, add `context-menu.js` script | **Modify** |
| `server/git-service.ts` | Add `duplicateFile()` function | **Modify** |
| `server/index.ts` | Pass `cwd`/`cmd` on `session_create`, add `file_duplicate` handler | **Modify** |

---

### Task 1: Create ContextMenu Component

**Files:**
- Create: `client/js/context-menu.js`

- [ ] **Step 1: Create the ContextMenu class**

Create `client/js/context-menu.js` with the following content:

```js
// ─── REUSABLE CONTEXT MENU ──────────────────────────────────────
export class ContextMenu {
  /**
   * @param {Array<{label:string, action:string, danger?:boolean, when?:(ctx:any)=>boolean}|'---'>} items
   * @param {(action:string, context:any)=>void} handler
   */
  constructor(items, handler) {
    this._items = items;
    this._handler = handler;
    this._el = null;
    this._onDocClick = () => this.hide();
  }

  show(event, context) {
    event.preventDefault();
    event.stopPropagation();
    this.hide(); // remove previous

    // Filter items by `when` predicate
    const visible = this._items.filter(it =>
      it === '---' || !it.when || it.when(context)
    );

    // Collapse adjacent/leading/trailing separators
    const cleaned = [];
    for (let i = 0; i < visible.length; i++) {
      if (visible[i] === '---') {
        if (cleaned.length === 0) continue; // leading
        if (cleaned[cleaned.length - 1] === '---') continue; // adjacent
        cleaned.push(visible[i]);
      } else {
        cleaned.push(visible[i]);
      }
    }
    // Remove trailing separator
    if (cleaned.length && cleaned[cleaned.length - 1] === '---') cleaned.pop();

    if (cleaned.length === 0) return;

    // Build DOM
    const menu = document.createElement('div');
    menu.className = 'ctx-menu visible';

    for (const it of cleaned) {
      if (it === '---') {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
      } else {
        const item = document.createElement('div');
        item.className = 'ctx-item' + (it.danger ? ' danger' : '');
        item.textContent = it.label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hide();
          this._handler(it.action, context);
        });
        menu.appendChild(item);
      }
    }

    // Position
    document.body.appendChild(menu);
    this._el = menu;

    // Viewport boundary check
    const rect = menu.getBoundingClientRect();
    let x = event.clientX;
    let y = event.clientY;
    if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
    if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // Close on outside click (next tick to avoid immediate trigger)
    requestAnimationFrame(() => {
      document.addEventListener('click', this._onDocClick);
    });
  }

  hide() {
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    document.removeEventListener('click', this._onDocClick);
  }
}
```

- [ ] **Step 2: Verify the file is syntactically valid**

Run: `node -c client/js/context-menu.js`
Expected: no syntax errors

- [ ] **Step 3: Commit**

```bash
git add client/js/context-menu.js
git commit -m "feat: add reusable ContextMenu component"
```

---

### Task 2: Add `duplicateFile()` to git-service.ts

**Files:**
- Modify: `server/git-service.ts:411` (after `deleteFile` function)

- [ ] **Step 1: Add duplicateFile function**

Insert after the `deleteFile` function (after line 411) in `server/git-service.ts`:

```typescript
export function duplicateFile(cwd: string, filePath: string): { ok: boolean; error?: string } {
  const path = require('path') as typeof import('path');
  const fs = require('fs') as typeof import('fs');
  const fullPath = path.resolve(cwd, filePath);
  if (!fullPath.startsWith(path.resolve(cwd))) return { ok: false, error: 'Access denied' };
  try {
    if (!fs.existsSync(fullPath)) return { ok: false, error: 'File not found' };
    const stat = fs.statSync(fullPath);
    const dir = path.dirname(fullPath);
    const baseName = path.basename(fullPath);

    // Split name and extension (last dot only)
    let nameWithoutExt: string;
    let ext: string;
    if (stat.isDirectory()) {
      nameWithoutExt = baseName;
      ext = '';
    } else {
      const dotIdx = baseName.lastIndexOf('.');
      // Handle dotfiles (.gitignore) and no-extension files (Makefile)
      if (dotIdx <= 0) {
        nameWithoutExt = baseName;
        ext = '';
      } else {
        nameWithoutExt = baseName.slice(0, dotIdx);
        ext = baseName.slice(dotIdx); // includes the dot
      }
    }

    // Find unique name: "name copy.ext", "name copy 2.ext", ...
    let copyPath: string;
    const candidate = `${nameWithoutExt} copy${ext}`;
    copyPath = path.join(dir, candidate);
    if (fs.existsSync(copyPath)) {
      let n = 2;
      while (fs.existsSync(path.join(dir, `${nameWithoutExt} copy ${n}${ext}`))) n++;
      copyPath = path.join(dir, `${nameWithoutExt} copy ${n}${ext}`);
    }

    if (stat.isDirectory()) {
      fs.cpSync(fullPath, copyPath, { recursive: true });
    } else {
      fs.copyFileSync(fullPath, copyPath);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}
```

- [ ] **Step 2: Build TypeScript to check for errors**

Run: `npx tsc --noEmit` (from project root)
Expected: no errors related to `duplicateFile`

- [ ] **Step 3: Commit**

```bash
git add server/git-service.ts
git commit -m "feat: add duplicateFile() to git-service"
```

---

### Task 3: Update server `session_create` handler to pass `cwd` and add `file_duplicate` handler

**Files:**
- Modify: `server/index.ts:613-624` (session_create handler)
- Modify: `server/index.ts:914` (after file_delete handler, add file_duplicate)

- [ ] **Step 1: Update `session_create` to pass `cwd` and `cmd`**

In `server/index.ts`, change the `session_create` handler (around line 613-624):

**Before:**
```typescript
    if (parsed.type === 'session_create') {
      const id = `session-${Date.now()}`;
      const nameFormat = currentSettings.shell.sessionNameFormat || 'shell-{n}';
      const name = (parsed.name as string) || nameFormat.replace('{n}', String(sessions.size + 1));
      const sess = createSession(id, name);
```

**After:**
```typescript
    if (parsed.type === 'session_create') {
      const id = `session-${Date.now()}`;
      const nameFormat = currentSettings.shell.sessionNameFormat || 'shell-{n}';
      const name = (parsed.name as string) || nameFormat.replace('{n}', String(sessions.size + 1));
      const sess = createSession(id, name, parsed.cwd as string | undefined);
```

This passes `parsed.cwd` as the `restoreCwd` parameter. The existing `cmd` handling on lines 619-621 already works.

- [ ] **Step 2: Add `file_duplicate` handler**

Insert after the `file_delete` handler block (after line 914) in `server/index.ts`:

```typescript
    } else if (parsed.type === 'file_duplicate') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const result = gitService.duplicateFile(session.cwd, parsed.filePath as string);
      ws.send(JSON.stringify({ type: 'file_op_ack', sessionId: id, op: 'duplicate', ...result }));
```

- [ ] **Step 3: Build TypeScript to check for errors**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: pass cwd on session_create, add file_duplicate handler"
```

---

### Task 4: Migrate Explorer to ContextMenu and add new actions

**Files:**
- Modify: `client/js/explorer.js`

- [ ] **Step 1: Replace static menu code with ContextMenu**

Replace the entire `client/js/explorer.js` content. The key changes:

1. Import `ContextMenu` from `./context-menu.js`
2. Define menu items with `when` predicates for directory-only items
3. Replace `showExplorerCtx` with `explorerMenu.show()`
4. Add handlers for `open-terminal`, `open-claude`, `open-opencode`, `open-gemini`, `open-codex`, `copy-path`, `duplicate`
5. Remove references to `explorer-ctx-menu` DOM element

**Full replacement for `client/js/explorer.js`:**

```js
// ─── FILE EXPLORER PANEL ─────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { showToast } from './toast.js';
import { openFileTab } from './file-viewer.js';
import { ContextMenu } from './context-menu.js';

let explorerTree = [];
let expandedDirs = new Set();
let currentDir = '';
let gitStatusMap = {}; // { relativePath: status }

const isDir = (ctx) => ctx.type === 'directory';

const explorerMenu = new ContextMenu([
  { label: '📄 New File',            action: 'new-file' },
  { label: '📁 New Folder',          action: 'new-folder' },
  '---',
  { label: '▶ Open Terminal Here',   action: 'open-terminal',  when: isDir },
  { label: '▶ Open with Claude',     action: 'open-claude',    when: isDir },
  { label: '▶ Open with OpenCode',   action: 'open-opencode',  when: isDir },
  { label: '▶ Open with Gemini',     action: 'open-gemini',    when: isDir },
  { label: '▶ Open with Codex',      action: 'open-codex',     when: isDir },
  '---',
  { label: '📋 Copy Path',           action: 'copy-path' },
  { label: '📑 Duplicate',           action: 'duplicate' },
  '---',
  { label: '✎ Rename',              action: 'rename' },
  { label: '✕ Delete',              action: 'delete', danger: true },
], handleExplorerAction);

function getAbsPath(relPath) {
  const meta = sessionMeta.get(S.activeSessionId);
  if (!meta?.cwd) return relPath;
  return meta.cwd.replace(/\/+$/, '') + '/' + relPath;
}

function getDirPath(path, type) {
  return type === 'directory' ? path : path.split('/').slice(0, -1).join('/');
}

function handleExplorerAction(action, ctx) {
  if (!S.activeSessionId) return;

  switch (action) {
    case 'new-file': {
      const name = prompt('New file name:');
      if (!name) return;
      const dir = getDirPath(ctx.path, ctx.type);
      const filePath = dir ? `${dir}/${name}` : name;
      wsSend({ type: 'file_create', sessionId: S.activeSessionId, filePath, isDir: false });
      break;
    }
    case 'new-folder': {
      const name = prompt('New folder name:');
      if (!name) return;
      const dir = getDirPath(ctx.path, ctx.type);
      const filePath = dir ? `${dir}/${name}` : name;
      wsSend({ type: 'file_create', sessionId: S.activeSessionId, filePath, isDir: true });
      break;
    }
    case 'open-terminal': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Shell', cwd: absPath });
      break;
    }
    case 'open-claude': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Claude', cwd: absPath, cmd: 'claude' });
      break;
    }
    case 'open-opencode': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'OpenCode', cwd: absPath, cmd: 'opencode' });
      break;
    }
    case 'open-gemini': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Gemini', cwd: absPath, cmd: 'gemini' });
      break;
    }
    case 'open-codex': {
      const absPath = getAbsPath(ctx.path);
      wsSend({ type: 'session_create', name: 'Codex', cwd: absPath, cmd: 'codex' });
      break;
    }
    case 'copy-path': {
      const absPath = getAbsPath(ctx.path);
      navigator.clipboard.writeText(absPath).catch(() => {});
      showToast('Path copied', 'success');
      break;
    }
    case 'duplicate': {
      wsSend({ type: 'file_duplicate', sessionId: S.activeSessionId, filePath: ctx.path });
      break;
    }
    case 'rename': {
      const oldName = ctx.path.split('/').pop();
      const newName = prompt('Rename to:', oldName);
      if (!newName || newName === oldName) return;
      const dir = ctx.path.split('/').slice(0, -1).join('/');
      const newPath = dir ? `${dir}/${newName}` : newName;
      wsSend({ type: 'file_rename', sessionId: S.activeSessionId, oldPath: ctx.path, newPath });
      break;
    }
    case 'delete': {
      const name = ctx.path.split('/').pop();
      if (!confirm(`Delete "${name}"?`)) return;
      wsSend({ type: 'file_delete', sessionId: S.activeSessionId, filePath: ctx.path });
      break;
    }
  }
}

export function initExplorer() {
  // No static menu setup needed — ContextMenu handles everything dynamically
}

export function requestFileTree() {
  if (!S.activeSessionId) return;
  const meta = sessionMeta.get(S.activeSessionId);
  const dir = meta?.cwd || '';
  if (!dir) return;
  currentDir = dir;
  wsSend({ type: 'file_tree', sessionId: S.activeSessionId, dir });
}

export function handleFileTreeData(msg) {
  explorerTree = msg.tree || [];
  currentDir = msg.dir || '';
  gitStatusMap = msg.gitStatus || {};
  renderExplorer();
}

function renderExplorer() {
  const container = document.getElementById('explorer-tree');
  if (!container) return;

  const headerPath = document.getElementById('explorer-path');
  if (headerPath) {
    const parts = currentDir.split('/');
    headerPath.textContent = parts[parts.length - 1] || currentDir;
    headerPath.title = currentDir;
  }

  if (explorerTree.length === 0) {
    container.innerHTML = '<div class="explorer-empty">No files found</div>';
    return;
  }

  container.innerHTML = '';
  renderTreeLevel(container, explorerTree, 0);
}

function renderTreeLevel(parent, entries, depth) {
  for (const entry of entries) {
    const item = document.createElement('div');
    item.className = 'explorer-item' + (entry.type === 'directory' ? ' is-dir' : '');
    item.style.paddingLeft = (12 + depth * 16) + 'px';
    item.dataset.path = entry.path;

    if (entry.type === 'directory') {
      const isExpanded = expandedDirs.has(entry.path);
      const dirHasChanges = hasDirChanges(entry.path);
      item.innerHTML = `<span class="explorer-arrow">${isExpanded ? '▾' : '▸'}</span>` +
        `<span class="explorer-icon">📁</span>` +
        `<span class="explorer-name">${escHtml(entry.name)}</span>` +
        (dirHasChanges ? `<span class="explorer-git-dot"></span>` : '');
      item.addEventListener('click', () => {
        if (expandedDirs.has(entry.path)) {
          expandedDirs.delete(entry.path);
        } else {
          expandedDirs.add(entry.path);
        }
        renderExplorer();
      });
      item.addEventListener('contextmenu', (e) => explorerMenu.show(e, { path: entry.path, type: 'directory' }));
      parent.appendChild(item);

      if (isExpanded && entry.children) {
        renderTreeLevel(parent, entry.children, depth + 1);
      }
    } else {
      const icon = getFileIcon(entry.name);
      const status = gitStatusMap[entry.path];
      const statusBadge = status ? `<span class="explorer-git-badge explorer-git-${getGitClass(status)}">${getGitLabel(status)}</span>` : '';
      item.innerHTML = `<span class="explorer-arrow" style="visibility:hidden">▸</span>` +
        `<span class="explorer-icon">${icon}</span>` +
        `<span class="explorer-name${status ? ' explorer-git-' + getGitClass(status) + '-name' : ''}">${escHtml(entry.name)}</span>` +
        statusBadge;
      item.addEventListener('click', () => {
        if (!S.activeSessionId) return;
        wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath: entry.path });
      });
      item.addEventListener('contextmenu', (e) => explorerMenu.show(e, { path: entry.path, type: 'file' }));
      parent.appendChild(item);
    }
  }
}

function getFileIcon(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  const iconMap = {
    js: '📜', ts: '📘', jsx: '⚛', tsx: '⚛',
    json: '{}', md: '📝', css: '🎨', html: '🌐',
    py: '🐍', rs: '🦀', go: '🐹', rb: '💎',
    sh: '$_', yml: '⚙', yaml: '⚙', toml: '⚙',
    png: '🖼', jpg: '🖼', gif: '🖼', svg: '🖼', webp: '🖼',
    lock: '🔒',
  };
  return iconMap[ext] || '📄';
}

function getGitClass(status) {
  const map = { 'M': 'modified', 'A': 'added', 'D': 'deleted', 'R': 'renamed', 'U': 'untracked', '?': 'untracked' };
  return map[status] || 'modified';
}

function getGitLabel(status) {
  const map = { 'M': 'M', 'A': 'A', 'D': 'D', 'R': 'R', 'U': 'U', '?': 'U' };
  return map[status] || status;
}

function hasDirChanges(dirPath) {
  const prefix = dirPath + '/';
  return Object.keys(gitStatusMap).some(p => p === dirPath || p.startsWith(prefix));
}

export function handleFileOpAck(msg) {
  if (msg.ok) {
    requestFileTree();
    showToast(`File ${msg.op} successful`, 'success');
  } else {
    showToast(`File ${msg.op} failed: ${msg.error}`, 'error', 4000);
  }
}

export function handleFileReadData(msg) {
  openFileTab(msg.filePath || 'unknown', msg.content || '', {
    binary: msg.binary,
    error: msg.error,
  });
}

export function onExplorerSessionChange() {
  requestFileTree();
}
```

- [ ] **Step 2: Verify syntax**

Run: `node -c client/js/explorer.js`
Expected: no syntax errors

- [ ] **Step 3: Commit**

```bash
git add client/js/explorer.js
git commit -m "feat: migrate Explorer to ContextMenu with new actions"
```

---

### Task 5: Update index.html — remove static menu, add script

**Files:**
- Modify: `client/index.html:308-316` (remove `explorer-ctx-menu` div)

- [ ] **Step 1: Remove the static explorer context menu HTML**

In `client/index.html`, delete lines 308-316 (the `explorer-ctx-menu` block):

```html
<!-- REMOVE THIS ENTIRE BLOCK -->
<!-- EXPLORER CONTEXT MENU -->
<div class="ctx-menu" id="explorer-ctx-menu">
  <div class="ctx-item" id="ectx-new-file">📄 New File</div>
  <div class="ctx-item" id="ectx-new-folder">📁 New Folder</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ectx-rename">✎ Rename</div>
  <div class="ctx-sep"></div>
  <div class="ctx-item danger" id="ectx-delete">✕ Delete</div>
</div>
```

No need to add a `<script>` tag for `context-menu.js` because it's imported as an ES6 module by `explorer.js` — the existing `<script type="module" src="js/main.js">` on line 730 handles module resolution.

- [ ] **Step 2: Commit**

```bash
git add client/index.html
git commit -m "feat: remove static explorer-ctx-menu HTML"
```

---

### Task 6: Build, Smoke Test, and Final Commit

- [ ] **Step 1: Build the TypeScript server**

Run: `npx tsc` (from project root)
Expected: compiles without errors

- [ ] **Step 2: Manual smoke test**

Start the server and test in browser:
1. Right-click a **folder** → should show full menu including "Open Terminal Here", AI tools
2. Right-click a **file** → should show menu WITHOUT terminal/AI items, no double separators
3. Click "Copy Path" → check clipboard has absolute path
4. Click "Duplicate" on a file → verify `name copy.ext` created
5. Click "Open Terminal Here" → verify new session opens in that folder's cwd
6. Click "Open with Claude" → verify new session opens and runs `claude`
7. Existing actions (New File, New Folder, Rename, Delete) still work

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address smoke test issues"
```
