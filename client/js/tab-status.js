import { sessionMeta, terminalMap, tabStatusState, stripAnsi } from './state.js';

// ─── Constants ───────────────────────────────────────
const STATUS_DEBOUNCE = 800;
const DONE_TO_IDLE_MS = 3000;
const INACTIVITY_MS = 2000;
const BUFFER_MAX = 2048;
const RECENT_LINES = 5;

// ─── AI-specific patterns (Claude Code) ──────────────
const CLAUDE_PATTERNS = [
  { re: /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]|Puzzling\.\.\.|Thinking\.\.\./,
    status: 'thinking', text: '생각 중...' },
  { re: /^[\s•⚡●◐▸]*(?:Read|Edit|Write|Glob|Grep|NotebookEdit)\b/m,
    status: 'tool', text: '파일 편집 중' },
  { re: /^[\s•⚡●◐▸]*(?:Bash|WebFetch|WebSearch|Task)\b/m,
    status: 'tool', text: '명령 실행 중' },
  { re: /^[❯>]\s/, status: 'question', text: '입력 대기',
    lastLineOnly: true },
  { re: /✓|✔|Task complete|Done\./i,
    status: 'done', text: '완료' },
];

// ─── General AI patterns ─────────────────────────────
const GENERAL_AI_PATTERNS = [
  { re: /^[❯>]\s/, status: 'question', text: '입력 대기', lastLineOnly: true },
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
const inactivityTimers = new Map();
const suppressUntil = new Map();
const lastKnownAi = new Map();

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

  // Clear inactivity timer — output is actively flowing
  clearTimeout(inactivityTimers.get(sessionId));

  // Immediately switch to working/thinking when output arrives (if idle/done)
  if (currentStatus === 'idle' || currentStatus === 'done' || !currentStatus) {
    if (ai) {
      updateTabUI(sessionId, 'thinking', '생각 중...');
    } else {
      updateTabUI(sessionId, 'working', '작업 중...');
    }
  }

  // Instant prompt detection for AI — don't wait for debounce
  // When Claude shows ❯ prompt, switch to "question" immediately
  if (ai && (currentStatus === 'thinking' || currentStatus === 'tool') && chunk.includes('❯')) {
    const quickBuf = stripAnsi(next);
    const lastLine = getLastLine(quickBuf);
    if (/^[❯>]\s/.test(lastLine)) {
      updateTabUI(sessionId, 'question', '입력 대기');
    }
  }

  // Debounce the detailed pattern matching
  clearTimeout(statusTimers.get(sessionId));
  statusTimers.set(sessionId, setTimeout(() => {
    const buf = stripAnsi(statusBuffers.get(sessionId) || '');
    if (!buf.trim()) return;

    const matched = matchPatterns(buf, ai);
    updateTabUI(sessionId, matched.status, matched.text);

    // Start inactivity timer — if no more output arrives, fall back to idle
    startInactivityTimer(sessionId);
  }, STATUS_DEBOUNCE));
}

export function tabStatusOnAiChange(sessionId, ai) {
  const prev = lastKnownAi.get(sessionId) ?? null;
  const curr = ai || null;
  if (prev === curr) return;
  lastKnownAi.set(sessionId, curr);
  clearTimeout(doneTimers.get(sessionId));
  clearTimeout(inactivityTimers.get(sessionId));
  suppressUntil.delete(sessionId);

  const buf = stripAnsi(statusBuffers.get(sessionId) || '');
  if (buf.trim()) {
    const matched = matchPatterns(buf, curr);
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
  clearTimeout(inactivityTimers.get(sessionId));
  inactivityTimers.delete(sessionId);
  suppressUntil.delete(sessionId);
  lastKnownAi.delete(sessionId);
  tabStatusState.delete(sessionId);
}

export function tabStatusOnInput(sessionId) {
  const currentStatus = tabStatusState.get(sessionId);
  if (currentStatus === 'thinking' || currentStatus === 'working' || currentStatus === 'tool') {
    const meta = sessionMeta.get(sessionId);
    const ai = meta?.ai || null;
    if (ai) {
      updateTabUI(sessionId, 'question', '입력 대기');
    } else {
      updateTabUI(sessionId, 'idle', '대기');
    }
  }
}

export function suppressTabStatus(sessionId, durationMs) {
  suppressUntil.set(sessionId, Date.now() + durationMs);
}

// ─── Internal helpers ────────────────────────────────

function getLastLine(buf) {
  const lines = buf.split('\n').filter(l => l.trim());
  return lines.length > 0 ? lines[lines.length - 1] : '';
}

function getRecentLines(buf, n) {
  const lines = buf.split('\n').filter(l => l.trim());
  return lines.slice(-n).join('\n');
}

function matchPatterns(buf, ai) {
  const lastLine = getLastLine(buf);
  const recentText = getRecentLines(buf, RECENT_LINES);

  if (ai) {
    const patterns = (ai === 'claude') ? CLAUDE_PATTERNS : GENERAL_AI_PATTERNS;
    for (const p of patterns) {
      const target = p.lastLineOnly ? lastLine : recentText;
      if (p.re.test(target)) return p;
    }
    return { status: 'thinking', text: '생각 중...' };
  } else {
    for (const p of SHELL_PATTERNS) {
      const target = p.lastLineOnly ? lastLine : recentText;
      if (p.re.test(target)) return p;
    }
    return { status: 'working', text: '작업 중...' };
  }
}

function startInactivityTimer(sessionId) {
  clearTimeout(inactivityTimers.get(sessionId));
  inactivityTimers.set(sessionId, setTimeout(() => {
    const currentStatus = tabStatusState.get(sessionId);
    if (currentStatus !== 'thinking' && currentStatus !== 'working' && currentStatus !== 'tool') return;

    const meta = sessionMeta.get(sessionId);
    const ai = meta?.ai || null;
    const buf = stripAnsi(statusBuffers.get(sessionId) || '');
    const lastLine = getLastLine(buf);

    if (ai) {
      if (/^[❯>]/.test(lastLine)) {
        updateTabUI(sessionId, 'question', '입력 대기');
      } else {
        updateTabUI(sessionId, 'idle', '대기');
      }
    } else {
      updateTabUI(sessionId, 'idle', '대기');
    }
    // Trim buffer to prevent stale data from affecting future analyses
    statusBuffers.set(sessionId, lastLine);
  }, INACTIVITY_MS));
}

function updateTabUI(sessionId, status, text) {
  const prev = tabStatusState.get(sessionId);
  if (prev === status) return;

  tabStatusState.set(sessionId, status);

  const entry = terminalMap.get(sessionId);
  if (!entry) return;

  // Update tab bar indicator (dot color only)
  entry.tabEl.dataset.status = status;
  const indicator = entry.tabEl.querySelector('.tab-indicator');
  if (indicator) indicator.setAttribute('aria-label', text);

  // Handle done → idle auto-transition
  clearTimeout(doneTimers.get(sessionId));
  if (status === 'done') {
    doneTimers.set(sessionId, setTimeout(() => {
      updateTabUI(sessionId, 'idle', '대기');
    }, DONE_TO_IDLE_MS));
  }
}
