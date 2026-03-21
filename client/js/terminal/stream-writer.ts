// ─── TERMINAL WRITER ─────────────────────────────────
// Writes PTY output to xterm.js terminals.
// Manages cursor visibility to avoid flicker during rapid output bursts.

const CURSOR_RESTORE_DELAY = 200; // ms to wait before restoring cursor after quiet period

const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
// Regex to strip cursor visibility sequences from PTY data
const CURSOR_VIS_RE = /\x1b\[\?25[lh]/g;

const buffers = new Map(); // sessionId → { term, cursorHidden, restoreTimer }
const bypassed = new Set(); // sessionIds that skip cursor management (e.g. session restore)

// ─── IME composition tracking ────
// Track whether the user is actively composing (e.g., Korean IME).
// term.write() during composition can cancel IME by repositioning xterm's hidden textarea.
const composingTerms = new WeakSet(); // terms with active IME composition

export function trackComposition(term, div) {
  const textarea = div.querySelector('.xterm-helper-textarea');
  if (!textarea) return;
  textarea.addEventListener('compositionstart', () => composingTerms.add(term));
  textarea.addEventListener('compositionend', () => composingTerms.delete(term));
}

export function bypassStream(sessionId) {
  bypassed.add(sessionId);
}
export function unbypassStream(sessionId) {
  bypassed.delete(sessionId);
}

function scheduleCursorRestore(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf || !buf.cursorHidden) return;
  if (buf.restoreTimer) clearTimeout(buf.restoreTimer);
  buf.restoreTimer = setTimeout(function doRestore() {
    buf.restoreTimer = null;
    // Defer cursor restore while IME is composing to avoid breaking Korean/CJK input
    if (composingTerms.has(buf.term)) {
      buf.restoreTimer = setTimeout(doRestore, CURSOR_RESTORE_DELAY);
      return;
    }
    buf.cursorHidden = false;
    buf.term.write(CURSOR_SHOW);
  }, CURSOR_RESTORE_DELAY);
}

export function streamWrite(sessionId, term, data) {
  if (bypassed.has(sessionId)) {
    term.write(data);
    return;
  }
  let buf = buffers.get(sessionId);
  if (!buf) {
    buf = { term, cursorHidden: false, restoreTimer: null };
    buffers.set(sessionId, buf);
  }
  buf.term = term;

  // Cancel pending cursor restore — new data is arriving
  if (buf.restoreTimer) {
    clearTimeout(buf.restoreTimer);
    buf.restoreTimer = null;
  }

  // Strip cursor show/hide from incoming data — we manage cursor visibility ourselves
  const cleaned = data.replace(CURSOR_VIS_RE, '');
  if (!cleaned) return;

  // Skip cursor management during IME composition to avoid breaking Korean/CJK input.
  // Extra term.write() calls for cursor visibility can reposition xterm's textarea,
  // which cancels active IME composition on macOS.
  if (composingTerms.has(term)) {
    term.write(cleaned);
    return;
  }

  // Hide cursor during output burst to prevent flicker
  if (!buf.cursorHidden) {
    buf.cursorHidden = true;
    term.write(CURSOR_HIDE);
  }

  // Write all data at once
  term.write(cleaned);

  // Schedule cursor restore after quiet period
  scheduleCursorRestore(sessionId);
}

export function flushStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf) return;
  if (buf.restoreTimer) {
    clearTimeout(buf.restoreTimer);
    buf.restoreTimer = null;
  }
  if (buf.cursorHidden) {
    // Defer if IME is composing
    if (composingTerms.has(buf.term)) {
      scheduleCursorRestore(sessionId);
      return;
    }
    buf.cursorHidden = false;
    buf.term.write(CURSOR_SHOW);
  }
}

export function destroyStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (buf?.restoreTimer) clearTimeout(buf.restoreTimer);
  buffers.delete(sessionId);
}
