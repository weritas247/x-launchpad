import { S, sessionMeta } from '../core/state.js';
import { wsSend } from '../core/websocket.js';

const sbClaudeSep = document.getElementById('sb-claude-sep');
const sbClaudeUsage = document.getElementById('sb-claude-usage');
const sbClaudeTokens = document.getElementById('sb-claude-tokens');

let pollTimer = null;
const POLL_INTERVAL = 5000; // 5s

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

export function handleClaudeUsageData(msg) {
  if (msg.sessionId !== S.activeSessionId) return;
  const u = msg.usage;
  if (!u) {
    hideUsage();
    return;
  }
  showUsage();
  const totalIn = u.inputTokens + u.cacheReadTokens + u.cacheCreateTokens;
  const pct = Math.min((u.totalCost / 200) * 100, 100).toFixed(1);
  sbClaudeTokens.textContent = `${pct}% · ↑${formatTokens(totalIn)} ↓${formatTokens(u.outputTokens)}`;
  sbClaudeUsage.title = `Claude Code Usage (Max $200 plan)\nUsage: ${pct}%\nModel: ${u.model || '?'}\nInput: ${u.inputTokens.toLocaleString()}\nOutput: ${u.outputTokens.toLocaleString()}\nCache Read: ${u.cacheReadTokens.toLocaleString()}\nCache Create: ${u.cacheCreateTokens.toLocaleString()}\nAPI Cost: $${u.totalCost.toFixed(2)}`;
}

function showUsage() {
  sbClaudeSep.style.display = '';
  sbClaudeUsage.style.display = '';
}

function hideUsage() {
  sbClaudeSep.style.display = 'none';
  sbClaudeUsage.style.display = 'none';
}

function requestUsage() {
  if (!S.activeSessionId || !S.ws) return;
  const meta = sessionMeta.get(S.activeSessionId);
  if (!meta || meta.ai !== 'claude') {
    hideUsage();
    return;
  }
  wsSend({ type: 'claude_usage', sessionId: S.activeSessionId });
}

export function startUsagePolling() {
  stopUsagePolling();
  requestUsage();
  pollTimer = setInterval(requestUsage, POLL_INTERVAL);
}

export function stopUsagePolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function onSessionChangeUsage() {
  requestUsage();
}

export function onAiChangeUsage(sessionId, ai) {
  if (sessionId !== S.activeSessionId) return;
  if (ai === 'claude') {
    requestUsage();
    if (!pollTimer) startUsagePolling();
  } else {
    hideUsage();
  }
}
