# Git Worktree Source Control Integration - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add git worktree listing, switching, creation, and deletion to the source control side panel.

**Architecture:** Server-side `git-service.ts` gets worktree CRUD functions. Server `index.ts` gets 4 new WebSocket handlers. Client `source-control.js` renders a collapsible worktree section below the branch bar. HTML/CSS updated to match existing `sc-*` patterns.

**Tech Stack:** Node.js (execFileSync for git CLI), vanilla JS (ES6 modules), WebSocket messaging, CSS custom properties.

**Note:** This project has no test framework. Verification is done by running `npx tsc --noEmit` and manual browser testing.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/git-service.ts` | Modify | Add `WorktreeEntry` interface + `getWorktreeList`, `addWorktree`, `removeWorktree` functions |
| `server/index.ts` | Modify | Add 4 WebSocket message handlers: `git_worktree_list`, `git_worktree_add`, `git_worktree_remove`, `git_worktree_switch` |
| `client/js/source-control.js` | Modify | Add worktree UI rendering, event handlers, WebSocket message handlers |
| `client/js/main.js` | Modify | Route 4 new message types to source-control handlers |
| `client/index.html` | Modify | Add worktree section markup inside `panel-source-control` |
| `client/styles.css` | Modify | Add `.sc-worktree-*` styles |

---

### Task 1: Server - Add worktree functions to `git-service.ts`

**Files:**
- Modify: `server/git-service.ts` (append after `getGitRoot` function, ~line 581)

- [ ] **Step 1: Add WorktreeEntry interface and getWorktreeList function**

Add at end of `server/git-service.ts`:

```ts
// ─── GIT WORKTREE ────────────────────────────────────────────────
export interface WorktreeEntry {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
  isBare: boolean;
}

export function getWorktreeList(cwd: string): WorktreeEntry[] {
  try {
    const raw = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd, encoding: 'utf-8', timeout: 5000,
    }).trim();
    if (!raw) return [];

    const entries: WorktreeEntry[] = [];
    let current: Partial<WorktreeEntry> = {};

    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        if (current.path) entries.push(current as WorktreeEntry);
        current = { path: line.slice(9), branch: '', head: '', isMain: false, isBare: false };
      } else if (line.startsWith('HEAD ')) {
        current.head = line.slice(5, 12); // short hash
      } else if (line.startsWith('branch ')) {
        current.branch = line.slice(7).replace('refs/heads/', '');
      } else if (line === 'bare') {
        current.isBare = true;
      } else if (line === 'detached') {
        current.branch = current.head || '(detached)';
      } else if (line === '') {
        // blank line = separator, but we handle on next 'worktree' line
      }
    }
    if (current.path) entries.push(current as WorktreeEntry);

    // Mark main worktree (first entry is always main)
    if (entries.length > 0) entries[0].isMain = true;

    return entries;
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Add addWorktree function**

```ts
export function addWorktree(cwd: string, wtPath: string, branch?: string, createBranch?: boolean): { ok: boolean; error?: string } {
  try {
    const args = ['worktree', 'add'];
    if (createBranch && branch) {
      args.push('-b', branch, wtPath);
    } else if (branch) {
      args.push(wtPath, branch);
    } else {
      args.push(wtPath);
    }
    execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message || String(e) };
  }
}
```

- [ ] **Step 3: Add removeWorktree function**

```ts
export function removeWorktree(cwd: string, wtPath: string, force?: boolean): { ok: boolean; error?: string } {
  try {
    const args = ['worktree', 'remove'];
    if (force) args.push('--force');
    args.push(wtPath);
    execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.stderr || e.message || String(e) };
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /path/to/project && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add server/git-service.ts
git commit -m "feat: add git worktree functions to git-service"
```

---

### Task 2: Server - Add WebSocket handlers in `index.ts`

**Files:**
- Modify: `server/index.ts` (add handlers after `git_push` handler block, ~line 1310)

- [ ] **Step 1: Add git_worktree_list handler**

After the `git_push` handler block, add:

```ts
    } else if (parsed.type === 'git_worktree_list') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      try {
        const worktrees = gitService.getWorktreeList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
      } catch (e) {
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees: [], error: String(e) }));
      }
```

- [ ] **Step 2: Add git_worktree_add handler**

```ts
    } else if (parsed.type === 'git_worktree_add') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const wtPath = parsed.path as string;
      const branch = parsed.branch as string | undefined;
      const createBranch = parsed.createBranch as boolean | undefined;
      const result = gitService.addWorktree(session.cwd, wtPath, branch, createBranch);
      ws.send(JSON.stringify({ type: 'git_worktree_add_ack', sessionId: id, ...result }));
      if (result.ok) {
        const worktrees = gitService.getWorktreeList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
      }
```

- [ ] **Step 3: Add git_worktree_remove handler**

```ts
    } else if (parsed.type === 'git_worktree_remove') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const wtPath = parsed.path as string;
      const force = parsed.force as boolean || false;
      const result = gitService.removeWorktree(session.cwd, wtPath, force);
      ws.send(JSON.stringify({ type: 'git_worktree_remove_ack', sessionId: id, ...result }));
      if (result.ok) {
        const worktrees = gitService.getWorktreeList(session.cwd);
        ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
      }
```

- [ ] **Step 4: Add git_worktree_switch handler**

```ts
    } else if (parsed.type === 'git_worktree_switch') {
      const id = (parsed.sessionId as string) || wsSession.get(ws);
      if (!id) return;
      const session = sessions.get(id);
      if (!session) return;
      const wtPath = parsed.path as string;
      // Verify path exists and is a valid worktree
      const fs = require('fs');
      if (!fs.existsSync(wtPath)) {
        ws.send(JSON.stringify({ type: 'git_worktree_switch_ack', sessionId: id, ok: false, error: 'Path does not exist' }));
        return;
      }
      // Change session cwd
      session.cwd = wtPath;
      // Update pty cwd if possible
      if (session.pty) {
        session.pty.write(`cd ${JSON.stringify(wtPath)}\r`);
      }
      ws.send(JSON.stringify({ type: 'git_worktree_switch_ack', sessionId: id, ok: true, path: wtPath }));
      // Send updated git status for new cwd
      try {
        const isRepo = gitService.isGitRepo(session.cwd);
        if (isRepo) {
          const files = gitService.getGitStatus(session.cwd);
          const branch = gitService.getCurrentBranch(session.cwd);
          const root = gitService.getGitRoot(session.cwd);
          const upstream = gitService.getUpstreamStatus(session.cwd);
          ws.send(JSON.stringify({ type: 'git_status_data', sessionId: id, files, branch, root, isRepo: true, upstream }));
        }
      } catch {}
      // Send updated worktree list
      const worktrees = gitService.getWorktreeList(session.cwd);
      ws.send(JSON.stringify({ type: 'git_worktree_list_data', sessionId: id, worktrees, currentPath: session.cwd }));
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add server/index.ts
git commit -m "feat: add git worktree WebSocket handlers"
```

---

### Task 3: Client - Add worktree HTML markup

**Files:**
- Modify: `client/index.html` (insert after `sc-branch-bar` div, ~line 141)

- [ ] **Step 1: Add worktree section HTML**

After the closing `</div>` of `sc-branch-bar` (line 141), insert:

```html
      <div class="sc-worktree-section" id="sc-worktree-section" style="display:none">
        <div class="sc-worktree-header" id="sc-worktree-header">
          <span class="sc-worktree-toggle">▾</span>
          <span class="sc-worktree-title">WORKTREES</span>
          <span class="sc-worktree-count" id="sc-worktree-count"></span>
          <button class="btn-icon-sm" id="sc-worktree-add-btn" title="Add worktree">+</button>
        </div>
        <div class="sc-worktree-list" id="sc-worktree-list"></div>
        <div class="sc-worktree-add-form" id="sc-worktree-add-form" style="display:none">
          <input type="text" class="sc-worktree-input" id="sc-worktree-path" placeholder="Branch name or path"/>
          <div class="sc-worktree-form-actions">
            <label class="sc-worktree-label"><input type="checkbox" id="sc-worktree-new-branch"/> New branch</label>
            <button class="sc-worktree-form-btn" id="sc-worktree-create">Create</button>
            <button class="sc-worktree-form-btn sc-worktree-cancel-btn" id="sc-worktree-cancel">Cancel</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add client/index.html
git commit -m "feat: add worktree section HTML markup"
```

---

### Task 4: Client - Add worktree CSS styles

**Files:**
- Modify: `client/styles.css` (append after `.sc-diff-content::-webkit-scrollbar-thumb` block)

- [ ] **Step 1: Add worktree styles**

After the sc-diff scrollbar styles, append:

```css
/* ─── WORKTREE ─── */
.sc-worktree-section{border-bottom:1px solid var(--border)}
.sc-worktree-header{padding:6px 12px;font-size:10px;font-weight:700;letter-spacing:.1em;
  color:var(--text-ghost);display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none}
.sc-worktree-header:hover{color:var(--text-main)}
.sc-worktree-toggle{font-size:9px;width:10px;text-align:center;transition:transform .15s}
.sc-worktree-section.collapsed .sc-worktree-toggle{transform:rotate(-90deg)}
.sc-worktree-section.collapsed .sc-worktree-list,
.sc-worktree-section.collapsed .sc-worktree-add-form{display:none!important}
.sc-worktree-title{flex:1}
.sc-worktree-count{background:var(--bg-hover);border-radius:8px;padding:1px 6px;font-size:9px;min-width:18px;text-align:center}
.sc-worktree-count:empty{display:none}
.sc-worktree-list{display:flex;flex-direction:column}
.sc-worktree-item{display:flex;align-items:center;gap:6px;padding:4px 12px;font-size:11px;
  cursor:pointer;transition:background .1s;color:var(--text-main)}
.sc-worktree-item:hover{background:var(--bg-hover)}
.sc-worktree-item.active{background:var(--accent-dim);border-left:2px solid var(--accent)}
.sc-worktree-item.active .sc-worktree-branch{color:var(--accent)}
.sc-worktree-marker{font-size:8px;color:var(--accent);width:8px;flex-shrink:0}
.sc-worktree-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.sc-worktree-branch{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-worktree-path{font-size:9px;color:var(--text-ghost);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-worktree-head{font-size:9px;color:var(--text-ghost);font-family:var(--font-mono);flex-shrink:0}
.sc-worktree-remove{background:none;border:none;color:var(--text-ghost);font-size:11px;
  cursor:pointer;display:none;padding:2px 4px;border-radius:3px;flex-shrink:0}
.sc-worktree-item:hover .sc-worktree-remove{display:block}
.sc-worktree-remove:hover{color:var(--danger);background:#ff336618}
.sc-worktree-add-form{padding:8px 12px;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border)}
.sc-worktree-input{background:var(--bg-void);border:1px solid var(--border);border-radius:3px;
  color:var(--text-main);padding:4px 8px;font-size:11px;font-family:var(--font-mono)}
.sc-worktree-input:focus{border-color:var(--accent);outline:none}
.sc-worktree-form-actions{display:flex;align-items:center;gap:8px;font-size:11px}
.sc-worktree-label{color:var(--text-ghost);display:flex;align-items:center;gap:4px;cursor:pointer;flex:1}
.sc-worktree-form-btn{background:var(--accent);color:var(--bg-void);border:none;border-radius:3px;
  padding:3px 10px;font-size:10px;cursor:pointer;font-weight:600}
.sc-worktree-form-btn:hover{filter:brightness(1.2)}
.sc-worktree-cancel-btn{background:none;border:1px solid var(--border);color:var(--text-ghost)}
.sc-worktree-cancel-btn:hover{color:var(--text-main);border-color:var(--text-ghost)}
```

- [ ] **Step 2: Commit**

```bash
git add client/styles.css
git commit -m "feat: add worktree CSS styles"
```

---

### Task 5: Client - Add worktree logic to `source-control.js`

**Files:**
- Modify: `client/js/source-control.js`

- [ ] **Step 1: Add worktree state variables**

After line 14 (`let selectedFile = null;`), add:

```js
let worktrees = [];
let currentWorktreePath = '';
let worktreeCollapsed = false;
```

- [ ] **Step 2: Add worktree init code to initSourceControl()**

At the end of `initSourceControl()` (before the closing `}`), add:

```js
  // Worktree section
  const wtHeader = document.getElementById('sc-worktree-header');
  if (wtHeader) {
    wtHeader.addEventListener('click', (e) => {
      if (e.target.closest('#sc-worktree-add-btn')) return;
      worktreeCollapsed = !worktreeCollapsed;
      const section = document.getElementById('sc-worktree-section');
      if (section) section.classList.toggle('collapsed', worktreeCollapsed);
    });
  }

  const wtAddBtn = document.getElementById('sc-worktree-add-btn');
  if (wtAddBtn) {
    wtAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const form = document.getElementById('sc-worktree-add-form');
      if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
    });
  }

  const wtCreateBtn = document.getElementById('sc-worktree-create');
  if (wtCreateBtn) {
    wtCreateBtn.addEventListener('click', () => {
      const pathInput = document.getElementById('sc-worktree-path');
      const newBranchCb = document.getElementById('sc-worktree-new-branch');
      if (!pathInput || !S.activeSessionId) return;
      const value = pathInput.value.trim();
      if (!value) return;
      const isNewBranch = newBranchCb?.checked || false;
      if (isNewBranch) {
        // Branch name provided, auto-generate path
        const path = `.claude/worktrees/${value}`;
        wsSend({ type: 'git_worktree_add', sessionId: S.activeSessionId, path, branch: value, createBranch: true });
      } else {
        // Existing branch name
        const path = `.claude/worktrees/${value}`;
        wsSend({ type: 'git_worktree_add', sessionId: S.activeSessionId, path, branch: value });
      }
      pathInput.value = '';
      if (newBranchCb) newBranchCb.checked = false;
      document.getElementById('sc-worktree-add-form').style.display = 'none';
    });
  }

  const wtCancelBtn = document.getElementById('sc-worktree-cancel');
  if (wtCancelBtn) {
    wtCancelBtn.addEventListener('click', () => {
      document.getElementById('sc-worktree-add-form').style.display = 'none';
    });
  }
```

- [ ] **Step 3: Add worktree WebSocket message handlers (exported)**

After `handleGitGenerateMessage()`, add:

```js
export function handleWorktreeListData(msg) {
  worktrees = msg.worktrees || [];
  currentWorktreePath = msg.currentPath || '';
  renderWorktrees();
}

export function handleWorktreeAddAck(msg) {
  if (msg.ok) {
    showToast('Worktree created', 'success');
  } else {
    showToast('Worktree creation failed: ' + (msg.error || 'unknown'), 'error', 5000);
  }
}

export function handleWorktreeRemoveAck(msg) {
  if (msg.ok) {
    showToast('Worktree removed', 'success');
  } else {
    showToast('Worktree removal failed: ' + (msg.error || 'unknown'), 'error', 5000);
  }
}

export function handleWorktreeSwitchAck(msg) {
  if (msg.ok) {
    showToast(`Switched to ${msg.path}`, 'success');
  } else {
    showToast('Switch failed: ' + (msg.error || 'unknown'), 'error', 5000);
  }
}
```

- [ ] **Step 4: Add renderWorktrees() function**

```js
function renderWorktrees() {
  const section = document.getElementById('sc-worktree-section');
  const list = document.getElementById('sc-worktree-list');
  const countEl = document.getElementById('sc-worktree-count');
  if (!section || !list) return;

  // Only show section if there are worktrees (more than 1 means non-trivial)
  if (worktrees.length <= 1) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  if (countEl) countEl.textContent = worktrees.length;

  list.innerHTML = '';
  for (const wt of worktrees) {
    const item = document.createElement('div');
    item.className = 'sc-worktree-item';

    // Normalize paths for comparison
    const isCurrent = normalizePath(wt.path) === normalizePath(currentWorktreePath);
    if (isCurrent) item.classList.add('active');

    const marker = document.createElement('span');
    marker.className = 'sc-worktree-marker';
    marker.textContent = isCurrent ? '●' : '';

    const info = document.createElement('div');
    info.className = 'sc-worktree-info';

    const branchSpan = document.createElement('span');
    branchSpan.className = 'sc-worktree-branch';
    branchSpan.textContent = wt.branch || '(no branch)';

    const pathSpan = document.createElement('span');
    pathSpan.className = 'sc-worktree-path';
    // Show shortened path
    const shortPath = wt.path.split('/').slice(-2).join('/');
    pathSpan.textContent = shortPath;
    pathSpan.title = wt.path;

    info.appendChild(branchSpan);
    info.appendChild(pathSpan);

    const head = document.createElement('span');
    head.className = 'sc-worktree-head';
    head.textContent = wt.head || '';

    item.appendChild(marker);
    item.appendChild(info);
    item.appendChild(head);

    // Remove button (not for main worktree or current)
    if (!wt.isMain && !isCurrent) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'sc-worktree-remove';
      removeBtn.title = 'Remove worktree';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        wsSend({ type: 'git_worktree_remove', sessionId: S.activeSessionId, path: wt.path });
      });
      item.appendChild(removeBtn);
    }

    // Click to switch
    if (!isCurrent) {
      item.addEventListener('click', () => {
        wsSend({ type: 'git_worktree_switch', sessionId: S.activeSessionId, path: wt.path });
      });
    }

    list.appendChild(item);
  }
}

function normalizePath(p) {
  return (p || '').replace(/\/+$/, '');
}
```

- [ ] **Step 5: Update requestGitStatus to also request worktree list**

Modify `requestGitStatus()`:

```js
export function requestGitStatus() {
  if (!S.activeSessionId) return;
  wsSend({ type: 'git_status', sessionId: S.activeSessionId });
  wsSend({ type: 'git_worktree_list', sessionId: S.activeSessionId });
}
```

- [ ] **Step 6: Commit**

```bash
git add client/js/source-control.js
git commit -m "feat: add worktree UI logic to source-control"
```

---

### Task 6: Client - Route new messages in `main.js`

**Files:**
- Modify: `client/js/main.js`

- [ ] **Step 1: Update import from source-control.js**

Change line 19 import to include new handlers:

```js
import { initSourceControl, handleGitStatusData, handleGitDiffData, handleGitCommitAck, handleGitPushAck, handleGitGenerateMessage, onSourceControlSessionChange, handleWorktreeListData, handleWorktreeAddAck, handleWorktreeRemoveAck, handleWorktreeSwitchAck } from './source-control.js';
```

- [ ] **Step 2: Add message routing in handleMessage()**

After the `git_generate_message_data` handler (line 126), add:

```js
  } else if (msg.type === 'git_worktree_list_data') {
    handleWorktreeListData(msg);
  } else if (msg.type === 'git_worktree_add_ack') {
    handleWorktreeAddAck(msg);
  } else if (msg.type === 'git_worktree_remove_ack') {
    handleWorktreeRemoveAck(msg);
  } else if (msg.type === 'git_worktree_switch_ack') {
    handleWorktreeSwitchAck(msg);
```

- [ ] **Step 3: Commit**

```bash
git add client/js/main.js
git commit -m "feat: route worktree messages in main.js"
```

---

### Task 7: Build verification and integration test

- [ ] **Step 1: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Manual integration check**

Start the server and verify:
1. Source control panel loads without errors
2. Worktree section appears when repo has multiple worktrees
3. Worktree section hidden when only 1 worktree (default)
4. Click worktree to switch
5. Add new worktree via form
6. Remove worktree via X button

- [ ] **Step 3: Final commit with all changes**

```bash
git add -A
git commit -m "feat: git worktree integration in source control panel"
```
