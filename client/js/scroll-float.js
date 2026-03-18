// ─── FLOATING SCROLL-TO-TOP / SCROLL-TO-BOTTOM BUTTONS ──────────
import { S, terminalMap } from './state.js';

const container = document.getElementById('scroll-float');
const topBtn    = document.getElementById('scroll-top-btn');
const bottomBtn = document.getElementById('scroll-bottom-btn');

function getActiveTerm() {
  if (!S.activeSessionId) return null;
  const entry = terminalMap.get(S.activeSessionId);
  return entry ? entry.term : null;
}

topBtn.addEventListener('click', () => {
  const term = getActiveTerm();
  if (term) term.scrollToTop();
});

bottomBtn.addEventListener('click', () => {
  const term = getActiveTerm();
  if (term) term.scrollToBottom();
});

// Show buttons only when terminal has scrollback content
function updateVisibility() {
  const term = getActiveTerm();
  if (!term) { container.classList.remove('visible'); return; }
  const buf = term.buffer.active;
  const hasScroll = buf.baseY > 0;
  container.classList.toggle('visible', hasScroll);
}

// Periodically check scroll state (lightweight)
setInterval(updateVisibility, 800);

// Also check on session switch
let _activeId = S.activeSessionId;
Object.defineProperty(S, 'activeSessionId', {
  get() { return _activeId; },
  set(v) { _activeId = v; setTimeout(updateVisibility, 100); },
  enumerable: true, configurable: true,
});
