import { S, sessionMeta, terminalMap, notifyBuffers, notifyTimers, notifyState, escHtml, stripAnsi } from './state.js';
import { AI_REGISTRY } from './constants.js';
import { activateSession } from './session.js';
import { wsSend } from './websocket.js';

const NOTIFY_DEBOUNCE = 1200;

const AI_PATTERNS = [
  { re: />\s*$/m,                                      ai:'claude',   type:'question', msg:'Claude is waiting for your input' },
  { re: /✓|✔|Task complete|Done\.|Completed\./i,       ai:'claude',   type:'done',     msg:'Claude finished the task' },
  { re: /\?\s*$/m,                                     ai:'opencode', type:'question', msg:'opencode is asking a question' },
  { re: /Done|Completed|Finished/i,                    ai:'opencode', type:'done',     msg:'opencode finished the task' },
  { re: /^>\s*$/m,                                     ai:'gemini',   type:'question', msg:'Gemini is waiting for input' },
  { re: /Done\.|Task complete|Finished/i,              ai:'gemini',   type:'done',     msg:'Gemini finished the task' },
  { re: /^aider>\s*$/im,                               ai:'aider',    type:'question', msg:'Aider is waiting for input' },
  { re: /^Tokens:|Applied edit/im,                     ai:'aider',    type:'done',     msg:'Aider finished editing' },
  { re: /[$❯›»]\s*$/m,                                  ai:'any',      type:'question', msg:'Terminal is waiting for input' },
];

function getAiIcon(aiKey) {
  const reg = AI_REGISTRY[aiKey];
  return reg ? reg.notifyIcon : '💻';
}

export function aiNotifyCheck(sessionId, chunk) {
  const currentAi = sessionMeta.get(sessionId)?.ai || null;

  const prev = notifyBuffers.get(sessionId) || '';
  const next = (prev + chunk).slice(-4096);
  notifyBuffers.set(sessionId, next);

  clearTimeout(notifyTimers.get(sessionId));
  notifyTimers.set(sessionId, setTimeout(() => {
    const buf = stripAnsi(notifyBuffers.get(sessionId) || '');
    notifyBuffers.set(sessionId, '');

    let matched = null;
    for (const p of AI_PATTERNS) {
      if (p.ai !== 'any' && currentAi && p.ai !== currentAi) continue;
      if (p.re.test(buf)) { matched = p; break; }
    }
    if (!matched) return;

    const prevState = notifyState.get(sessionId);
    if (prevState === matched.type) return;
    notifyState.set(sessionId, matched.type);

    const meta = sessionMeta.get(sessionId);
    const sessName = meta?.name || sessionId;
    const icon = getAiIcon(currentAi);
    const title = matched.type === 'done'
      ? `${icon} Task Done — ${sessName}`
      : `${icon} Needs Input — ${sessName}`;
    const body = matched.msg;

    const isActiveVisible = (sessionId === S.activeSessionId) && (document.visibilityState === 'visible');
    if (!isActiveVisible) {
      showToast(title, body, sessionId);
    }

    if (document.visibilityState === 'hidden' || !document.hasFocus()) {
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          fireOsNotification(title, body, sessionId);
        } else if (Notification.permission === 'default') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') fireOsNotification(title, body, sessionId);
          });
        }
      }
    }
  }, NOTIFY_DEBOUNCE));
}

export function resetNotifyState(sessionId) {
  notifyState.set(sessionId, 'idle');
  notifyBuffers.set(sessionId, '');
  clearTimeout(notifyTimers.get(sessionId));
}

function fireOsNotification(title, body, sessionId) {
  const n = new Notification(title, {
    body,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%2300ffe5" opacity=".15"/><polyline points="10,7 6,16 14,16 10,25 22,13 15,13 19,7" fill="%2300ffe5"/></svg>',
    tag: `super-terminal-${sessionId}`,
    silent: false,
  });
  n.onclick = () => {
    window.focus();
    if (terminalMap.has(sessionId)) {
      activateSession(sessionId);
      wsSend({ type:'session_attach', sessionId });
    }
    n.close();
  };
}

const alertSound = new Audio('/alert.m4a');
let toastContainer = null;
function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(title, body, sessionId) {
  const c = getToastContainer();
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `
    <div class="toast-title">${escHtml(title)}</div>
    <div class="toast-body">${escHtml(body)}</div>
    <button class="toast-close">✕</button>
  `;
  t.addEventListener('click', e => {
    if (e.target.closest('.toast-close')) { t.remove(); return; }
    if (terminalMap.has(sessionId)) {
      activateSession(sessionId);
      wsSend({ type:'session_attach', sessionId });
    }
    t.remove();
  });
  c.appendChild(t);
  alertSound.currentTime = 0;
  alertSound.play().catch(() => {});
  setTimeout(() => t.classList.add('toast-hide'), 5500);
  setTimeout(() => { if (t.parentNode) t.remove(); }, 6200);
}

export function initNotifications() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}
