/**
 * Claude Code usage tracking and prompt extraction.
 * Parses Claude's JSONL session files for token usage and user prompts.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  totalCost: number;
  sessionId: string | null;
  model: string | null;
}

// Model pricing per million tokens (input / output)
const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheCreate: number }
> = {
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheCreate: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreate: 1 },
  // Fallback for older models
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
};

export function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/[/_]/g, '-');
}

function findActiveSessionId(cwd: string): string | null {
  try {
    const sessDir = path.join(CLAUDE_DIR, 'sessions');
    if (!fs.existsSync(sessDir)) return null;
    const sessFiles = fs.readdirSync(sessDir).filter((f) => f.endsWith('.json'));
    let activeSessionId: string | null = null;
    for (const sf of sessFiles) {
      try {
        const raw = fs.readFileSync(path.join(sessDir, sf), 'utf-8');
        const sess = JSON.parse(raw);
        if (sess.cwd === cwd && sess.sessionId) {
          activeSessionId = sess.sessionId;
        }
      } catch {}
    }
    return activeSessionId;
  } catch {
    return null;
  }
}

function findTargetJsonl(projectDir: string, activeSessionId: string | null): string | null {
  if (activeSessionId) {
    const candidate = path.join(projectDir, `${activeSessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback: find the most recently modified .jsonl
  const jsonls = fs
    .readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (jsonls.length > 0) return path.join(projectDir, jsonls[0].name);
  return null;
}

export function getClaudeUsage(cwd: string): ClaudeUsage | null {
  try {
    const projectKey = cwdToProjectDir(cwd);
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectKey);
    if (!fs.existsSync(projectDir)) return null;

    const activeSessionId = findActiveSessionId(cwd);
    const targetJsonl = findTargetJsonl(projectDir, activeSessionId);
    if (!targetJsonl) return null;

    const content = fs.readFileSync(targetJsonl, 'utf-8');
    const lines = content.trim().split('\n');

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreateTokens = 0;
    let totalCost = 0;
    let model: string | null = null;
    let claudeSessionId: string | null = null;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'assistant' || !entry.message?.usage) continue;

        const usage = entry.message.usage;
        const m = entry.message.model || '';
        if (m) model = m;
        if (entry.sessionId) claudeSessionId = entry.sessionId;

        const inp = usage.input_tokens || 0;
        const out = usage.output_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;

        inputTokens += inp;
        outputTokens += out;
        cacheReadTokens += cacheRead;
        cacheCreateTokens += cacheCreate;

        const pricing = MODEL_PRICING[m] || MODEL_PRICING['claude-sonnet-4-6'];
        totalCost +=
          (inp / 1_000_000) * pricing.input +
          (out / 1_000_000) * pricing.output +
          (cacheRead / 1_000_000) * pricing.cacheRead +
          (cacheCreate / 1_000_000) * pricing.cacheCreate;
      } catch {}
    }

    if (inputTokens === 0 && outputTokens === 0) return null;

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreateTokens,
      totalCost,
      sessionId: claudeSessionId,
      model,
    };
  } catch {
    return null;
  }
}

export function getClaudePrompts(
  cwd: string,
  aiPid: number | null
): { text: string; timestamp: string }[] {
  try {
    const projectKey = cwdToProjectDir(cwd);
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectKey);
    if (!fs.existsSync(projectDir)) return [];

    let activeSessionId: string | null = null;
    const sessDir = path.join(CLAUDE_DIR, 'sessions');

    // 1) PID-based lookup
    if (aiPid) {
      try {
        const pidFile = path.join(sessDir, `${aiPid}.json`);
        console.log(
          `[claude_prompts] checking pidFile=${pidFile} exists=${fs.existsSync(pidFile)}`
        );
        if (fs.existsSync(pidFile)) {
          const sess = JSON.parse(fs.readFileSync(pidFile, 'utf-8'));
          if (sess.sessionId) {
            activeSessionId = sess.sessionId;
            console.log(`[claude_prompts] PID match → sessionId=${activeSessionId}`);
          }
        }
      } catch {}
    }

    // 2) Fallback: CWD match
    if (!activeSessionId) {
      try {
        if (fs.existsSync(sessDir)) {
          const sessFiles = fs.readdirSync(sessDir).filter((f) => f.endsWith('.json'));
          for (const sf of sessFiles) {
            try {
              const raw = fs.readFileSync(path.join(sessDir, sf), 'utf-8');
              const sess = JSON.parse(raw);
              if (sess.cwd === cwd && sess.sessionId) activeSessionId = sess.sessionId;
            } catch {}
          }
        }
      } catch {}
    }

    console.log(`[claude_prompts] resolved activeSessionId=${activeSessionId}`);
    let targetJsonl: string | null = null;
    if (activeSessionId) {
      const candidate = path.join(projectDir, `${activeSessionId}.jsonl`);
      if (fs.existsSync(candidate)) targetJsonl = candidate;
    }
    if (!targetJsonl) {
      const jsonls = fs
        .readdirSync(projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (jsonls.length > 0) targetJsonl = path.join(projectDir, jsonls[0].name);
      console.log(`[claude_prompts] fallback to most recent jsonl`);
    }
    if (!targetJsonl) return [];
    console.log(`[claude_prompts] reading ${path.basename(targetJsonl)}`);

    const content = fs.readFileSync(targetJsonl, 'utf-8');
    const lines = content.trim().split('\n');
    const prompts: { text: string; timestamp: string }[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'user' || entry.toolUseResult || entry.isMeta) continue;
        const msg = entry.message;
        if (!msg) continue;
        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              text = block.text;
              break;
            }
          }
        }
        const trimmed = text.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<local-command-caveat>'))
          continue;
        prompts.push({ text: trimmed, timestamp: entry.timestamp || '' });
      } catch {}
    }
    return prompts;
  } catch {
    return [];
  }
}
