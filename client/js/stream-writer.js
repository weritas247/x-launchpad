// ─── STREAMING TERMINAL WRITER ───────────────────────
// Breaks large chunks into smaller pieces for a gradual typing effect.
// Small chunks (natural PTY streaming) pass through with minimal delay.
// Hides cursor during streaming; restores after a quiet period to avoid flicker.

const CHUNK_SIZE = 80;       // chars per write tick
const TICK_MS = 12;          // ms between ticks (~83 writes/sec)
const INSTANT_THRESHOLD = 60; // chunks <= this size are written immediately
const CURSOR_RESTORE_DELAY = 200; // ms to wait before restoring cursor after drain

// Regex to detect if we're in the middle of an ANSI escape sequence at the end of a string
// Matches incomplete: ESC not followed by complete sequence, or ESC[ with incomplete params
const INCOMPLETE_ESC = /\x1b(\[[0-9;?]*)?$/;

const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
// Regex to strip cursor visibility sequences from PTY data
const CURSOR_VIS_RE = /\x1b\[\?25[lh]/g;

const buffers = new Map();   // sessionId → { queue, timer, term, cursorHidden, restoreTimer }
const bypassed = new Set();  // sessionIds that skip streaming (e.g. session restore)

export function bypassStream(sessionId) { bypassed.add(sessionId); }
export function unbypassStream(sessionId) { bypassed.delete(sessionId); }

function scheduleCursorRestore(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf || !buf.cursorHidden) return;
  // Cancel any pending restore
  if (buf.restoreTimer) clearTimeout(buf.restoreTimer);
  buf.restoreTimer = setTimeout(() => {
    buf.restoreTimer = null;
    // Only restore if still idle (no new data queued)
    if (buf.queue.length === 0 && !buf.timer) {
      buf.cursorHidden = false;
      buf.term.write(CURSOR_SHOW);
    }
  }, CURSOR_RESTORE_DELAY);
}

export function streamWrite(sessionId, term, data) {
  if (bypassed.has(sessionId)) { term.write(data); return; }
  let buf = buffers.get(sessionId);
  if (!buf) {
    buf = { queue: '', timer: null, term, cursorHidden: false, restoreTimer: null };
    buffers.set(sessionId, buf);
  }
  buf.term = term;

  // Cancel pending cursor restore — new data is arriving
  if (buf.restoreTimer) { clearTimeout(buf.restoreTimer); buf.restoreTimer = null; }

  // Strip cursor show/hide from incoming data — we manage cursor visibility ourselves
  const cleaned = data.replace(CURSOR_VIS_RE, '');
  if (!cleaned) return;

  buf.queue += cleaned;

  // Small data with empty queue → write immediately for responsiveness
  if (buf.queue.length <= INSTANT_THRESHOLD && !buf.timer) {
    const chunk = buf.queue;
    buf.queue = '';
    term.write(chunk);
    return;
  }

  // Hide cursor when starting to stream
  if (!buf.cursorHidden) {
    buf.cursorHidden = true;
    term.write(CURSOR_HIDE);
  }

  // Start drain loop if not already running
  if (!buf.timer) {
    drain(sessionId);
  }
}

function drain(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf || buf.queue.length === 0) {
    if (buf) {
      buf.timer = null;
      scheduleCursorRestore(sessionId);
    }
    return;
  }

  let end = Math.min(CHUNK_SIZE, buf.queue.length);
  // Avoid splitting in the middle of an ANSI escape sequence
  const candidate = buf.queue.slice(0, end);
  const escMatch = candidate.match(INCOMPLETE_ESC);
  if (escMatch) {
    // Back up to before the incomplete escape
    end = escMatch.index;
    if (end === 0) {
      // The whole chunk IS the start of an escape — grab more to complete it
      const rest = buf.queue.slice(0, CHUNK_SIZE * 2);
      const full = rest.match(/\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07|\[[\s\S])/);
      end = full ? full.index + full[0].length : Math.min(CHUNK_SIZE * 2, buf.queue.length);
    }
  }
  if (end === 0) end = CHUNK_SIZE; // safety fallback
  const chunk = buf.queue.slice(0, end);
  buf.queue = buf.queue.slice(end);
  buf.term.write(chunk);

  if (buf.queue.length > 0) {
    buf.timer = setTimeout(() => drain(sessionId), TICK_MS);
  } else {
    buf.timer = null;
    scheduleCursorRestore(sessionId);
  }
}

export function flushStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf) return;
  if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
  if (buf.restoreTimer) { clearTimeout(buf.restoreTimer); buf.restoreTimer = null; }
  if (buf.queue.length > 0) {
    buf.term.write(buf.queue);
    buf.queue = '';
  }
  if (buf.cursorHidden) {
    buf.cursorHidden = false;
    buf.term.write(CURSOR_SHOW);
  }
}

export function destroyStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (buf?.timer) clearTimeout(buf.timer);
  if (buf?.restoreTimer) clearTimeout(buf.restoreTimer);
  buffers.delete(sessionId);
}
