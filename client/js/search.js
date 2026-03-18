// ─── SEARCH PANEL ────────────────────────────────────────────────
import { S, sessionMeta, escHtml } from './state.js';
import { wsSend } from './websocket.js';
import { setActivityBadge } from './activity-bar.js';
import { showToast } from './toast.js';

let searchResults = [];
let lastQuery = '';
let caseSensitive = false;
let useRegex = false;
let replaceVisible = false;

export function initSearch() {
  const input = document.getElementById('search-input');
  const btn = document.getElementById('search-btn');
  const clearBtn = document.getElementById('search-clear');
  const caseBtn = document.getElementById('search-opt-case');
  const regexBtn = document.getElementById('search-opt-regex');
  const includeInput = document.getElementById('search-include');
  const replaceToggle = document.getElementById('search-replace-toggle');
  const replaceInput = document.getElementById('search-replace-input');
  const replaceBtn = document.getElementById('search-replace-btn');
  const replaceAllBtn = document.getElementById('search-replace-all-btn');
  const replaceRow = document.getElementById('search-replace-row');

  let debounceTimer = null;

  const doSearch = () => {
    if (!input || !S.activeSessionId) return;
    const query = input.value.trim();
    if (!query) { clearResults(); return; }
    lastQuery = query;
    const include = includeInput?.value.trim() || '';
    wsSend({ type: 'file_search', sessionId: S.activeSessionId, query, caseSensitive, useRegex, include });
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

  // Toggle buttons
  if (caseBtn) caseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    caseBtn.classList.toggle('active', caseSensitive);
    if (lastQuery) doSearch();
  });
  if (regexBtn) regexBtn.addEventListener('click', () => {
    useRegex = !useRegex;
    regexBtn.classList.toggle('active', useRegex);
    if (lastQuery) doSearch();
  });
  if (includeInput) includeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && lastQuery) doSearch();
  });

  // Replace toggle
  if (replaceToggle && replaceRow) {
    replaceToggle.addEventListener('click', () => {
      replaceVisible = !replaceVisible;
      replaceRow.style.display = replaceVisible ? 'flex' : 'none';
      replaceToggle.textContent = replaceVisible ? '▾' : '▸';
    });
  }

  // Replace in file / Replace all
  if (replaceBtn) replaceBtn.addEventListener('click', () => {
    if (!lastQuery || !replaceInput || !S.activeSessionId) return;
    const replacement = replaceInput.value;
    // Replace in first matching file
    if (searchResults.length > 0) {
      const file = searchResults[0].file;
      wsSend({ type: 'file_replace', sessionId: S.activeSessionId, query: lastQuery, replacement, filePath: file, caseSensitive, useRegex });
    }
  });
  if (replaceAllBtn) replaceAllBtn.addEventListener('click', () => {
    if (!lastQuery || !replaceInput || !S.activeSessionId) return;
    const replacement = replaceInput.value;
    if (!confirm(`Replace all occurrences of "${lastQuery}" with "${replacement}"?`)) return;
    const includeVal = includeInput?.value.trim() || '';
    wsSend({ type: 'file_replace_all', sessionId: S.activeSessionId, query: lastQuery, replacement, caseSensitive, useRegex, include: includeVal });
  });
}

export function handleSearchResults(msg) {
  searchResults = msg.results || [];
  setActivityBadge('search', searchResults.length);
  renderResults();
}

export function handleReplaceAck(msg) {
  if (msg.ok) {
    showToast(`Replaced ${msg.count || 0} occurrences`, 'success');
    // Re-search to refresh results
    if (lastQuery && S.activeSessionId) {
      wsSend({ type: 'file_search', sessionId: S.activeSessionId, query: lastQuery, caseSensitive, useRegex });
    }
  } else {
    showToast('Replace failed: ' + (msg.error || 'unknown'), 'error');
  }
}

function clearResults() {
  searchResults = [];
  lastQuery = '';
  setActivityBadge('search', 0);
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

    // Click file header to preview file
    fileHeader.style.cursor = 'pointer';
    fileHeader.addEventListener('click', () => {
      if (!S.activeSessionId) return;
      wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath: file });
    });

    fileSection.appendChild(fileHeader);

    for (const match of matches) {
      const line = document.createElement('div');
      line.className = 'search-match-line';
      line.addEventListener('click', () => {
        if (!S.activeSessionId) return;
        wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath: file });
      });
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
  if (useRegex) {
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      return escaped.replace(new RegExp(`(${query})`, flags), '<mark class="search-highlight">$1</mark>');
    } catch {
      return escaped;
    }
  }
  const queryEscaped = escHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return escaped.replace(new RegExp(`(${queryEscaped})`, flags), '<mark class="search-highlight">$1</mark>');
  } catch {
    return escaped;
  }
}

export function onSearchSessionChange() {
  if (lastQuery) {
    wsSend({ type: 'file_search', sessionId: S.activeSessionId, query: lastQuery, caseSensitive, useRegex });
  }
}
