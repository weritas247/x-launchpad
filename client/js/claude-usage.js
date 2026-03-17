import { S, sessionMeta } from './state.js';
import { wsSend } from './websocket.js';

const sbClaudeSep = document.getElementById('sb-claude-sep');
const sbClaudeUsage = document.getElementById('sb-claude-usage');
const sbClaudeCost = document.getElementById('sb-claude-cost');
const sbClaudeTokens = document.getElementById('sb-claude-tokens');

let pollTimer = null;
const POLL_INTERVAL = 5000; // 5s

function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatCost(c) {
  return '$' + c.toFixed(2);
}

export function handleClaudeUsageData(msg) {
  if (msg.sessionId !== S.activeSessionId) return;
  const u = msg.usage;
  if (!u) {
    hideUsage();
    return;
  }
  showUsage();
  sbClaudeCost.textContent = formatCost(u.totalCost);
  const totalIn = u.inputTokens + u.cacheReadTokens + u.cacheCreateTokens;
  sbClaudeTokens.textContent = `↑${formatTokens(totalIn)} ↓${formatTokens(u.outputTokens)}`;
  sbClaudeUsage.title = `Claude Code Usage\nModel: ${u.model || '?'}\nInput: ${u.inputTokens.toLocaleString()}\nOutput: ${u.outputTokens.toLocaleString()}\nCache Read: ${u.cacheReadTokens.toLocaleString()}\nCache Create: ${u.cacheCreateTokens.toLocaleString()}\nCost: ${formatCost(u.totalCost)}`;
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
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
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
