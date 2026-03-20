import { S, sessionMeta } from '../core/state';
import { getCommands, executeCommand, getRecentCommands, getCommand } from '../core/command-registry';
import { THEMES } from '../core/constants';
import { applyTheme } from './themes';
import { getExplorerTree } from '../sidebar/explorer';

type PaletteMode = 'quick-open' | 'command' | 'theme';

let overlay: HTMLElement;
let input: HTMLInputElement;
let list: HTMLElement;
let footer: HTMLElement;

let mode: PaletteMode = 'quick-open';
let activeIndex = 0;
let currentItems: PaletteItem[] = [];
let savedTheme: any = null;

interface PaletteItem {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  icon?: string;
  meta?: string;
  matchPositions?: number[];
  execute: () => void;
}

// ═══════════════════════════════════════════════════
//  Init, open, close
// ═══════════════════════════════════════════════════

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
  if (mode === 'theme' && savedTheme) {
    applyTheme(savedTheme);
    savedTheme = null;
  }
  mode = 'quick-open';
}

export function isPaletteOpen(): boolean {
  return overlay.classList.contains('open');
}

// ═══════════════════════════════════════════════════
//  Fuzzy search
// ═══════════════════════════════════════════════════

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
      if (prevMatch === ti - 1) score += 5;
      if (ti === 0 || /[\s_\-.]/.test(text[ti - 1])) score += 10;
      if (text[ti] === query[qi]) score += 1;
      score += 1;
      prevMatch = ti;
      qi++;
    }
  }

  if (qi < lq.length) return null;
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

// ═══════════════════════════════════════════════════
//  Item builders
// ═══════════════════════════════════════════════════

function buildCommandItems(query: string): PaletteItem[] {
  const commands = getCommands();
  const kb = S.settings?.keybindings || {};
  const items: (PaletteItem & { score: number })[] = [];

  for (const cmd of commands) {
    if (!cmd.category) continue;
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
  const openFilePaths = new Set<string>();
  const fileTabs = document.querySelectorAll('.tab[data-file-path]');
  fileTabs.forEach((tab) => {
    const filePath = (tab as HTMLElement).dataset.filePath!;
    openFilePaths.add(filePath);
    const fileName = filePath.split('/').pop() || filePath;
    const match = query ? fuzzyMatch(query, fileName) : { score: 0, positions: [] };
    if (!match && query) return;
    items.push({
      id: `file:${filePath}`,
      label: fileName,
      category: '열린 파일',
      meta: filePath,
      icon: '📄',
      matchPositions: match?.positions || [],
      score: (match?.score || 0) + 50, // boost open files above project files
      execute: () => {
        const clickEvt = new MouseEvent('click');
        tab.dispatchEvent(clickEvt);
      },
    });
  });

  // Project files from explorer tree (only when searching)
  if (query) {
    const tree = getExplorerTree();
    const flatFiles = flattenTree(tree);
    for (const file of flatFiles) {
      if (openFilePaths.has(file.path)) continue; // skip already-open files
      const match = fuzzyMatch(query, file.name);
      if (!match) continue;
      items.push({
        id: `project:${file.path}`,
        label: file.name,
        category: '프로젝트 파일',
        meta: file.path,
        icon: '📄',
        matchPositions: match.positions,
        score: match.score,
        execute: () => {
          if (!S.activeSessionId) return;
          import('../core/websocket').then(({ wsSend }) => {
            wsSend({ type: 'file_read', sessionId: S.activeSessionId, filePath: file.path });
          });
        },
      });
    }
  }

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
          savedTheme = null;
          if (S.pendingSettings) {
            S.pendingSettings.appearance.theme = t.id;
          }
          if (S.settings) {
            S.settings.appearance.theme = t.id;
            import('../core/websocket').then(({ apiFetch }) => {
              apiFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(S.settings),
              });
            });
          }
        },
      } as PaletteItem & { score: number };
    })
    .filter(Boolean)
    .sort((a, b) => (b as any).score - (a as any).score) as PaletteItem[];
}

function flattenTree(tree: any[]): Array<{ name: string; path: string }> {
  const result: Array<{ name: string; path: string }> = [];
  function walk(entries: any[]) {
    for (const entry of entries) {
      if (entry.type === 'file') {
        result.push({ name: entry.name, path: entry.path });
      }
      if (entry.children) {
        walk(entry.children);
      }
    }
  }
  walk(tree);
  return result;
}

function formatShortcut(combo: string): string {
  return combo
    .replace('Meta', '⌘')
    .replace('Ctrl', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace(/\+/g, '');
}

// ═══════════════════════════════════════════════════
//  Input handler with mode detection
// ═══════════════════════════════════════════════════

function onInput() {
  const raw = input.value;

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
      const recentIds = new Set(recentItems.map(i => i.id));
      items = [...recentItems, ...items.filter(i => !recentIds.has(i.id))];
    }
  }

  currentItems = items;
  activeIndex = 0;
  renderList();
}

// ═══════════════════════════════════════════════════
//  Rendering
// ═══════════════════════════════════════════════════

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
  const activeEl = list.querySelector('.cp-item.active');
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });

  if (mode === 'theme' && currentItems[idx]) {
    const themeId = currentItems[idx].id.replace('theme:', '');
    const theme = THEMES.find((t) => t.id === themeId);
    if (theme) applyTheme(theme, true);
  }
}

function selectItem(idx: number) {
  const item = currentItems[idx];
  if (!item) return;

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

// ═══════════════════════════════════════════════════
//  Keyboard navigation
// ═══════════════════════════════════════════════════

function onKeydown(e: KeyboardEvent) {
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      e.stopPropagation();
      setActive(Math.min(activeIndex + 1, currentItems.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      e.stopPropagation();
      setActive(Math.max(activeIndex - 1, 0));
      break;
    case 'Enter':
      e.preventDefault();
      e.stopPropagation();
      selectItem(activeIndex);
      break;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      closePalette();
      break;
    // All other keys: let them propagate (allows Cmd+P toggle to work via tryKeybinding)
  }
}
