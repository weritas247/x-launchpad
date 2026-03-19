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
  buf.restoreTimer = setTimeout(() => {
    buf.restoreTimer = null;
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
    buf.cursorHidden = false;
    buf.term.write(CURSOR_SHOW);
  }
}

export function destroyStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (buf?.restoreTimer) clearTimeout(buf.restoreTimer);
  buffers.delete(sessionId);
}
