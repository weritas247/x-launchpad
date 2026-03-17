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
const lastKnownAi = new Map();  // track AI changes internally

// ─── Core API ────────────────────────────────────────

export function tabStatusCheck(sessionId, chunk) {
  const now = Date.now();
  const suppressed = suppressUntil.get(sessionId);
  if (suppressed && now < suppressed) return;

  const prev = statusBuffers.get(sessionId) || '';
  const next = (prev + chunk).slice(-BUFFER_MAX);
  statusBuffers.set(sessionId, next);

  const meta = sessionMeta.get(sessionId);
  const ai = meta?.ai || null;
  const currentStatus = tabStatusState.get(sessionId);

  // Immediately switch to working/thinking when output arrives
  // (if we're currently idle or done)
  if (currentStatus === 'idle' || currentStatus === 'done' || !currentStatus) {
    if (ai) {
      updateTabUI(sessionId, 'thinking', '생각 중...');
    } else {
      updateTabUI(sessionId, 'working', '작업 중...');
    }
  }

  // Debounce the detailed pattern matching
  clearTimeout(statusTimers.get(sessionId));
  statusTimers.set(sessionId, setTimeout(() => {
    const buf = stripAnsi(statusBuffers.get(sessionId) || '');
    if (!buf.trim()) return;

    let matched = null;

    if (ai) {
      const patterns = (ai === 'claude') ? CLAUDE_PATTERNS : GENERAL_AI_PATTERNS;
      for (const p of patterns) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      // AI active but no pattern matched → keep thinking
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

export function tabStatusOnAiChange(sessionId, ai) {
  const prev = lastKnownAi.get(sessionId) ?? null;
  const curr = ai || null;
  if (prev === curr) return;  // AI didn't actually change — skip reset
  lastKnownAi.set(sessionId, curr);
  clearTimeout(doneTimers.get(sessionId));
  suppressUntil.delete(sessionId);

  // Re-analyze existing buffer with new AI context instead of just resetting
  const buf = stripAnsi(statusBuffers.get(sessionId) || '');
  if (buf.trim()) {
    let matched = null;
    if (curr) {
      const patterns = (curr === 'claude') ? CLAUDE_PATTERNS : GENERAL_AI_PATTERNS;
      for (const p of patterns) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      if (!matched) matched = { status: 'thinking', text: '생각 중...' };
    } else {
      for (const p of SHELL_PATTERNS) {
        const target = p.lastLineOnly ? getLastLine(buf) : buf;
        if (p.re.test(target)) { matched = p; break; }
      }
      if (!matched) matched = { status: 'idle', text: '대기' };
    }
    updateTabUI(sessionId, matched.status, matched.text);
  } else {
    updateTabUI(sessionId, 'idle', '대기');
  }
}

export function resetTabStatus(sessionId) {
  statusBuffers.delete(sessionId);
  clearTimeout(statusTimers.get(sessionId));
  statusTimers.delete(sessionId);
  clearTimeout(doneTimers.get(sessionId));
  doneTimers.delete(sessionId);
  suppressUntil.delete(sessionId);
  lastKnownAi.delete(sessionId);
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
  console.log(`[tab-status] ${sessionId.slice(0,8)} ${prev} → ${status} (${text})`);

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
