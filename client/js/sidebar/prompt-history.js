// ─── INPUT HISTORY PANEL ─────────────────────────────
// Tracks user input (Enter presses) per session and displays
// them in the right panel. Clicking an entry scrolls the
// terminal to that line.
// For Claude Code sessions, fetches actual prompts from JSONL files.

import { S, terminalMap, sessionMeta, stripAnsi } from '../core/state.js';
import { wsSend } from '../core/websocket.js';

const panelList = document.getElementById('input-panel-list');
const panel = document.getElementById('input-panel');
const toggle = document.getElementById('input-panel-toggle');
const clearBtn = document.getElementById('input-panel-clear');
const titleEl = panel.querySelector('.input-panel-title');

// sessionId → [ { text, bufferLine, time } ]
const historyMap = new Map();
// Per-session input buffer (accumulates typed chars until Enter)
const inputBuffers = new Map();
// sessionId → [ { text, timestamp } ] (Claude prompts from JSONL)
const claudePromptsMap = new Map();
// Polling timer for Claude prompts
let claudePollTimer = null;

export function toggleInputPanel() {
  panel.classList.toggle('collapsed');
  toggle.textContent = panel.classList.contains('collapsed') ? '▸' : '◂';
}

export function initInputPanel() {
  toggle.addEventListener('click', () => toggleInputPanel());

  clearBtn.addEventListener('click', () => {
    if (S.activeSessionId) {
      historyMap.delete(S.activeSessionId);
      claudePromptsMap.delete(S.activeSessionId);
    }
    renderPanel();
  });
}

function isClaudeSession(sessionId) {
  const meta = sessionMeta.get(sessionId);
  return meta && meta.ai === 'claude';
}

/** Request Claude prompts from server */
function fetchClaudePrompts(sessionId) {
  wsSend({ type: 'claude_prompts', sessionId });
}

/** Handle claude_prompts_data from server */
export function handleClaudePrompts(msg) {
  if (!msg.sessionId || !msg.prompts) return;
  claudePromptsMap.set(msg.sessionId, msg.prompts);
  if (msg.sessionId === S.activeSessionId) renderPanel();
}

function startClaudePoll() {
  stopClaudePoll();
  claudePollTimer = setInterval(() => {
    if (S.activeSessionId && isClaudeSession(S.activeSessionId)) {
      fetchClaudePrompts(S.activeSessionId);
    }
  }, 5000);
}

function stopClaudePoll() {
  if (claudePollTimer) {
    clearInterval(claudePollTimer);
    claudePollTimer = null;
  }
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

    if (sessionId === S.activeSessionId && !isClaudeSession(sessionId)) renderPanel();
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

  if (isClaudeSession(S.activeSessionId)) {
    renderClaudePrompts();
  } else {
    renderInputHistory();
  }
}

function renderClaudePrompts() {
  if (titleEl) titleEl.textContent = 'CLAUDE PROMPTS';
  const allPrompts = claudePromptsMap.get(S.activeSessionId) || [];
  const meta = sessionMeta.get(S.activeSessionId);
  const sessionCreatedAt = meta && meta.createdAt ? meta.createdAt : 0;
  const prompts = allPrompts.filter(
    (p) => p.timestamp && new Date(p.timestamp).getTime() >= sessionCreatedAt
  );
  if (prompts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'input-entry-empty';
    empty.textContent = 'No prompts yet...';
    panelList.appendChild(empty);
    return;
  }

  prompts.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = 'input-entry claude-prompt-entry';
    const timeStr = p.timestamp ? new Date(p.timestamp).toTimeString().slice(0, 5) : '';
    const preview = p.text.length > 120 ? p.text.slice(0, 120) + '…' : p.text;
    el.innerHTML = `
      <span class="input-entry-num">${i + 1}</span>
      <span class="input-entry-text" title="${escAttr(p.text)}">${escHtml(preview)}</span>
      <span class="input-entry-time">${timeStr}</span>
    `;
    el.addEventListener('click', () => {
      scrollToPromptInTerminal(p.text);
      navigator.clipboard.writeText(p.text).catch(() => {});
      el.classList.add('copied');
      setTimeout(() => el.classList.remove('copied'), 600);
    });
    panelList.appendChild(el);
  });

  panelList.scrollTop = panelList.scrollHeight;
}

function renderInputHistory() {
  if (titleEl) titleEl.textContent = 'INPUT HISTORY';
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

  panelList.scrollTop = panelList.scrollHeight;
}

function scrollToPromptInTerminal(text) {
  const termEntry = terminalMap.get(S.activeSessionId);
  if (!termEntry) return;
  const term = termEntry.term;
  const buf = term.buffer.active;
  const totalLines = buf.baseY + buf.cursorY;
  // Search for the prompt text in terminal buffer (search first 40 chars to handle wrapping)
  const needle = stripAnsi(text).slice(0, 40);
  if (!needle) return;
  for (let i = 0; i <= totalLines; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const lineText = line.translateToString(true);
    if (lineText.includes(needle)) {
      const targetLine = Math.max(0, i - Math.floor(term.rows / 2));
      term.scrollToLine(targetLine);
      return;
    }
  }
}

function scrollToEntry(entry) {
  const termEntry = terminalMap.get(S.activeSessionId);
  if (!termEntry) return;
  const term = termEntry.term;
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
  if (S.activeSessionId && isClaudeSession(S.activeSessionId)) {
    fetchClaudePrompts(S.activeSessionId);
    startClaudePoll();
  } else {
    stopClaudePoll();
  }
  renderPanel();
}
