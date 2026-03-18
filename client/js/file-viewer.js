// ─── FILE VIEWER: opens files from explorer as tabs in main view ───
import { S, terminalMap, tabBar, tabAddBtn, termWrapper, escHtml } from './state.js';

// Map<filePath, { tabEl, paneEl }>
const fileTabs = new Map();
let activeFilePath = null;
let previewFilePath = null; // single preview tab (replaced on next click)

export function openFileTab(filePath, content, opts = {}) {
  const isBinary = opts.binary;
  const isImage = opts.isImage;
  const imageData = opts.imageData;
  const imageMime = opts.imageMime;
  const error = opts.error;

  // If there's a preview tab and it's a different file, replace it
  if (previewFilePath && previewFilePath !== filePath && fileTabs.has(previewFilePath)) {
    closeFileTab(previewFilePath);
  }

  if (fileTabs.has(filePath)) {
    // Already open — just activate and update content
    activateFileTab(filePath);
    updateFileContent(filePath, content, { binary: isBinary, isImage, imageData, imageMime, error });
    return;
  }

  // Create tab
  const tabEl = document.createElement('div');
  tabEl.className = 'tab file-tab preview-tab';
  tabEl.dataset.filePath = filePath;
  const fileName = filePath.split('/').pop();
  tabEl.innerHTML = `
    <span class="tab-file-icon">${getFileIcon(fileName)}</span>
    <span class="tab-name">${escHtml(fileName)}</span>
    <button class="tab-close-btn">✕</button>
  `;
  tabEl.title = filePath;

  tabEl.addEventListener('click', (e) => {
    if (e.target.closest('.tab-close-btn')) { closeFileTab(filePath); return; }
    activateFileTab(filePath);
  });

  // Double click → pin (no longer preview)
  tabEl.addEventListener('dblclick', () => {
    pinFileTab(filePath);
  });

  tabBar.insertBefore(tabEl, tabAddBtn);

  // Create pane
  const paneEl = document.createElement('div');
  paneEl.className = 'file-pane';
  paneEl.dataset.filePath = filePath;

  // Header bar
  const headerEl = document.createElement('div');
  headerEl.className = 'file-pane-header';
  const pathParts = filePath.split('/');
  const shortPath = pathParts.length > 3 ? '…/' + pathParts.slice(-3).join('/') : filePath;
  headerEl.innerHTML = `<span class="file-pane-path">${escHtml(shortPath)}</span>`;
  paneEl.appendChild(headerEl);

  // Content area
  const contentEl = document.createElement('div');
  contentEl.className = 'file-pane-content';
  paneEl.appendChild(contentEl);

  termWrapper.appendChild(paneEl);

  fileTabs.set(filePath, { tabEl, paneEl, contentEl });
  previewFilePath = filePath;

  updateFileContent(filePath, content, { binary: isBinary, isImage, imageData, imageMime, error });
  activateFileTab(filePath);
}

// Map file extensions to highlight.js language names
function getHljsLang(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const langMap = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', mts: 'typescript', cts: 'typescript',
    jsx: 'javascript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go',
    java: 'java', kt: 'kotlin', scala: 'scala',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp', swift: 'swift', m: 'objectivec',
    html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
    css: 'css', scss: 'scss', less: 'less', sass: 'scss',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
    md: 'markdown', markdown: 'markdown',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
    sql: 'sql', graphql: 'graphql', gql: 'graphql',
    php: 'php', lua: 'lua', r: 'r', pl: 'perl',
    dockerfile: 'dockerfile', makefile: 'makefile',
    tf: 'hcl', hcl: 'hcl',
    vue: 'xml', svelte: 'xml',
    ini: 'ini', conf: 'ini', cfg: 'ini',
    diff: 'diff', patch: 'diff',
    zig: 'zig', nim: 'nim', ex: 'elixir', exs: 'elixir',
    erl: 'erlang', hs: 'haskell', clj: 'clojure',
  };
  // Also check filename (e.g. Dockerfile, Makefile)
  const name = filePath.split('/').pop()?.toLowerCase() || '';
  if (name === 'dockerfile') return 'dockerfile';
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile';
  return langMap[ext] || null;
}

function updateFileContent(filePath, content, opts = {}) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;

  const { contentEl } = entry;

  if (opts.error) {
    contentEl.innerHTML = `<div class="file-pane-error">${escHtml(opts.error)}</div>`;
    return;
  }

  // Image preview
  if (opts.isImage && opts.imageData && opts.imageMime) {
    const dataUrl = `data:${opts.imageMime};base64,${opts.imageData}`;
    contentEl.innerHTML = `<div class="file-pane-image">
      <img src="${dataUrl}" alt="${escHtml(filePath.split('/').pop())}" />
      <div class="file-pane-image-info">${escHtml(filePath.split('/').pop())}</div>
    </div>`;
    return;
  }

  if (opts.binary) {
    contentEl.innerHTML = '<div class="file-pane-error">Binary file — cannot preview</div>';
    return;
  }

  const text = content || '';
  const lines = text.split('\n');
  const gutterWidth = String(lines.length).length;

  // Try syntax highlighting with highlight.js
  const lang = getHljsLang(filePath);
  let highlightedLines;

  if (lang && typeof hljs !== 'undefined') {
    try {
      const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
      // Split highlighted HTML by newline — hljs returns a single HTML string
      highlightedLines = splitHighlightedLines(result.value);
    } catch {
      highlightedLines = null;
    }
  }

  if (highlightedLines && highlightedLines.length === lines.length) {
    contentEl.innerHTML = highlightedLines.map((html, i) =>
      `<div class="fl"><span class="fl-ln" style="min-width:${gutterWidth}ch">${i + 1}</span><span class="fl-code">${html || ' '}</span></div>`
    ).join('');
  } else {
    contentEl.innerHTML = lines.map((line, i) =>
      `<div class="fl"><span class="fl-ln" style="min-width:${gutterWidth}ch">${i + 1}</span><span class="fl-code">${escHtml(line) || ' '}</span></div>`
    ).join('');
  }
}

// Split highlight.js output HTML by newlines while preserving open span tags across lines
function splitHighlightedLines(html) {
  const rawLines = html.split('\n');
  const result = [];
  let openSpans = []; // stack of open <span ...> tags carried from previous lines

  for (const rawLine of rawLines) {
    // Prepend carried-over open spans, append the raw line content
    const prefix = openSpans.join('');
    const fullLine = prefix + rawLine;

    // Parse only the RAW line (not prefix) to update the span stack
    const newSpans = [...openSpans];
    const tagRegex = /<(\/?)span([^>]*)>/g;
    let m;
    while ((m = tagRegex.exec(rawLine)) !== null) {
      if (m[1] === '/') {
        newSpans.pop();
      } else {
        newSpans.push(`<span${m[2]}>`);
      }
    }

    // Close any unclosed spans at end of line for valid HTML
    const suffix = '</span>'.repeat(newSpans.length);
    result.push(fullLine + suffix);

    openSpans = newSpans;
  }

  return result;
}

export function activateFileTab(filePath) {
  if (!fileTabs.has(filePath)) return;

  activeFilePath = filePath;

  // Deactivate all terminal tabs/panes
  terminalMap.forEach(({ div, tabEl }) => {
    div.classList.remove('active');
    tabEl.classList.remove('active');
  });

  // Deactivate all file tabs/panes, activate target
  fileTabs.forEach(({ tabEl, paneEl }, fp) => {
    const isActive = fp === filePath;
    tabEl.classList.toggle('active', isActive);
    paneEl.classList.toggle('active', isActive);
  });

  // Update status bar
  const fileName = filePath.split('/').pop();
}

export function closeFileTab(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;

  entry.tabEl.remove();
  entry.paneEl.remove();
  fileTabs.delete(filePath);

  if (previewFilePath === filePath) previewFilePath = null;

  // If this was the active file, switch to another tab
  if (activeFilePath === filePath) {
    activeFilePath = null;
    // Try to activate another file tab, or fall back to active session
    if (fileTabs.size > 0) {
      activateFileTab(fileTabs.keys().next().value);
    } else if (S.activeSessionId && terminalMap.has(S.activeSessionId)) {
      deactivateAllFileTabs();
      if (_activateSession) _activateSession(S.activeSessionId);
    }
  }
}

function pinFileTab(filePath) {
  const entry = fileTabs.get(filePath);
  if (!entry) return;
  entry.tabEl.classList.remove('preview-tab');
  if (previewFilePath === filePath) previewFilePath = null;
}

export function deactivateAllFileTabs() {
  activeFilePath = null;
  fileTabs.forEach(({ tabEl, paneEl }) => {
    tabEl.classList.remove('active');
    paneEl.classList.remove('active');
  });
}

export function getActiveFilePath() {
  return activeFilePath;
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

// Lazy import to avoid circular dependency
let _activateSession = null;
export function setActivateSessionFn(fn) {
  _activateSession = fn;
}
