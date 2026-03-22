// ─── INPUT HISTORY POPUP ─────────────────────────────
// Shows recent 20 input entries when '\' is pressed.
// Arrow keys to navigate, Enter to select, Escape to close.
// Selected entry is typed into the active terminal.

import { S, terminalMap } from '../core/state';
import { historyMap } from '../sidebar/prompt-history';

let popup: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let activeIndex = 0;
let items: string[] = [];
let abortCtrl: AbortController | null = null;

function ensurePopup() {
  if (popup) return;
  popup = document.createElement('div');
  popup.id = 'input-history-popup';
  popup.innerHTML = `<div class="ihp-list" id="ihp-list"></div>`;
  document.body.appendChild(popup);
  listEl = popup.querySelector('#ihp-list')!;
}

/** Position popup directly above or below the cursor line */
function positionPopup() {
  if (!popup) return;
  const entry = terminalMap.get(S.activeSessionId);

  const popupW = 460;
  const popupH = popup.offsetHeight || 260;

  if (!entry) {
    // Fallback: center bottom
    popup.style.left = Math.max(8, (window.innerWidth - popupW) / 2) + 'px';
    popup.style.bottom = '40px';
    popup.style.top = 'auto';
    return;
  }

  const term = entry.term;
  const buf = term.buffer.active;
  const termRect = entry.div.getBoundingClientRect();

  // Calculate cursor position from xterm internals
  // Use core dimensions if available, otherwise estimate
  const dims = (term as any)._core?._renderService?.dimensions;
  const cellH = dims?.css?.cell?.height || (termRect.height / term.rows);
  const cellW = dims?.css?.cell?.width || 9;

  // Account for viewport scroll offset
  const viewportEl = entry.div.querySelector('.xterm-viewport') as HTMLElement;
  const scrollTop = viewportEl?.scrollTop || 0;
  const rowsEl = entry.div.querySelector('.xterm-rows') as HTMLElement;
  const rowsTop = rowsEl ? rowsEl.getBoundingClientRect().top : termRect.top;

  const cursorTop = rowsTop + buf.cursorY * cellH;
  const cursorBottom = cursorTop + cellH;
  const cursorLeft = termRect.left + buf.cursorX * cellW;

  // Default: below cursor. If not enough space, show above.
  const spaceBelow = window.innerHeight - cursorBottom - 10;
  let top: number;
  if (spaceBelow >= popupH) {
    top = cursorBottom + 2;
  } else {
    top = cursorTop - popupH - 2;
  }

  let left = cursorLeft;
  if (left + popupW > window.innerWidth - 8) {
    left = window.innerWidth - popupW - 8;
  }
  if (left < 8) left = 8;

  popup.style.top = Math.max(8, top) + 'px';
  popup.style.bottom = 'auto';
  popup.style.left = left + 'px';
}

function getRecentInputs(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  // Gather from all sessions, newest first
  const allEntries: { text: string; time: number }[] = [];
  historyMap.forEach((entries) => {
    entries.forEach((e: any) => {
      allEntries.push({ text: e.text, time: e.time?.getTime?.() || 0 });
    });
  });

  // Sort by time descending (newest first)
  allEntries.sort((a, b) => b.time - a.time);

  for (const e of allEntries) {
    const t = e.text.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    result.push(t);
    if (result.length >= 20) break;
  }

  return result;
}

function render() {
  if (!listEl) return;
  listEl.innerHTML = '';
  if (items.length === 0) {
    listEl.innerHTML = '<div class="ihp-empty">입력 기록이 없습니다</div>';
    return;
  }
  items.forEach((text, i) => {
    const el = document.createElement('div');
    el.className = 'ihp-item' + (i === activeIndex ? ' active' : '');
    const icon = document.createElement('span');
    icon.className = 'ihp-icon';
    icon.textContent = '↵';
    const label = document.createElement('span');
    label.className = 'ihp-label';
    label.textContent = text.length > 100 ? text.slice(0, 97) + '…' : text;
    el.appendChild(icon);
    el.appendChild(label);
    el.title = text;
    el.addEventListener('click', () => {
      selectItem(i);
    });
    el.addEventListener('mouseenter', () => {
      activeIndex = i;
      updateActive();
    });
    listEl!.appendChild(el);
  });
  scrollActiveIntoView();
}

function updateActive() {
  if (!listEl) return;
  const children = listEl.children;
  for (let i = 0; i < children.length; i++) {
    children[i].classList.toggle('active', i === activeIndex);
  }
  scrollActiveIntoView();
}

function scrollActiveIntoView() {
  if (!listEl) return;
  const active = listEl.querySelector('.ihp-item.active') as HTMLElement;
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function selectItem(idx: number) {
  const text = items[idx];
  if (!text) return;
  close();

  // Type the selected text into the active terminal
  const entry = terminalMap.get(S.activeSessionId);
  if (!entry) return;
  const dataWs = entry.dataWs as WebSocket;
  if (dataWs && dataWs.readyState === WebSocket.OPEN) {
    dataWs.send(text);
  }
}

export function open() {
  ensurePopup();
  items = getRecentInputs();
  activeIndex = 0;
  render();
  popup!.classList.add('open');
  positionPopup();

  // Keyboard navigation
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();

  document.addEventListener('keydown', onKeydown, { signal: abortCtrl.signal, capture: true });

  // Close on click outside
  setTimeout(() => {
    document.addEventListener('click', onClickOutside, { signal: abortCtrl!.signal });
  }, 0);
}

export function close() {
  if (popup) popup.classList.remove('open');
  if (abortCtrl) {
    abortCtrl.abort();
    abortCtrl = null;
  }
  // Refocus terminal
  const entry = terminalMap.get(S.activeSessionId);
  if (entry) entry.term.focus();
}

export function isOpen(): boolean {
  return popup?.classList.contains('open') ?? false;
}

/** Called from xterm key handler and document keydown */
export function handleKey(key: string) {
  if (key === 'Escape') { close(); return; }
  if (key === 'ArrowDown') {
    activeIndex = (activeIndex + 1) % Math.max(1, items.length);
    updateActive();
    return;
  }
  if (key === 'ArrowUp') {
    activeIndex = (activeIndex - 1 + items.length) % Math.max(1, items.length);
    updateActive();
    return;
  }
  if (key === 'Enter') {
    if (items.length > 0) selectItem(activeIndex);
    return;
  }
  // Ignore modifier keys
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) return;
  // Any other key closes the popup
  close();
}

function onKeydown(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  handleKey(e.key);
}

function onClickOutside(e: MouseEvent) {
  if (popup && !popup.contains(e.target as Node)) {
    close();
  }
}
