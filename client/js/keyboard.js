// ─── CENTRALIZED KEYBOARD HANDLER ─────────────────────
// All keybinding matching & action execution in one place.
// Called from both xterm custom key handler and document keydown.

import { S, terminalMap, settingsOverlay } from './state.js';
import { normalizeKey, KB_DEFS } from './constants.js';

const actionMap = new Map();   // action name → callback

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
  const def = KB_DEFS.find(d => d.key === action);
  const label = def ? def.label : action;
  const displayCombo = combo
    .replace('Meta', '⌘').replace('Ctrl', '⌃')
    .replace('Shift', '⇧').replace('Alt', '⌥')
    .replace(/\+/g, ' ');
  el.innerHTML = `<span class="shortcut-overlay-keys">${displayCombo}</span><span class="shortcut-overlay-label">${label}</span>`;
  el.classList.add('visible');
  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => el.classList.remove('visible'), 800);
}

export function registerAction(name, fn) {
  actionMap.set(name, fn);
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
export function matchCombo(combo) {
  const kb = S.settings?.keybindings || {};
  for (const [action, binding] of Object.entries(kb)) {
    if (binding === combo) return action;
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
  if (e._kbHandled) return true;   // already executed by xterm handler

  const combo = buildCombo(e);
  const action = matchCombo(combo);
  if (!action) return false;

  const fn = actionMap.get(action);
  if (fn) {
    e.preventDefault();
    e._kbHandled = true;
    showShortcutOverlay(combo, action);
    fn();
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
  if (tryKeybinding(e)) return false;  // matched → don't let xterm handle it
  return true;                          // not matched → let xterm handle it
}
