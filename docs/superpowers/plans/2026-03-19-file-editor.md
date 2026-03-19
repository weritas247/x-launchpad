# File Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the read-only File Viewer to a CodeMirror 6-based code editor with read-only default, edit toggle, and WebSocket file saving.

**Architecture:** esbuild bundles CodeMirror 6 + language extensions into a single ESM file (`codemirror-bundle.js`). A new `file-editor.js` module wraps CodeMirror and exposes `window.FileEditor` for the existing non-module `file-viewer.js`. The server gets a `file_save` WebSocket handler with path traversal protection.

**Tech Stack:** CodeMirror 6, esbuild, Express, WebSocket (ws), node-pty sessions

**Spec:** `docs/superpowers/specs/2026-03-19-file-editor-design.md`

---

## File Structure

| File | Role |
|------|------|
| `client/js/codemirror-entry.js` | esbuild entry — re-exports CodeMirror core, extensions, languages |
| `client/js/codemirror-bundle.js` | Generated bundle (gitignored) |
| `client/js/file-editor.js` | CodeMirror wrapper — `createEditor`, `toggleReadOnly`, `getContent`, `destroyEditor`. Exposes `window.FileEditor` |
| `client/js/file-viewer.js` | Modified — replaces highlight.js rendering with CodeMirror, adds edit/save UI |
| `client/styles.css` | Modified — adds CodeMirror theme overrides, edit-mode header styles, removes hljs styles |
| `server/ws-handlers.ts` | Modified — adds `file_save` handler |
| `package.json` | Modified — adds @codemirror deps, esbuild, build:editor script |
| `.gitignore` | Modified — adds `client/js/codemirror-bundle.js` |
| `client/index.html` | Modified — loads `file-editor.js` as `<script type="module">` |

---

### Task 1: Install dependencies and build pipeline

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `client/js/codemirror-entry.js`

- [ ] **Step 1: Install CodeMirror packages and esbuild**

```bash
cd /Users/matthew_team42/dev/cluade-code-my-terminal
npm install @codemirror/state @codemirror/view @codemirror/language @codemirror/commands @codemirror/search @codemirror/lang-javascript @codemirror/lang-python @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-rust @codemirror/lang-cpp @codemirror/lang-java @codemirror/lang-sql @codemirror/lang-xml @codemirror/lang-yaml
npm install -D esbuild
```

- [ ] **Step 2: Add build:editor script to package.json**

In `package.json` `scripts` section, add:

```json
"build:editor": "esbuild client/js/codemirror-entry.js --bundle --format=esm --outfile=client/js/codemirror-bundle.js --minify"
```

Also add to the existing `postinstall` script (append with `&&`):

```json
"postinstall": "npm rebuild node-pty && chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper 2>/dev/null || true && npm run build:editor"
```

- [ ] **Step 3: Add codemirror-bundle.js to .gitignore**

Append to `.gitignore`:

```
client/js/codemirror-bundle.js
```

- [ ] **Step 4: Create codemirror-entry.js**

Create `client/js/codemirror-entry.js` with all CodeMirror re-exports:

```js
// ─── CodeMirror 6 bundle entry ───
// Core
export { EditorState, Compartment } from '@codemirror/state';
export {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor,
} from '@codemirror/view';

// Commands
export {
  defaultKeymap, history, historyKeymap,
  indentWithTab, undo, redo,
} from '@codemirror/commands';

// Search
export {
  searchKeymap, openSearchPanel, search,
  highlightSelectionMatches,
} from '@codemirror/search';

// Language infrastructure
export {
  defaultHighlightStyle, syntaxHighlighting,
  indentOnInput, bracketMatching, foldGutter, foldKeymap,
  LanguageSupport,
} from '@codemirror/language';

// Languages
export { javascript } from '@codemirror/lang-javascript';
export { python } from '@codemirror/lang-python';
export { html } from '@codemirror/lang-html';
export { css } from '@codemirror/lang-css';
export { json } from '@codemirror/lang-json';
export { markdown } from '@codemirror/lang-markdown';
export { rust } from '@codemirror/lang-rust';
export { cpp } from '@codemirror/lang-cpp';
export { java } from '@codemirror/lang-java';
export { sql } from '@codemirror/lang-sql';
export { xml } from '@codemirror/lang-xml';
export { yaml } from '@codemirror/lang-yaml';
```

- [ ] **Step 5: Run the build**

```bash
npm run build:editor
```

Expected: `client/js/codemirror-bundle.js` is generated (should be ~200-400KB minified).

- [ ] **Step 6: Verify bundle loads**

```bash
node -e "import('./client/js/codemirror-bundle.js').then(m => console.log(Object.keys(m).length, 'exports'))"
```

Expected: prints export count (30+).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore client/js/codemirror-entry.js
git commit -m "deps: add CodeMirror 6 + esbuild, create editor bundle entry"
```

---

### Task 2: Create file-editor.js — CodeMirror wrapper module

**Files:**
- Create: `client/js/file-editor.js`
- Modify: `client/index.html`

- [ ] **Step 1: Create file-editor.js**

Create `client/js/file-editor.js` as an ES module that imports from the bundle and exposes `window.FileEditor`:

```js
// ─── FILE EDITOR: CodeMirror 6 wrapper ───
import {
  EditorState, Compartment, EditorView, keymap, lineNumbers,
  highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor,
  defaultKeymap, history, historyKeymap, indentWithTab,
  searchKeymap, openSearchPanel, search, highlightSelectionMatches,
  defaultHighlightStyle, syntaxHighlighting,
  indentOnInput, bracketMatching, foldGutter, foldKeymap,
  javascript, python, html, css, json, markdown,
  rust, cpp, java, sql, xml, yaml,
} from './codemirror-bundle.js';

// ─── Language map (file extension → CodeMirror language function) ───
const LANG_MAP = {
  js: javascript, mjs: javascript, cjs: javascript,
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  mts: () => javascript({ typescript: true }),
  cts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: python, python: python,
  html: html, htm: html,
  css: css, scss: css, less: css, sass: css,
  json: json,
  md: markdown, markdown: markdown,
  rs: rust,
  c: cpp, h: cpp, cpp: cpp, cc: cpp, cxx: cpp, hpp: cpp,
  java: java, kt: java, scala: java,
  sql: sql,
  xml: xml, svg: xml, vue: xml, svelte: xml,
  yaml: yaml, yml: yaml,
};

function getLangExtension(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langFn = LANG_MAP[ext];
  if (!langFn) return [];
  const result = typeof langFn === 'function' ? langFn() : langFn();
  return [result];
}

// ─── Dark theme matching Super Terminal ───
const superTerminalTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg-void)',
    color: 'var(--text-main)',
    fontSize: 'var(--font-size, 13px)',
    fontFamily: 'var(--font-mono)',
  },
  '.cm-content': {
    caretColor: 'var(--accent, #c792ea)',
    padding: '4px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent, #c792ea)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-deep)',
    color: 'var(--text-ghost)',
    border: 'none',
    minWidth: '3ch',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--bg-hover)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-hover)',
    color: 'var(--text-dim)',
    border: 'none',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(255, 203, 107, 0.3)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(255, 203, 107, 0.5)',
  },
}, { dark: true });

// ─── Base extensions (always applied) ───
function baseExtensions(filePath) {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    foldGutter(),
    history(),
    search(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    superTerminalTheme,
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...searchKeymap,
      indentWithTab,
      // Ctrl+H → find/replace (custom binding)
      { key: 'Mod-h', run: openSearchPanel },
    ]),
    ...getLangExtension(filePath),
  ];
}

// ─── Compartments for dynamic readOnly toggle ───
const readOnlyComp = new WeakMap(); // view → Compartment
const editableComp = new WeakMap();

// ─── Public API ───

function createEditor(container, content, filePath, { readOnly = true, onSave, onChange } = {}) {
  const roComp = new Compartment();
  const edComp = new Compartment();

  const extensions = [
    ...baseExtensions(filePath),
    roComp.of(EditorState.readOnly.of(readOnly)),
    edComp.of(EditorView.editable.of(!readOnly)),
  ];

  if (onChange) {
    extensions.push(EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange();
    }));
  }

  if (onSave) {
    extensions.push(keymap.of([{
      key: 'Mod-s',
      run: () => { onSave(); return true; },
      preventDefault: true,
    }]));
  }

  const state = EditorState.create({ doc: content || '', extensions });
  const view = new EditorView({ state, parent: container });

  readOnlyComp.set(view, roComp);
  editableComp.set(view, edComp);

  return view;
}

function setReadOnly(view, readOnly) {
  const roComp = readOnlyComp.get(view);
  const edComp = editableComp.get(view);
  if (!roComp || !edComp) return;
  view.dispatch({
    effects: [
      roComp.reconfigure(EditorState.readOnly.of(readOnly)),
      edComp.reconfigure(EditorView.editable.of(!readOnly)),
    ],
  });
}

function getContent(view) {
  return view.state.doc.toString();
}

function destroyEditor(view) {
  readOnlyComp.delete(view);
  editableComp.delete(view);
  view.destroy();
}

// Expose on window for non-module scripts
window.FileEditor = { createEditor, setReadOnly, getContent, destroyEditor };
```

- [ ] **Step 2: Add script tag to index.html**

In `client/index.html`, add before the existing `<script type="module" src="js/main.js">`:

```html
<script type="module" src="js/file-editor.js"></script>
```

- [ ] **Step 3: Verify window.FileEditor is available**

Start the dev server (`npm run dev`), open browser console, check `window.FileEditor` exists with `createEditor`, `setReadOnly`, `getContent`, `destroyEditor`.

- [ ] **Step 4: Commit**

```bash
git add client/js/file-editor.js client/js/codemirror-entry.js client/index.html
git commit -m "feat: add file-editor.js — CodeMirror 6 wrapper with window.FileEditor API"
```

---

### Task 3: Modify file-viewer.js — replace highlight.js with CodeMirror

**Files:**
- Modify: `client/js/file-viewer.js`

This is the largest change. Replace the `updateFileContent` function's text rendering with CodeMirror, add edit-mode header UI, and handle unsaved state.

- [ ] **Step 1: Add imports and editor tracking to fileTabs map**

Add `wsSend` import to `file-viewer.js` (needed for save in Task 5):

```js
import { wsSend } from './websocket.js';
```

In `file-viewer.js`, the `fileTabs` Map currently stores `{ tabEl, paneEl, contentEl }`. Extend it to also store:
- `editorView` — CodeMirror EditorView instance (null for binary/image)
- `filePath` — the file path
- `originalContent` — content at last save (for dirty detection)
- `isEditing` — boolean for edit mode
- `headerEl` — reference to the header element (for updating edit/readonly UI)

- [ ] **Step 2: Rewrite updateFileContent to use CodeMirror**

Replace the highlight.js rendering in `updateFileContent` with CodeMirror. For text files:
- Clear the `contentEl`
- Call `window.FileEditor.createEditor(contentEl, text, filePath, { readOnly: true, onSave, onChange })`
- Store the returned EditorView in the fileTabs entry
- Store `originalContent = text`

Keep the existing image and binary rendering paths unchanged.

Remove the `getHljsLang`, `splitHighlightedLines` functions (no longer needed).

- [ ] **Step 3: Add edit-mode toggle to header**

Modify `openFileTab` to create a richer header with:

```html
<div class="file-pane-header">
  <span class="file-pane-path">…/path/to/file.js</span>
  <div class="file-pane-actions">
    <span class="file-pane-status">READ ONLY</span>
    <button class="file-pane-edit-btn">Edit</button>
  </div>
</div>
```

When Edit button is clicked:
1. Call `window.FileEditor.setReadOnly(editorView, false)`
2. Update header to show "EDITING" + Save + Cancel buttons + "Ctrl+S" hint
3. Set `entry.isEditing = true`
4. Focus the editor

When Cancel is clicked:
1. Call `window.FileEditor.setReadOnly(editorView, true)`
2. Restore original content if changed (dispatch replacement)
3. Reset header to readonly state
4. Set `entry.isEditing = false`

- [ ] **Step 4: Add unsaved indicator (● dot)**

In the `onChange` callback passed to `createEditor`:
1. Compare current content with `entry.originalContent`
2. If different, add class `unsaved` to the tab element and show ● next to filename
3. If same, remove the class

Tab HTML update — add a span for the dot:

```html
<span class="tab-unsaved-dot" style="display:none">●</span>
```

- [ ] **Step 5: Add Ctrl+E shortcut for edit toggle**

Register the Ctrl+E keybinding via `keyboard.js`. Add import at the top of `file-viewer.js`:

```js
import { registerAction } from './keyboard.js';
```

Then at module level (after function definitions, before exports):

```js
registerAction('toggleFileEdit', () => {
  const entry = fileTabs.get(activeFilePath);
  if (!entry || !entry.editorView) return;
  if (entry.isEditing) exitEditMode(activeFilePath);
  else enterEditMode(activeFilePath);
});
```

The keybinding `Ctrl+E` → `toggleFileEdit` should be registered in `main.js` where other keybindings are configured (via `buildCombo`), following the existing pattern.

Also handle `Escape` to exit edit mode. Add a DOM `keydown` listener on the pane element:

```js
paneEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && entry.isEditing) {
    exitEditMode(filePath);
  }
});
```

- [ ] **Step 6: Add unsaved confirm on tab close**

In `closeFileTab`, before closing:

```js
const entry = fileTabs.get(filePath);
if (entry && entry.isEditing) {
  const current = window.FileEditor.getContent(entry.editorView);
  if (current !== entry.originalContent) {
    if (!confirm('Unsaved changes. Close anyway?')) return;
  }
}
```

Also call `window.FileEditor.destroyEditor(entry.editorView)` when closing.

- [ ] **Step 7: Commit**

```bash
git add client/js/file-viewer.js
git commit -m "feat: replace highlight.js viewer with CodeMirror 6 editor"
```

---

### Task 4: Server-side file_save WebSocket handler

**Files:**
- Modify: `server/ws-handlers.ts`

- [ ] **Step 1: Add file_save handler**

In `server/ws-handlers.ts`, add a new handler in the handlers object (next to `file_read`):

```typescript
file_save(ctx, parsed) {
  const r = getSession(ctx, parsed);
  if (!r) return;
  const { id, session } = r;
  const filePath = parsed.filePath as string;
  const content = parsed.content as string;

  if (!filePath || typeof content !== 'string') {
    ctx.wsSend(ctx.ws, JSON.stringify({
      type: 'file_save_result',
      sessionId: id,
      filePath,
      success: false,
      error: 'Missing filePath or content',
    }));
    return;
  }

  // Path traversal protection
  const resolved = path.resolve(session.cwd, filePath);
  if (!resolved.startsWith(session.cwd + path.sep) && resolved !== session.cwd) {
    ctx.wsSend(ctx.ws, JSON.stringify({
      type: 'file_save_result',
      sessionId: id,
      filePath,
      success: false,
      error: 'Access denied: path outside project',
    }));
    return;
  }

  try {
    fs.writeFileSync(resolved, content, 'utf-8');
    ctx.wsSend(ctx.ws, JSON.stringify({
      type: 'file_save_result',
      sessionId: id,
      filePath,
      success: true,
    }));
  } catch (err: any) {
    ctx.wsSend(ctx.ws, JSON.stringify({
      type: 'file_save_result',
      sessionId: id,
      filePath,
      success: false,
      error: err.message,
    }));
  }
},
```

Ensure `path` and `fs` are imported at the top of the file (check existing imports).

- [ ] **Step 2: Commit**

```bash
git add server/ws-handlers.ts
git commit -m "feat: add file_save WebSocket handler with path traversal protection"
```

---

### Task 5: Client-side save — wire WebSocket save to editor

**Files:**
- Modify: `client/js/file-viewer.js`
- Modify: `client/js/main.js`

- [ ] **Step 1: Implement save function in file-viewer.js**

Create a `saveFile(filePath)` function:

```js
function saveFile(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry || !entry.editorView) return;
  const content = window.FileEditor.getContent(entry.editorView);
  wsSend({
    type: 'file_save',
    sessionId: S.activeSessionId,
    filePath,
    content,
  });
}
```

This is called by:
- The Save button click handler
- The `onSave` callback passed to `createEditor` (triggered by Ctrl+S)

- [ ] **Step 2: Handle file_save_result in main.js**

Add a handler in the WebSocket message dispatcher in `main.js`:

```js
} else if (msg.type === 'file_save_result') {
  handleFileSaveResult(msg);
}
```

Import `handleFileSaveResult` from `file-viewer.js` (add export).

In `file-viewer.js`:

```js
export function handleFileSaveResult(msg) {
  const entry = fileTabs.get(msg.filePath);
  if (!entry) return;

  if (msg.success) {
    // Update original content to current
    entry.originalContent = window.FileEditor.getContent(entry.editorView);
    // Remove unsaved indicator
    entry.tabEl.classList.remove('unsaved');
    const dot = entry.tabEl.querySelector('.tab-unsaved-dot');
    if (dot) dot.style.display = 'none';
    // Brief success flash on header
    showHeaderMessage(entry, 'Saved', 'success');
  } else {
    // Show error in header
    showHeaderMessage(entry, `Save failed: ${msg.error}`, 'error');
  }
}
```

- [ ] **Step 3: Add showHeaderMessage helper**

```js
function showHeaderMessage(entry, message, type) {
  const msgEl = entry.headerEl.querySelector('.file-pane-message');
  if (msgEl) msgEl.remove();
  const el = document.createElement('span');
  el.className = `file-pane-message file-pane-message-${type}`;
  el.textContent = message;
  entry.headerEl.querySelector('.file-pane-actions').prepend(el);
  setTimeout(() => el.remove(), 3000);
}
```

- [ ] **Step 4: Commit**

```bash
git add client/js/file-viewer.js client/js/main.js
git commit -m "feat: wire Ctrl+S / Save button to WebSocket file_save"
```

---

### Task 6: CSS — CodeMirror theme and edit-mode styles

**Files:**
- Modify: `client/styles.css`

- [ ] **Step 1: Remove hljs styles**

Remove the `.fl-code .hljs-*` CSS rules (lines ~1513–1565 in styles.css). Also remove `.fl`, `.fl-ln`, `.fl-code` rules since CodeMirror replaces them.

- [ ] **Step 2: Add CodeMirror container styles**

```css
/* ─── CodeMirror in file pane ─── */
.file-pane-content .cm-editor {
  height: 100%;
}
.file-pane-content .cm-scroller {
  overflow: auto;
  font-family: var(--font-mono);
}
```

- [ ] **Step 3: Add edit-mode header styles**

```css
/* ─── File pane header: edit mode ─── */
.file-pane-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-pane-status {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-ghost);
}
.file-pane-status.editing {
  color: var(--accent, #c792ea);
}
.file-pane-edit-btn,
.file-pane-save-btn,
.file-pane-cancel-btn {
  font-size: 11px;
  padding: 2px 8px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-family: var(--font-mono);
}
.file-pane-edit-btn {
  background: var(--bg-hover);
  color: var(--text-dim);
}
.file-pane-edit-btn:hover {
  background: var(--border);
  color: var(--text-main);
}
.file-pane-save-btn {
  background: #a6e3a1;
  color: #1e1e2e;
  font-weight: 600;
}
.file-pane-save-btn:hover {
  background: #94d890;
}
.file-pane-cancel-btn {
  background: var(--bg-hover);
  color: var(--text-dim);
}
.file-pane-cancel-btn:hover {
  background: var(--border);
}
.file-pane-save-hint {
  font-size: 10px;
  color: var(--text-ghost);
}
```

- [ ] **Step 4: Add unsaved tab indicator**

```css
/* ─── Unsaved dot on tab ─── */
.tab-unsaved-dot {
  color: #f38ba8;
  font-size: 14px;
  font-weight: bold;
  line-height: 1;
}

.tab.file-tab.unsaved .tab-name {
  font-style: italic;
}
```

- [ ] **Step 5: Add header message styles**

```css
.file-pane-message {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  animation: fade-in 0.15s ease;
}
.file-pane-message-success {
  color: #a6e3a1;
}
.file-pane-message-error {
  color: #f38ba8;
}
```

- [ ] **Step 6: Commit**

```bash
git add client/styles.css
git commit -m "style: add CodeMirror theme, edit-mode header, unsaved indicator styles"
```

---

### Task 7: Integration test — end-to-end manual verification

**Files:** None (manual testing)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify read-only mode**

1. Open browser → login → open a file from the explorer
2. Verify: CodeMirror renders with syntax highlighting, line numbers
3. Verify: header shows "READ ONLY" + Edit button
4. Verify: typing does nothing (read-only)
5. Verify: Ctrl+F opens search panel

- [ ] **Step 3: Verify edit mode**

1. Click Edit button (or Ctrl+E)
2. Verify: header changes to "EDITING" + Save + Cancel + hint
3. Verify: can type in the editor
4. Make a change → verify tab shows ● unsaved indicator
5. Press Ctrl+Z → verify undo works

- [ ] **Step 4: Verify save**

1. Make a change in edit mode
2. Press Ctrl+S
3. Verify: ● disappears, brief "Saved" message in header
4. Close tab and reopen file → verify change persisted

- [ ] **Step 5: Verify cancel**

1. Enter edit mode, make changes
2. Click Cancel
3. Verify: content reverts to last saved version
4. Verify: header returns to "READ ONLY"

- [ ] **Step 6: Verify unsaved close warning**

1. Enter edit mode, make changes
2. Click tab close (✕)
3. Verify: confirm dialog appears
4. Cancel → tab stays open
5. OK → tab closes

- [ ] **Step 7: Verify image/binary files unchanged**

1. Open an image file from explorer
2. Verify: image preview renders as before (no CodeMirror)

- [ ] **Step 8: Final commit**

If any remaining unstaged fixes exist from testing:

```bash
git add client/js/file-editor.js client/js/file-viewer.js client/js/main.js client/styles.css server/ws-handlers.ts
git commit -m "fix: address issues found during integration testing"
```
