// ─── INPUT HISTORY PANEL ─────────────────────────────
// Tracks user input (Enter presses) per session and displays
// them in the right panel. Clicking an entry scrolls the
// terminal to that line.
// For Claude Code sessions, fetches actual prompts from JSONL files.

import { S, terminalMap, sessionMeta, stripAnsi } from '../core/state';
import { wsSend } from '../core/websocket';

function fitActiveTerminal() {
  const entry = terminalMap.get(S.activeSessionId);
  if (entry?.fitAddon) {
    // Wait for CSS transition to complete before fitting
    setTimeout(() => entry.fitAddon.fit(), 220);
  }
}

const panelList = document.getElementById('input-panel-list');
const panel = document.getElementById('input-panel');
const toggle = document.getElementById('input-panel-toggle');
const clearBtn = document.getElementById('input-panel-clear');
const titleEl = panel.querySelector('.input-panel-title');

// sessionId → [ { text, bufferLine, time } ]
export const historyMap = new Map();
// Per-session input buffer (accumulates typed chars until Enter)
const inputBuffers = new Map();
// Tracks pending Enter per session — waits for compositionend before capturing
const pendingEnter = new Map<string, number>(); // sessionId → bufferLine
// sessionId → [ { text, timestamp } ] (Claude prompts from JSONL)
const claudePromptsMap = new Map();
// Polling timer for Claude prompts
let claudePollTimer = null;

export function toggleInputPanel() {
  panel.classList.toggle('collapsed');
  toggle.textContent = panel.classList.contains('collapsed') ? '▸' : '◂';
  fitActiveTerminal();
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

  initInputPanelResize();
}

function initInputPanelResize() {
  const handle = document.getElementById('input-panel-resize');
  if (!handle) return;
  let startX = 0, startW = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--input-panel-w')) || 260;
    handle.classList.add('dragging');
    panel.style.transition = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e: MouseEvent) {
    const delta = startX - e.clientX;
    const newW = Math.max(150, Math.min(600, startW + delta));
    document.documentElement.style.setProperty('--input-panel-w', newW + 'px');
  }

  function onUp() {
    handle.classList.remove('dragging');
    panel.style.transition = '';
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    fitActiveTerminal();
  }
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
    const entry = terminalMap.get(sessionId);
    if (!entry) { inputBuffers.set(sessionId, ''); return; }

    const buf = entry.term.buffer.active;
    const lineIndex = buf.baseY + buf.cursorY;

    // Check if IME is composing — if so, defer until compositionend
    const textarea = entry.div.querySelector('.xterm-helper-textarea') as HTMLElement;
    if (textarea && textarea.dataset.composing === '1') {
      pendingEnter.set(sessionId, lineIndex);
      return;
    }

    flushInput(sessionId, lineIndex);
    return;
  } else if (data === '\x7f') {
    // Backspace
    const current = inputBuffers.get(sessionId) || '';
    inputBuffers.set(sessionId, current.slice(0, -1));
  } else if (data.length >= 1 && data.charCodeAt(0) >= 32) {
    // Printable char(s) — includes IME-committed multi-char strings
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

function flushInput(sessionId: string, lineIndex: number) {
  const buffered = (inputBuffers.get(sessionId) || '').trim();
  inputBuffers.set(sessionId, '');

  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  // Priority 1: use inputBuffer (actual keystrokes typed by user)
  // Priority 2: fall back to terminal buffer line (for pasted text etc.)
  let userInput = buffered;
  if (!userInput) {
    const buf = entry.term.buffer.active;
    const line = buf.getLine(buf.cursorY);
    const rawText = line ? line.translateToString(true).trim() : '';
    userInput = rawText ? extractUserInput(rawText) : '';
  }

  if (!userInput) return;

  if (!historyMap.has(sessionId)) historyMap.set(sessionId, []);
  const entries = historyMap.get(sessionId);
  entries.push({
    text: userInput,
    fullLine: userInput,
    bufferLine: lineIndex,
    time: new Date(),
  });

  if (entries.length > 200) entries.shift();
  if (sessionId === S.activeSessionId && !isClaudeSession(sessionId)) renderPanel();
}

/** Attach compositionstart/end listeners for IME-aware input tracking */
export function trackInputComposition(sessionId: string, div: HTMLElement) {
  const textarea = div.querySelector('.xterm-helper-textarea') as HTMLElement;
  if (!textarea) return;
  textarea.addEventListener('compositionstart', () => {
    textarea.dataset.composing = '1';
  });
  textarea.addEventListener('compositionend', () => {
    delete textarea.dataset.composing;
    // If Enter was pressed during composition, flush now
    if (pendingEnter.has(sessionId)) {
      const lineIndex = pendingEnter.get(sessionId)!;
      pendingEnter.delete(sessionId);
      flushInput(sessionId, lineIndex);
    }
  });
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
    const isFoldable = p.text.length > 100;
    const displayText = isFoldable ? escHtml(p.text.slice(0, 50)) + '…' : escHtml(p.text);
    el.innerHTML = `
      <div class="input-entry-meta">
        <span class="input-entry-num">${i + 1}</span>
        <span class="input-entry-time">${timeStr}</span>
      </div>
      <span class="input-entry-text ${isFoldable ? 'foldable folded' : ''}">${displayText}</span>
    `;
    if (isFoldable) {
      const textSpan = el.querySelector('.input-entry-text') as HTMLElement;
      textSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        const isFolded = textSpan.classList.toggle('folded');
        textSpan.innerHTML = isFolded
          ? escHtml(p.text.slice(0, 50)) + '…'
          : escHtml(p.text);
      });
    }
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
    const isFoldable = entry.text.length > 100;
    const displayText = isFoldable ? escHtml(entry.text.slice(0, 50)) + '…' : escHtml(entry.text);
    el.innerHTML = `
      <span class="input-entry-num">${i + 1}</span>
      <span class="input-entry-text ${isFoldable ? 'foldable folded' : ''}" title="${escAttr(entry.fullLine)}">${displayText}</span>
      <span class="input-entry-time">${timeStr}</span>
    `;
    if (isFoldable) {
      const textSpan = el.querySelector('.input-entry-text') as HTMLElement;
      textSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        const isFolded = textSpan.classList.toggle('folded');
        textSpan.innerHTML = isFolded
          ? escHtml(entry.text.slice(0, 50)) + '…'
          : escHtml(entry.text);
      });
    }
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

/** Hide the panel (e.g. when switching to a file tab) */
export function hideInputPanel() {
  panel.classList.add('hidden');
  stopClaudePoll();
  fitActiveTerminal();
}

/** Call when active session changes to refresh the panel */
export function onSessionChange() {
  if (S.activeSessionId && isClaudeSession(S.activeSessionId)) {
    // Show panel expanded (unfold) for Claude sessions
    panel.classList.remove('hidden');
    panel.classList.remove('collapsed');
    toggle.textContent = '◂';
    fetchClaudePrompts(S.activeSessionId);
    startClaudePoll();
    fitActiveTerminal();
  } else {
    // Hide panel entirely for non-Claude sessions
    panel.classList.add('hidden');
    stopClaudePoll();
    fitActiveTerminal();
  }
  renderPanel();
}
