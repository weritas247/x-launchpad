/**
 * PTY utility functions — escape stripping, prompt detection, command sending.
 */
import { WebSocket } from 'ws';

export interface PtySession {
  id: string;
  scrollback: string;
  pty: {
    write: (data: string) => void;
    onData: (cb: (data: string) => void) => { dispose: () => void };
  };
}

/** Strip ANSI escape sequences and control characters from terminal output */
export function stripEscape(s: string): string {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // CSI sequences
    .replace(/\x1b[()][AB012]/g, '') // character set
    .replace(/\x1b./g, '') // other ESC sequences
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '') // control chars except \n
    .replace(/\r/g, '');
}

/**
 * Wait for shell prompt readiness, then send a command.
 * Uses prompt detection with multiple fallback timeouts.
 */
export function runCmdWhenReady(sess: PtySession, cmd: string): void {
  let sent = false;
  let disposed = false;

  function finish(delay = 0) {
    if (sent) return;
    sent = true;
    if (!disposed) {
      disposed = true;
      unsub.dispose();
    }
    if (delay > 0) {
      setTimeout(() => sess.pty.write(cmd + '\r'), delay);
    } else {
      sess.pty.write(cmd + '\r');
    }
  }

  // Primary: detect shell prompt in PTY output
  let buf = '';
  let gotFirstData = false;
  const unsub = sess.pty.onData((chunk: string) => {
    if (sent) return;
    buf += chunk;
    gotFirstData = true;
    const clean = stripEscape(buf);
    if (/[$%>#❯›]\s*$/.test(clean)) {
      finish(100);
    }
    if (buf.length > 4000 && !sent) {
      finish();
    }
  });

  // Fallback A: if we got data but prompt regex never matched, send after 3s
  setTimeout(() => {
    if (!sent && gotFirstData) finish();
  }, 3000);

  // Fallback B: hard timeout — send no matter what after 6s
  setTimeout(() => {
    if (!sent) finish();
  }, 6000);
}

/**
 * Monitor PTY output for AI prompt readiness, then send text using bracketed paste + Enter.
 * Detects prompts like: Claude's ❯, Gemini's >, Codex's $, or generic prompt patterns.
 */
export function sendWhenAiReady(
  sess: PtySession,
  text: string,
  ws: WebSocket,
  wsSend: (ws: WebSocket, data: string) => void
): void {
  let sent = false;
  let disposed = false;
  let buf = '';

  function finish() {
    if (sent) return;
    sent = true;
    if (!disposed) {
      disposed = true;
      unsub.dispose();
    }
    // Use bracketed paste mode so multi-line text is treated as a single paste
    const BPS = '\x1b[200~';
    const BPE = '\x1b[201~';
    sess.pty.write(BPS + text + BPE);
    // Send Enter after delay to let CLI process the pasted text
    setTimeout(() => {
      sess.pty.write('\r');
      wsSend(ws, JSON.stringify({ type: 'ai_prompt_sent', sessionId: sess.id, ok: true }));
    }, 500);
  }

  // AI prompt patterns: Claude ❯/>, Gemini >, Codex $, generic prompt chars
  const promptRe = /[❯›>$%#]\s*$/;
  // Claude-specific: "bypass permissions on" or model info line followed by prompt
  const claudeReadyRe = /bypass permissions on|Claude Code v[\d.]+/;

  // Check existing scrollback first — prompt may have already appeared
  const tail = sess.scrollback.slice(-2000);
  const cleanTail = stripEscape(tail);
  if (cleanTail.length > 20 && (promptRe.test(cleanTail) || claudeReadyRe.test(cleanTail))) {
    finish();
    return;
  }

  const unsub = sess.pty.onData((chunk: string) => {
    if (sent) return;
    buf += chunk;
    const clean = stripEscape(buf);
    if (clean.length > 20 && (promptRe.test(clean) || claudeReadyRe.test(clean))) {
      finish();
    }
    if (buf.length > 8000 && !sent) {
      finish();
    }
  });

  // Fallback: send after 3 seconds regardless
  setTimeout(() => {
    if (!sent) finish();
  }, 3000);
}
