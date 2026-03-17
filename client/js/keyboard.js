// ─── CENTRALIZED KEYBOARD HANDLER ─────────────────────
// All keybinding matching & action execution in one place.
// Called from both xterm custom key handler and document keydown.

import { S, terminalMap, settingsOverlay } from './state.js';
import { normalizeKey } from './constants.js';

const actionMap = new Map();   // action name → callback

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

  const combo = buildCombo(e);
  const action = matchCombo(combo);
  if (!action) return false;

  const fn = actionMap.get(action);
  if (fn) {
    e.preventDefault();
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
