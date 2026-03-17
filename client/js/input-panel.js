// ─── INPUT HISTORY PANEL ─────────────────────────────
// Tracks user input (Enter presses) per session and displays
// them in the right panel. Clicking an entry scrolls the
// terminal to that line.

import { S, terminalMap, stripAnsi } from './state.js';

const panelList = document.getElementById('input-panel-list');
const panel = document.getElementById('input-panel');
const toggle = document.getElementById('input-panel-toggle');
const clearBtn = document.getElementById('input-panel-clear');

// sessionId → [ { text, bufferLine, time } ]
const historyMap = new Map();
// Per-session input buffer (accumulates typed chars until Enter)
const inputBuffers = new Map();

let counter = 0;

export function initInputPanel() {
  toggle.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    toggle.textContent = panel.classList.contains('collapsed') ? '▸' : '◂';
  });

  clearBtn.addEventListener('click', () => {
    if (S.activeSessionId) {
      historyMap.delete(S.activeSessionId);
    }
    renderPanel();
  });
}

/** Call this when user types data in the terminal (from term.onData) */
export function trackInput(sessionId, data) {
  if (!inputBuffers.has(sessionId)) inputBuffers.set(sessionId, '');

  if (data === '\r' || data === '\n') {
    // Enter pressed — capture what's on the current terminal line
    const entry = terminalMap.get(sessionId);
    if (!entry) return;

    const term = entry.term;
    const buf = term.buffer.active;
    const lineIndex = buf.baseY + buf.cursorY;
    const line = buf.getLine(buf.cursorY);
    if (!line) return;

    const rawText = line.translateToString(true).trim();
    if (!rawText) return;

    // Strip common prompt prefixes to get just user input
    const userInput = extractUserInput(rawText);
    if (!userInput) return;

    if (!historyMap.has(sessionId)) historyMap.set(sessionId, []);
    const entries = historyMap.get(sessionId);
    entries.push({
      text: userInput,
      fullLine: rawText,
      bufferLine: lineIndex,
      time: new Date(),
    });

    // Keep max 200 entries per session
    if (entries.length > 200) entries.shift();

    if (sessionId === S.activeSessionId) renderPanel();
    inputBuffers.set(sessionId, '');
  } else if (data === '\x7f') {
    // Backspace
    const current = inputBuffers.get(sessionId) || '';
    inputBuffers.set(sessionId, current.slice(0, -1));
  } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
    // Printable char
    inputBuffers.set(sessionId, (inputBuffers.get(sessionId) || '') + data);
  }
}

function extractUserInput(rawLine) {
  const stripped = stripAnsi(rawLine);
  // Remove common prompt patterns: $, %, >, #, ❯, ›, etc.
  const match = stripped.match(/(?:[$%>#❯›]\s*)(.+)/);
  if (match) return match[1].trim();
  // If no prompt found, return the whole line (could be a continuation)
  return stripped.length > 2 ? stripped : '';
}

/** Refresh the panel to show entries for the active session */
export function renderPanel() {
  panelList.innerHTML = '';
  if (!S.activeSessionId) return;

  const entries = historyMap.get(S.activeSessionId) || [];
  entries.forEach((entry, i) => {
    const el = document.createElement('div');
    el.className = 'input-entry';
    const timeStr = entry.time.toTimeString().slice(0, 5);
    el.innerHTML = `
      <span class="input-entry-num">${i + 1}</span>
      <span class="input-entry-text" title="${escAttr(entry.fullLine)}">${escHtml(entry.text)}</span>
      <span class="input-entry-time">${timeStr}</span>
    `;
    el.addEventListener('click', () => scrollToEntry(entry));
    panelList.appendChild(el);
  });

  // Auto-scroll panel to bottom
  panelList.scrollTop = panelList.scrollHeight;
}

function scrollToEntry(entry) {
  const termEntry = terminalMap.get(S.activeSessionId);
  if (!termEntry) return;
  const term = termEntry.term;
  // scrollToLine expects a line index relative to the scrollback buffer
  const targetLine = Math.max(0, entry.bufferLine - Math.floor(term.rows / 2));
  term.scrollToLine(targetLine);
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

/** Call when active session changes to refresh the panel */
export function onSessionChange() {
  renderPanel();
}
