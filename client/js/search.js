// ─── SEARCH PANEL ────────────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';

let searchResults = [];
let lastQuery = '';

export function initSearch() {
  const input = document.getElementById('search-input');
  const btn = document.getElementById('search-btn');
  const clearBtn = document.getElementById('search-clear');

  let debounceTimer = null;

  const doSearch = () => {
    if (!input || !S.activeSessionId) return;
    const query = input.value.trim();
    if (!query) { clearResults(); return; }
    if (query === lastQuery) return;
    lastQuery = query;
    wsSend({ type: 'file_search', sessionId: S.activeSessionId, query });
  };

  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doSearch, 300);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(debounceTimer); doSearch(); }
    });
  }
  if (btn) btn.addEventListener('click', doSearch);
  if (clearBtn) clearBtn.addEventListener('click', () => {
    if (input) input.value = '';
    lastQuery = '';
    clearResults();
  });
}

export function handleSearchResults(msg) {
  searchResults = msg.results || [];
  renderResults();
}

function clearResults() {
  searchResults = [];
  lastQuery = '';
  renderResults();
}

function renderResults() {
  const container = document.getElementById('search-results');
  const countEl = document.getElementById('search-count');
  if (!container) return;

  if (searchResults.length === 0) {
    container.innerHTML = lastQuery
      ? '<div class="search-empty">No results found</div>'
      : '<div class="search-empty">Type to search in files</div>';
    if (countEl) countEl.textContent = '';
    return;
  }

  // Group by file
  const grouped = {};
  let totalMatches = 0;
  for (const r of searchResults) {
    if (!grouped[r.file]) grouped[r.file] = [];
    grouped[r.file].push(r);
    totalMatches++;
  }

  const fileCount = Object.keys(grouped).length;
  if (countEl) countEl.textContent = `${totalMatches} results in ${fileCount} files`;

  container.innerHTML = '';
  for (const [file, matches] of Object.entries(grouped)) {
    const fileSection = document.createElement('div');
    fileSection.className = 'search-file-group';

    const fileHeader = document.createElement('div');
    fileHeader.className = 'search-file-header';
    const fileName = file.split('/').pop();
    const dirPath = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    fileHeader.innerHTML = `<span class="search-file-name">${escHtml(fileName)}</span>` +
      (dirPath ? `<span class="search-file-dir">${escHtml(dirPath)}</span>` : '') +
      `<span class="search-file-count">${matches.length}</span>`;
    fileSection.appendChild(fileHeader);

    for (const match of matches) {
      const line = document.createElement('div');
      line.className = 'search-match-line';
      const lineNum = document.createElement('span');
      lineNum.className = 'search-line-num';
      lineNum.textContent = match.line;
      const lineText = document.createElement('span');
      lineText.className = 'search-line-text';
      lineText.innerHTML = highlightMatch(match.text, lastQuery);
      line.appendChild(lineNum);
      line.appendChild(lineText);
      fileSection.appendChild(line);
    }

    container.appendChild(fileSection);
  }
}

function highlightMatch(text, query) {
  const escaped = escHtml(text.trim());
  const queryEscaped = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escaped.replace(new RegExp(`(${queryEscaped})`, 'gi'), '<mark class="search-highlight">$1</mark>');
  } catch {
    return escaped;
  }
}

export function onSearchSessionChange() {
  if (lastQuery) {
    wsSend({ type: 'file_search', sessionId: S.activeSessionId, query: lastQuery });
  }
}
