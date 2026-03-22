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
  popup.innerHTML = `
    <div class="ihp-header">RECENT INPUTS</div>
    <div class="ihp-list" id="ihp-list"></div>
    <div class="ihp-footer">↑↓ 이동 · Enter 선택 · Esc 닫기</div>
  `;
  document.body.appendChild(popup);
  listEl = popup.querySelector('#ihp-list')!;
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
    el.textContent = text.length > 80 ? text.slice(0, 77) + '…' : text;
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

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    activeIndex = (activeIndex + 1) % Math.max(1, items.length);
    updateActive();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    activeIndex = (activeIndex - 1 + items.length) % Math.max(1, items.length);
    updateActive();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    if (items.length > 0) selectItem(activeIndex);
    return;
  }
  // Any other key closes the popup
  e.preventDefault();
  e.stopPropagation();
  close();
}

function onClickOutside(e: MouseEvent) {
  if (popup && !popup.contains(e.target as Node)) {
    close();
  }
}
