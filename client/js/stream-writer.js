// ─── STREAMING TERMINAL WRITER ───────────────────────
// Breaks large chunks into smaller pieces for a gradual typing effect.
// Small chunks (natural PTY streaming) pass through with minimal delay.

const CHUNK_SIZE = 80;       // chars per write tick
const TICK_MS = 12;          // ms between ticks (~83 writes/sec)
const INSTANT_THRESHOLD = 60; // chunks <= this size are written immediately

const buffers = new Map();   // sessionId → { queue: string, timer: null, term: Terminal }

export function streamWrite(sessionId, term, data) {
  let buf = buffers.get(sessionId);
  if (!buf) {
    buf = { queue: '', timer: null, term };
    buffers.set(sessionId, buf);
  }
  buf.term = term;
  buf.queue += data;

  // Small data with empty queue → write immediately for responsiveness
  if (buf.queue.length <= INSTANT_THRESHOLD && !buf.timer) {
    const chunk = buf.queue;
    buf.queue = '';
    term.write(chunk);
    return;
  }

  // Start drain loop if not already running
  if (!buf.timer) {
    drain(sessionId);
  }
}

function drain(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf || buf.queue.length === 0) {
    if (buf) buf.timer = null;
    return;
  }

  const chunk = buf.queue.slice(0, CHUNK_SIZE);
  buf.queue = buf.queue.slice(CHUNK_SIZE);
  buf.term.write(chunk);

  if (buf.queue.length > 0) {
    buf.timer = setTimeout(() => drain(sessionId), TICK_MS);
  } else {
    buf.timer = null;
  }
}

export function flushStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (!buf) return;
  if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
  if (buf.queue.length > 0) {
    buf.term.write(buf.queue);
    buf.queue = '';
  }
}

export function destroyStream(sessionId) {
  const buf = buffers.get(sessionId);
  if (buf?.timer) clearTimeout(buf.timer);
  buffers.delete(sessionId);
}
