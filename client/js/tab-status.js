import { sessionMeta, terminalMap, tabStatusState, stripAnsi } from './state.js';

// ─── Constants ───────────────────────────────────────
const STATUS_DEBOUNCE = 800;
const DONE_TO_IDLE_MS = 3000;
const BUFFER_MAX = 2048;

// ─── AI-specific patterns (Claude Code) ──────────────
const CLAUDE_PATTERNS = [
  { re: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Puzzling\.\.\.|Thinking\.\.\./,
    status: 'thinking', text: '생각 중...' },
  { re: /^[\s•⚡●◐▸]*(?:Read|Edit|Write|Glob|Grep|NotebookEdit)\b/m,
    status: 'tool', text: '파일 편집 중' },
  { re: /^[\s•⚡●◐▸]*(?:Bash|WebFetch|WebSearch|Task)\b/m,
    status: 'tool', text: '명령 실행 중' },
  { re: /^[❯>]\s*$/m, status: 'question', text: '입력 대기',
    lastLineOnly: true },
  { re: /✓|✔|Task complete|Done\./i,
    status: 'done', text: '완료' },
];

// ─── General AI patterns ─────────────────────────────
const GENERAL_AI_PATTERNS = [
  { re: /^[❯>]\s*$/m, status: 'question', text: '입력 대기', lastLineOnly: true },
  { re: /✓|✔|Done|Completed|Finished/i, status: 'done', text: '완료' },
];

// ─── Shell patterns ──────────────────────────────────
const SHELL_PATTERNS = [
  { re: /\[y\/N\]|\[Y\/n\]|password:|Password:|passphrase/i,
    status: 'question', text: '입력 대기', lastLineOnly: true },
  { re: /[\$❯›»#%]\s*$/, status: 'idle', text: '대기', lastLineOnly: true },
];

// ─── Internal state ──────────────────────────────────
const statusBuffers = new Map();
const statusTimers = new Map();
const doneTimers = new Map();
const suppressUntil = new Map();

// ─── Core API ────────────────────────────────────────

export function tabStatusCheck(sessionId, chunk) {
  const now = Date.now();
  const suppressed = suppressUntil.get(sessionId);
  if (suppressed && now < suppressed) return;

  const prev = statusBuffers.get(sessionId) || '';
  const next = (prev + chunk).slice(-BUFFER_MAX);
  statusBuffers.set(sessionId, next);

  clearTimeout(statusTimers.get(sessionId));
  statusTimers.set(sessionId, setTimeout(() => {
    const buf = stripAnsi(statusBuffers.get(sessionId) || '');
    if (!buf.trim()) return;

    const meta = sessionMeta.get(sessionId);
    const ai = meta?.ai || null;

    let matched = null;

    if (ai) {
      const patterns = (ai === 'claude') ? CLAUDE_PATTERNS : GENERAL_AI_PATTERNS;
      for (const p of patterns) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      // AI active but no pattern matched → default to thinking
      if (!matched) {
        matched = { status: 'thinking', text: '생각 중...' };
      }
    } else {
      // Shell mode
      for (const p of SHELL_PATTERNS) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      if (!matched) {
        matched = { status: 'working', text: '작업 중...' };
      }
    }

    updateTabUI(sessionId, matched.status, matched.text);
  }, STATUS_DEBOUNCE));
}

export function tabStatusOnAiChange(sessionId) {
  statusBuffers.set(sessionId, '');
  clearTimeout(statusTimers.get(sessionId));
  clearTimeout(doneTimers.get(sessionId));
  suppressUntil.delete(sessionId);
  updateTabUI(sessionId, 'idle', '대기');
}

export function resetTabStatus(sessionId) {
  statusBuffers.delete(sessionId);
  clearTimeout(statusTimers.get(sessionId));
  statusTimers.delete(sessionId);
  clearTimeout(doneTimers.get(sessionId));
  doneTimers.delete(sessionId);
  suppressUntil.delete(sessionId);
  tabStatusState.delete(sessionId);
}

export function suppressTabStatus(sessionId, durationMs) {
  suppressUntil.set(sessionId, Date.now() + durationMs);
}

// ─── Internal helpers ────────────────────────────────

function getLastLine(buf) {
  const lines = buf.split('\n').filter(l => l.trim());
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function updateTabUI(sessionId, status, text) {
  const prev = tabStatusState.get(sessionId);
  if (prev === status) return;

  tabStatusState.set(sessionId, status);

  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  // Update tab data-status attribute
  entry.tabEl.dataset.status = status;

  // Update tab-indicator aria-label
  const indicator = entry.tabEl.querySelector('.tab-indicator');
  if (indicator) indicator.setAttribute('aria-label', text);

  // Update status text element
  const statusTextEl = entry.tabEl.querySelector('.tab-status-text');
  if (statusTextEl) statusTextEl.textContent = text;

  // Handle done → idle auto-transition
  clearTimeout(doneTimers.get(sessionId));
  if (status === 'done') {
    doneTimers.set(sessionId, setTimeout(() => {
      updateTabUI(sessionId, 'idle', '대기');
    }, DONE_TO_IDLE_MS));
  }
}
