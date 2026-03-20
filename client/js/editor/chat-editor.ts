// ─── CHAT EDITOR WITH SLASH COMMANDS ────────────────────────────
import { S, terminalMap } from '../core/state';
import { wsSend } from '../core/websocket';

const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSend = document.getElementById('chat-send');
const chatHint = document.getElementById('chat-hint');
const slashMenu = document.getElementById('chat-slash-menu');
const resizeHandle = document.getElementById('chat-editor-resize');

// ─── Slash commands ─────────────────────────────────
const SLASH_COMMANDS = [
  { cmd: '/help', desc: 'Show available commands' },
  { cmd: '/clear', desc: 'Clear terminal' },
  { cmd: '/compact', desc: 'Compact conversation' },
  { cmd: '/model', desc: 'Switch AI model' },
  { cmd: '/cost', desc: 'Show token usage' },
  { cmd: '/status', desc: 'Show session status' },
  { cmd: '/init', desc: 'Initialize project' },
  { cmd: '/memory', desc: 'Show memory' },
  { cmd: '/review', desc: 'Code review' },
  { cmd: '/bug', desc: 'Report bug' },
  { cmd: '/plan', desc: 'Show plan' },
  { cmd: '/vim', desc: 'Toggle vim mode' },
  { cmd: '/permissions', desc: 'Manage permissions' },
  { cmd: '/mcp', desc: 'MCP servers' },
  { cmd: '/doctor', desc: 'Diagnose issues' },
  { cmd: '/login', desc: 'Login to service' },
  { cmd: '/terminal-setup', desc: 'Terminal setup' },
];

// ─── History ────────────────────────────────────────
const MAX_HISTORY = 50;
const STORAGE_KEY = 'chat-editor-history';
let history = [];
let historyIdx = -1;
let draft = '';

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) history = JSON.parse(saved);
} catch {}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {}
}

function addToHistory(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Deduplicate: remove if same as last entry
  if (history.length > 0 && history[history.length - 1] === trimmed) return;
  history.push(trimmed);
  if (history.length > MAX_HISTORY) history.shift();
  saveHistory();
  historyIdx = -1;
}

// ─── Draft auto-save ────────────────────────────────
const DRAFT_KEY = 'chat-editor-draft';
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, chatInput.value);
  } catch {}
}
function loadDraft() {
  try {
    const d = localStorage.getItem(DRAFT_KEY);
    if (d) chatInput.value = d;
  } catch {}
}

// ─── Slash menu ─────────────────────────────────────
let slashActive = -1;
let slashFiltered = [];

function showSlashMenu(query) {
  const q = query.toLowerCase();
  slashFiltered = SLASH_COMMANDS.filter(
    (c) => c.cmd.includes(q) || c.desc.toLowerCase().includes(q)
  );
  if (slashFiltered.length === 0) {
    hideSlashMenu();
    return;
  }

  slashMenu.style.display = 'block';
  slashActive = 0;
  renderSlashMenu();
}

function hideSlashMenu() {
  slashMenu.style.display = 'none';
  slashActive = -1;
  slashFiltered = [];
}

function renderSlashMenu() {
  slashMenu.innerHTML = slashFiltered
    .map(
      (c, i) =>
        `<div class="slash-item${i === slashActive ? ' active' : ''}" data-idx="${i}">
      <span class="slash-cmd">${c.cmd}</span>
      <span class="slash-desc">${c.desc}</span>
    </div>`
    )
    .join('');

  slashMenu.querySelectorAll('.slash-item').forEach((el) => {
    el.addEventListener('click', () => {
      const idx = parseInt((el as HTMLElement).dataset.idx);
      applySlashCommand(slashFiltered[idx]);
    });
  });
}

function applySlashCommand(cmd) {
  chatInput.value = cmd.cmd + ' ';
  hideSlashMenu();
  chatInput.focus();
  autoResize();
}

// ─── Send ───────────────────────────────────────────
function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !S.activeSessionId) return;

  addToHistory(text);

  // Send to terminal as input
  wsSend({ type: 'input', sessionId: S.activeSessionId, data: text + '\r' });

  chatInput.value = '';
  saveDraft();
  autoResize();
  hideSlashMenu();

  // Re-focus terminal
  const entry = terminalMap.get(S.activeSessionId);
  if (entry) entry.term.focus();
}

// ─── Auto-resize textarea ───────────────────────────
function autoResize() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
}

// ─── Resize handle (drag to resize chat editor) ─────
function initResize() {
  let startY = 0;
  let startH = 0;
  const editor = document.getElementById('chat-editor');

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = editor.offsetHeight;
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', onUp);
  });

  function onDrag(e) {
    const delta = startY - e.clientY;
    const newH = Math.max(40, Math.min(300, startH + delta));
    editor.style.height = newH + 'px';
    chatInput.style.maxHeight = newH - 20 + 'px';
  }

  function onUp() {
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', onUp);
  }
}

// ─── Event handlers ─────────────────────────────────
export function initChatEditor() {
  loadDraft();
  autoResize();
  initResize();

  chatInput.addEventListener('input', () => {
    autoResize();
    saveDraft();

    const val = chatInput.value;
    // Check for slash command at start of input
    if (val.startsWith('/') && !val.includes('\n')) {
      showSlashMenu(val);
    } else {
      hideSlashMenu();
    }

    // Show hint
    const lines = val.split('\n').length;
    chatHint.textContent = lines > 1 ? `${lines} lines` : '';
  });

  chatInput.addEventListener('keydown', (e) => {
    // Slash menu navigation
    if (slashMenu.style.display !== 'none') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        slashActive = Math.min(slashActive + 1, slashFiltered.length - 1);
        renderSlashMenu();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        slashActive = Math.max(slashActive - 1, 0);
        renderSlashMenu();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (slashActive >= 0 && slashFiltered[slashActive]) {
          e.preventDefault();
          applySlashCommand(slashFiltered[slashActive]);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSlashMenu();
        return;
      }
    }

    // Enter = send, Shift+Enter = newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
      return;
    }

    // History navigation (ArrowUp/Down when input is empty or at start)
    if (e.key === 'ArrowUp' && chatInput.selectionStart === 0 && !chatInput.value.includes('\n')) {
      e.preventDefault();
      if (historyIdx === -1) {
        draft = chatInput.value;
        historyIdx = history.length - 1;
      } else {
        historyIdx = Math.max(0, historyIdx - 1);
      }
      if (historyIdx >= 0 && historyIdx < history.length) {
        chatInput.value = history[historyIdx];
        autoResize();
      }
      return;
    }
    if (e.key === 'ArrowDown' && historyIdx >= 0) {
      e.preventDefault();
      historyIdx++;
      if (historyIdx >= history.length) {
        historyIdx = -1;
        chatInput.value = draft;
      } else {
        chatInput.value = history[historyIdx];
      }
      autoResize();
      return;
    }

    // Tab for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = chatInput.selectionStart;
      const end = chatInput.selectionEnd;
      chatInput.value = chatInput.value.substring(0, start) + '  ' + chatInput.value.substring(end);
      chatInput.selectionStart = chatInput.selectionEnd = start + 2;
      autoResize();
    }
  });

  chatSend.addEventListener('click', sendMessage);

  // Close slash menu on outside click
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('#chat-editor')) hideSlashMenu();
  });
}
