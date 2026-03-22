// ─── CENTRALIZED KEYBOARD HANDLER ─────────────────────
// All keybinding matching & action execution in one place.
// Called from both xterm custom key handler and document keydown.

import { S } from './state';
import { normalizeKey, KB_DEFS } from './constants';
import { registerCommand, executeCommand, getCommand } from './command-registry';
import { open as openInputHistory, isOpen as isInputHistoryOpen } from '../ui/input-history-popup';

// ─── SHORTCUT OVERLAY ────────────────────────────────
let overlayEl = null;
let overlayTimer = null;

function getOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'shortcut-overlay';
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function showShortcutOverlay(combo, action) {
  const el = getOverlay();
  const def = KB_DEFS.find((d) => d.key === action);
  const label = def ? def.label : action;
  const displayCombo = combo
    .replace('Meta', '⌘')
    .replace('Ctrl', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace(/\+/g, ' ');
  el.innerHTML = `<span class="shortcut-overlay-keys">${displayCombo}</span><span class="shortcut-overlay-label">${label}</span>`;
  el.classList.add('visible');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => el.classList.remove('visible'), 800);
}

export function registerAction(name: string, fn: () => void) {
  registerCommand({ id: name, label: name, category: '', execute: fn });
}

export function buildCombo(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) parts.push(normalizeKey(e));
  return parts.join('+');
}

/** Returns the matched action name, or null */
function normalizeCombo(c: string): string {
  const parts = c.split('+');
  const key = parts.pop()!;
  parts.sort();
  return [...parts, key].join('+');
}

export function matchCombo(combo) {
  const kb = S.settings?.keybindings || {};
  const norm = normalizeCombo(combo);
  for (const [action, binding] of Object.entries(kb)) {
    if (normalizeCombo(binding as string) === norm) return action;
  }
  return null;
}

/**
 * Try to execute a keybinding action for the given event.
 * Returns true if an action was matched and executed.
 */
export function tryKeybinding(e) {
  if (!S.settings) return false;
  if (e.type !== 'keydown') return false;
  if (e.isComposing) return false; // IME 조합 중엔 단축키 처리 안 함
  if (e._kbHandled) return true; // already executed by xterm handler

  const combo = buildCombo(e);
  const action = matchCombo(combo);
  if (!action) return false;

  const cmd = getCommand(action);
  if (cmd) {
    e.preventDefault();
    e._kbHandled = true;
    showShortcutOverlay(combo, action);
    executeCommand(action);
    return true;
  }
  return false;
}

/**
 * For xterm's attachCustomKeyEventHandler.
 * Returns false (= skip xterm processing) if the combo matches an app keybinding,
 * AND executes the action immediately.
 */
export function xtermKeyHandler(e) {
  if (e.type !== 'keydown') return true;
  if (e.isComposing) return true; // IME 조합 중 — xterm 내부 IME 처리에 맡김
  if (tryKeybinding(e)) return false; // matched → don't let xterm handle it

  // '\' key → open input history popup (no modifiers)
  if (e.key === '\\' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    if (!isInputHistoryOpen()) {
      e.preventDefault();
      openInputHistory();
      return false;
    }
  }

  return true; // not matched → let xterm handle it
}
