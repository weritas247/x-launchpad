# Git Modal Infinite Scroll + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add infinite scroll pagination and a toggle search bar to the git graph modal.

**Architecture:** Server-side pagination via `skip` parameter on `getGitLog`, with a new `searchGitLog` function for hybrid search. Client handles scroll detection, re-render with scroll position preservation, and a toggle search bar with debounced hybrid (client-first, server-fallback) search.

**Tech Stack:** TypeScript (server), vanilla JS (client), WebSocket messages, git CLI

**Spec:** `docs/superpowers/specs/2026-03-18-git-modal-infinite-scroll-search-design.md`

---

### Task 1: Server — Add `skip`/`hasMore` to `getGitLog` and update handler

**Files:**
- Modify: `server/git-service.ts:30-84` (getGitLog function)
- Modify: `server/index.ts:1336-1346` (git_graph handler)

- [ ] **Step 1: Add `skip` parameter to `getGitLog`**

Update the function signature and both git log commands to include `--topo-order` and `--skip`:

```typescript
export function getGitLog(cwd: string, maxCount = 50, skip = 0): { commits: CommitEntry[]; hasMore: boolean } {
  const fetchCount = maxCount + 1; // fetch one extra to determine hasMore
  const raw = execFileSync('git', [
    'log', '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00%b%x01',
    `--max-count=${fetchCount}`, `--skip=${skip}`, '--topo-order', '--all',
  ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

  const allCommits = raw.split('\x01').filter(Boolean).map(record => {
    const [hash, parentStr, refStr, author, date, message, ...bodyParts] = record.trim().split('\x00');
    return {
      hash,
      parents: parentStr ? parentStr.split(' ') : [],
      refs: refStr ? refStr.split(', ').map(r => r.trim()).filter(Boolean) : [],
      author,
      date,
      message,
      body: bodyParts.join('\x00').trim(),
      additions: 0,
      deletions: 0,
    };
  });

  const hasMore = allCommits.length > maxCount;
  const commits = hasMore ? allCommits.slice(0, maxCount) : allCommits;

  // Fetch per-commit stats separately (same skip/maxCount)
  try {
    const statsRaw = execFileSync('git', [
      'log', '--format=%H', '--shortstat',
      `--max-count=${fetchCount}`, `--skip=${skip}`, '--topo-order', '--all',
    ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();

    // ... (existing stats parsing logic unchanged)
  } catch {
    // stats are optional
  }

  return { commits, hasMore };
}
```

- [ ] **Step 2: Update `git_graph` handler in `server/index.ts` to pass `skip` and echo it back**

```typescript
} else if (parsed.type === 'git_graph') {
  const id = (parsed.sessionId as string) || wsSession.get(ws);
  if (!id) return;
  const session = sessions.get(id);
  if (!session) return;
  const skip = typeof parsed.skip === 'number' ? parsed.skip : 0;
  try {
    const { commits, hasMore } = gitService.getGitLog(session.cwd, 50, skip);
    ws.send(JSON.stringify({ type: 'git_graph_data', sessionId: id, commits, hasMore, skip }));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'git_graph_data', sessionId: id, commits: [], hasMore: false, skip, error: String(e) }));
  }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add server/git-service.ts server/index.ts
git commit -m "feat(git): add skip/hasMore pagination to getGitLog and handler"
```

---

### Task 3: Server — Add `searchGitLog` function and `git_graph_search` handler

**Files:**
- Modify: `server/git-service.ts` (add new function after getGitLog)
- Modify: `server/index.ts` (add new handler after git_graph)

- [ ] **Step 1: Add `searchGitLog` to git-service.ts**

Add after the `getGitLog` function (after line 84):

```typescript
export function searchGitLog(cwd: string, query: string, maxCount = 50): CommitEntry[] {
  if (!query || query.length > 200) return [];

  const format = '--format=%H%x00%P%x00%D%x00%an%x00%aI%x00%s%x00%b%x01';
  const parseCommits = (raw: string): CommitEntry[] =>
    raw.split('\x01').filter(Boolean).map(record => {
      const [hash, parentStr, refStr, author, date, message, ...bodyParts] = record.trim().split('\x00');
      return {
        hash,
        parents: parentStr ? parentStr.split(' ') : [],
        refs: refStr ? refStr.split(', ').map(r => r.trim()).filter(Boolean) : [],
        author, date, message,
        body: bodyParts.join('\x00').trim(),
        additions: 0, deletions: 0,
      };
    });

  const seen = new Set<string>();
  const results: CommitEntry[] = [];

  const addUnique = (commits: CommitEntry[]) => {
    for (const c of commits) {
      if (!seen.has(c.hash)) {
        seen.add(c.hash);
        results.push(c);
      }
    }
  };

  // Search by message (--grep)
  try {
    const raw = execFileSync('git', [
      'log', format, `--max-count=${maxCount}`, '--all', '--topo-order',
      '--grep', query, '--',
    ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    if (raw) addUnique(parseCommits(raw));
  } catch {}

  // Search by author
  try {
    const raw = execFileSync('git', [
      'log', format, `--max-count=${maxCount}`, '--all', '--topo-order',
      '--author', query, '--',
    ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
    if (raw) addUnique(parseCommits(raw));
  } catch {}

  // Search by hash prefix (if query looks like hex)
  if (/^[0-9a-f]{4,40}$/i.test(query)) {
    try {
      const raw = execFileSync('git', [
        'log', format, '--max-count=1', query, '--',
      ], { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
      if (raw) addUnique(parseCommits(raw));
    } catch {}
  }

  // Sort by date descending
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results.slice(0, maxCount);
}
```

- [ ] **Step 2: Add `git_graph_search` handler to server/index.ts**

Add after the `git_graph` handler block:

```typescript
} else if (parsed.type === 'git_graph_search') {
  const id = (parsed.sessionId as string) || wsSession.get(ws);
  if (!id) return;
  const session = sessions.get(id);
  if (!session) return;
  const query = typeof parsed.query === 'string' ? parsed.query : '';
  try {
    const commits = gitService.searchGitLog(session.cwd, query);
    ws.send(JSON.stringify({ type: 'git_graph_search_data', sessionId: id, commits, query }));
  } catch (e) {
    ws.send(JSON.stringify({ type: 'git_graph_search_data', sessionId: id, commits: [], query, error: String(e) }));
  }
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add server/git-service.ts server/index.ts
git commit -m "feat(git): add searchGitLog and git_graph_search handler"
```

---

### Task 4: Client — Add search bar HTML and load-more spinner

**Files:**
- Modify: `client/index.html:327-339` (titlebar area) and `client/index.html:347-350` (scroll area)

- [ ] **Step 1: Add search toggle button to titlebar**

In `client/index.html`, add a search button before the `<span style="flex:1">` spacer (line 335):

```html
      <button class="gg-search-toggle" id="gg-search-toggle" title="Search commits (Ctrl+F)">⌕</button>
      <span style="flex:1"></span>
```

- [ ] **Step 2: Add search bar row between titlebar and body**

After the closing `</div>` of `.gg-titlebar` (line 339) and before `<div class="gg-body"` (line 340), insert:

```html
    <div class="gg-search-bar" id="gg-search-bar" style="display:none">
      <div class="gg-search-input-wrap">
        <span class="gg-search-icon">⌕</span>
        <input type="text" class="gg-search-input" id="gg-search-input" placeholder="Search by message, author, or hash..." spellcheck="false" autocomplete="off">
        <span class="gg-search-hint">Esc</span>
      </div>
    </div>
```

- [ ] **Step 3: Add load-more spinner and empty search message inside scroll area**

After `<div class="gg-commits" id="gg-commits"></div>` (line 349), and before `</div>` closing of `#gg-scroll`, add:

```html
          <div class="gg-load-more" id="gg-load-more" style="display:none">
            <div class="gg-spinner"></div>
          </div>
```

After `#gg-content`'s opening div (line 346), before `#gg-scroll`, add the empty search result element:

```html
        <div class="gg-search-empty" id="gg-search-empty" style="display:none"></div>
```

- [ ] **Step 4: Commit**

```bash
git add client/index.html
git commit -m "feat(git): add search bar HTML and load-more spinner"
```

---

### Task 5: Client — Add CSS for search bar, load-more spinner, and highlight

**Files:**
- Modify: `client/styles.css` (after line 706, before floating scroll buttons)

- [ ] **Step 1: Add CSS rules**

Insert before the `/* Floating scroll buttons */` comment (line 708):

```css
/* Search bar */
.gg-search-toggle{background:none;border:1px solid var(--border);border-radius:4px;color:var(--text-dim);font-size:14px;width:28px;height:28px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);transition:all .12s}
.gg-search-toggle:hover,.gg-search-toggle.active{color:var(--accent);border-color:var(--accent)}
.gg-search-bar{padding:6px 14px;background:var(--bg-deep);border-bottom:1px solid var(--border);flex-shrink:0}
.gg-search-input-wrap{display:flex;align-items:center;background:var(--bg-panel);border:1px solid var(--border);border-radius:4px;padding:4px 10px;gap:8px}
.gg-search-input-wrap:focus-within{border-color:var(--accent)}
.gg-search-icon{color:var(--text-ghost);font-size:13px;flex-shrink:0}
.gg-search-input{background:none;border:none;color:var(--text-main);font-size:12px;font-family:var(--font-mono);flex:1;outline:none}
.gg-search-input::placeholder{color:var(--text-ghost)}
.gg-search-hint{font-size:9px;color:var(--text-ghost);background:var(--bg-deep);border:1px solid var(--border);border-radius:3px;padding:1px 5px;flex-shrink:0}
.gg-highlight{background:var(--accent-dim);color:var(--accent);border-radius:2px;padding:0 1px}
/* Load more spinner */
.gg-load-more{display:flex;align-items:center;justify-content:center;padding:12px;position:absolute;bottom:0;left:0;right:0}
/* Search empty state */
.gg-search-empty{display:flex;align-items:center;justify-content:center;flex:1;color:var(--text-ghost);font-size:12px;letter-spacing:.06em;padding:40px}
```

- [ ] **Step 2: Commit**

```bash
git add client/styles.css
git commit -m "feat(git): add search bar and load-more CSS"
```

---

### Task 6: Client — Implement infinite scroll logic

**Files:**
- Modify: `client/js/git-graph.js:1-12` (state), `client/js/git-graph.js:72-113` (openGitGraph), `client/js/git-graph.js:229-240` (handleGitGraphData)

- [ ] **Step 1: Add pagination and search state variables**

After line 12 (after `let focusedRowIdx = -1;`), add both pagination and search state together so later tasks can reference `searchActive`:

```javascript
// ─── PAGINATION STATE ─────────────────────────────────
let isLoadingMore = false;
let hasMore = false;
let currentSkip = 0;
const PAGE_SIZE = 50;
const MAX_COMMITS = 500;
let scrollRAF = null;

// ─── SEARCH STATE ─────────────────────────────────────
let searchActive = false;
let searchQuery = '';
let searchDebounce = null;
```

- [ ] **Step 2: Add DOM ref for load-more spinner**

After the existing DOM refs section (around line 28), add:

```javascript
const loadMore   = document.getElementById('gg-load-more');
```

- [ ] **Step 3: Reset pagination state in `openGitGraph`**

In the `openGitGraph()` function, after `focusedRowIdx = -1;` (line 78), add:

```javascript
  isLoadingMore = false;
  hasMore = false;
  currentSkip = 0;
  loadMore.style.display = 'none';
```

- [ ] **Step 4: Update `handleGitGraphData` for pagination**

Replace the current `handleGitGraphData` function:

```javascript
export function handleGitGraphData(msg) {
  loading.style.display = 'none';

  // Discard append responses if search became active while loading
  const isAppend = msg.skip > 0;
  if (isAppend && searchActive) {
    isLoadingMore = false;
    loadMore.style.display = 'none';
    return;
  }

  if (!isAppend) {
    // Initial load
    if (msg.error || !msg.commits || msg.commits.length === 0) {
      errorEl.style.display = 'flex';
      errorEl.textContent = msg.error ? 'Not a git repository' : 'No commits found';
      content.style.display = 'none';
      return;
    }
    cachedCommits = msg.commits;
    content.style.display = 'flex';
  } else {
    // Append load
    if (msg.commits && msg.commits.length > 0) {
      cachedCommits = cachedCommits.concat(msg.commits);
    }
  }

  hasMore = !!msg.hasMore && cachedCommits.length < MAX_COMMITS;
  currentSkip = cachedCommits.length;
  isLoadingMore = false;
  loadMore.style.display = 'none';

  // Re-render, preserving scroll position
  const scrollEl = document.getElementById('gg-scroll');
  const prevScroll = scrollEl.scrollTop;
  renderGraph(cachedCommits);
  if (isAppend) scrollEl.scrollTop = prevScroll;
}
```

- [ ] **Step 5: Add scroll event listener**

After the resize handle event listener block (end of file, around line 749), add:

```javascript
// ─── INFINITE SCROLL ──────────────────────────────────
const scrollEl = document.getElementById('gg-scroll');
scrollEl.addEventListener('scroll', () => {
  if (scrollRAF) return;
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = null;
    if (!isOpen || isLoadingMore || !hasMore || searchActive) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      isLoadingMore = true;
      loadMore.style.display = 'flex';
      wsSend({ type: 'git_graph', sessionId: S.activeSessionId, skip: currentSkip });
    }
  });
});
```

- [ ] **Step 6: Verify in browser — open git modal, scroll down, confirm new commits load**

- [ ] **Step 7: Commit**

```bash
git add client/js/git-graph.js
git commit -m "feat(git): implement infinite scroll pagination"
```

---

### Task 7: Client — Implement toggle search bar

**Files:**
- Modify: `client/js/git-graph.js` (state, DOM refs, handlers, keyboard)

- [ ] **Step 1: Add DOM refs for search elements**

Note: `searchActive`, `searchQuery`, and `searchDebounce` were already declared in Task 6 Step 1.

After load-more ref:

```javascript
const searchToggle = document.getElementById('gg-search-toggle');
const searchBar    = document.getElementById('gg-search-bar');
const searchInput  = document.getElementById('gg-search-input');
const searchEmpty  = document.getElementById('gg-search-empty');
```

- [ ] **Step 3: Add search open/close functions**

Before the event listeners section:

```javascript
// ─── SEARCH ───────────────────────────────────────────
function openSearch() {
  searchActive = true;
  searchBar.style.display = 'block';
  searchToggle.classList.add('active');
  searchInput.value = '';
  searchQuery = '';
  searchInput.focus();
}

function closeSearch() {
  searchActive = false;
  searchBar.style.display = 'none';
  searchToggle.classList.remove('active');
  searchInput.value = '';
  searchQuery = '';
  searchEmpty.style.display = 'none';
  if (searchDebounce) { clearTimeout(searchDebounce); searchDebounce = null; }
  // Restore full commit list
  renderGraph(cachedCommits);
  modal.focus();
}

function doSearch(query) {
  searchQuery = query;
  if (!query) {
    renderGraph(cachedCommits);
    searchEmpty.style.display = 'none';
    return;
  }

  const q = query.toLowerCase();
  // Client-side filter first
  const clientResults = cachedCommits.filter(c =>
    c.message.toLowerCase().includes(q) ||
    c.author.toLowerCase().includes(q) ||
    c.hash.toLowerCase().startsWith(q)
  );

  if (clientResults.length >= 10) {
    renderSearchResults(clientResults, query);
  } else {
    // Show client results immediately, then request server
    if (clientResults.length > 0) renderSearchResults(clientResults, query);
    wsSend({ type: 'git_graph_search', sessionId: S.activeSessionId, query });
  }
}

function renderSearchResults(commits, query) {
  if (commits.length === 0) {
    searchEmpty.textContent = `No commits matching '${query}'`;
    searchEmpty.style.display = 'flex';
    svgEl.innerHTML = '';
    svgEl.setAttribute('height', 0);
    commitBox.innerHTML = '';
    return;
  }
  searchEmpty.style.display = 'none';
  renderGraph(commits);
  // Highlight matching text
  highlightMatches(query);
}

function highlightMatches(query) {
  if (!query) return;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  commitBox.querySelectorAll('.gg-msg').forEach(el => {
    // Only highlight text nodes, preserve ref badges
    const refs = el.querySelector('.gg-refs');
    const refsHtml = refs ? refs.outerHTML : '';
    const textOnly = el.textContent.replace(refs?.textContent || '', '');
    const highlighted = escHtml(textOnly).replace(regex, '<span class="gg-highlight">$1</span>');
    el.innerHTML = refsHtml + highlighted;
  });
  commitBox.querySelectorAll('.gg-author').forEach(el => {
    // Preserve co-author badges
    const imgs = el.querySelectorAll('.gg-coauthor-img, .gg-coauthor-initial');
    const authorText = el.childNodes[0]?.textContent || '';
    const highlighted = escHtml(authorText).replace(regex, '<span class="gg-highlight">$1</span>');
    el.innerHTML = highlighted;
    imgs.forEach(img => el.appendChild(img));
  });
}
```

- [ ] **Step 4: Add `handleGitGraphSearchData` handler**

```javascript
export function handleGitGraphSearchData(msg) {
  // Discard stale responses
  if (!searchActive || msg.query !== searchQuery) return;

  const q = msg.query.toLowerCase();
  const clientResults = cachedCommits.filter(c =>
    c.message.toLowerCase().includes(q) ||
    c.author.toLowerCase().includes(q) ||
    c.hash.toLowerCase().startsWith(q)
  );

  // Merge server + client results, dedup by hash
  const seen = new Set(clientResults.map(c => c.hash));
  const merged = [...clientResults];
  if (msg.commits) {
    for (const c of msg.commits) {
      if (!seen.has(c.hash)) {
        seen.add(c.hash);
        merged.push(c);
      }
    }
  }

  // Sort by date descending
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  renderSearchResults(merged, msg.query);
}
```

- [ ] **Step 5: Wire up search event listeners**

In the event listeners section:

```javascript
// Search toggle
searchToggle.addEventListener('click', () => {
  if (searchActive) closeSearch();
  else openSearch();
});

// Search input
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => doSearch(q), 300);
});

// Cmd/Ctrl+F to toggle search
document.addEventListener('keydown', e => {
  if (!isOpen) return;
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault();
    if (searchActive) searchInput.focus();
    else openSearch();
  }
});
```

- [ ] **Step 6: Update keyboard handler for search mode**

In `handleGitGraphKeydown`, replace the Escape handler (lines 146-151):

```javascript
  // Escape
  if (e.key === 'Escape') {
    e.preventDefault();
    if (searchActive) { closeSearch(); return true; }
    closeGitGraph();
    return true;
  }
```

Add after the confirm dialog check — if search is active and ArrowDown is pressed, move focus from input to rows:

```javascript
  // If search input is focused, ArrowDown moves to results
  if (searchActive && document.activeElement === searchInput && e.key === 'ArrowDown') {
    e.preventDefault();
    const rows = getRows();
    if (rows.length) {
      updateRowFocus(rows, 0);
      modal.focus();
    }
    return true;
  }

  // Typing while result list is focused → re-focus search input
  if (searchActive && document.activeElement !== searchInput && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
    searchInput.focus();
    return false; // let the keystroke pass through to the input
  }
```

- [ ] **Step 7: Reset search state in `openGitGraph`**

After the pagination reset in `openGitGraph`:

```javascript
  searchActive = false;
  searchQuery = '';
  searchBar.style.display = 'none';
  searchToggle.classList.remove('active');
  searchEmpty.style.display = 'none';
```

- [ ] **Step 8: Clear search on branch checkout**

In `handleGitCheckoutAck`, after `confirmEl.style.display = 'none';`:

```javascript
  if (searchActive) closeSearch();
```

- [ ] **Step 9: Commit**

```bash
git add client/js/git-graph.js
git commit -m "feat(git): implement toggle search bar with hybrid search"
```

---

### Task 8: Client — Wire `handleGitGraphSearchData` to message router

**Files:**
- Modify: `client/js/main.js` (message dispatch, around lines 89-102)
- Modify: `client/js/git-graph.js` (export)

- [ ] **Step 1: Add import and message handler**

In `client/js/main.js`, add `handleGitGraphSearchData` to the git-graph imports, then add a new `else if` branch in the message dispatch:

```javascript
} else if (msg.type === 'git_graph_search_data') {
  handleGitGraphSearchData(msg);
```

- [ ] **Step 2: Verify in browser — open git modal, press Cmd+F, type a query, see results**

- [ ] **Step 3: Commit**

```bash
git add client/js/main.js client/js/git-graph.js
git commit -m "feat(git): wire search data handler to message router"
```

---

### Task 9: Integration test and polish

- [ ] **Step 1: Build and start the server**

Run: `npm run build && npm start`

- [ ] **Step 2: Manual verification checklist**

Test each scenario:
1. Open git modal — 50 commits load
2. Scroll to bottom — spinner appears, next 50 load, scroll position preserved
3. Continue scrolling — more pages load until `hasMore` is false or 500 cap
4. Press Cmd+F — search bar slides open, input focused
5. Type a query — results filter with highlights
6. Type a short query with < 10 client results — server search triggers, results merge
7. Clear search — full list restores
8. Press Esc — search closes, full list shows
9. Press Esc again — modal closes
10. ArrowDown from search input — focuses first result row
11. Checkout a branch while searching — search clears
12. Search for a commit hash prefix — found via server hash lookup

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix(git): polish infinite scroll and search integration"
```
