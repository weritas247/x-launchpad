import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { WebSocket, WebSocketServer } from 'ws';
import * as userDb from '../supabase';

const TIMEOUT_MS = 10 * 60 * 1000; // 10분
const MAX_STDOUT = 1024 * 1024;     // 1MB
const MAX_CONCURRENT_PER_USER = 3;

interface HeadlessJob {
  planId: string;
  userId: number;
  sessionId: string;
  process: ChildProcess;
  stdout: string;
  stderr: string;
  status: 'running' | 'done' | 'failed';
  timer: ReturnType<typeof setTimeout>;
}

export const headlessJobs = new Map<string, HeadlessJob>();

function broadcast(wss: WebSocketServer, msg: object) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

export async function startHeadless(
  wss: WebSocketServer,
  userId: number,
  planId: string,
  prompt: string,
  options: { useWorktree?: boolean; category?: string; cwd?: string }
): Promise<{ sessionId: string }> {
  // 동시 실행 제한
  const userJobs = [...headlessJobs.values()].filter(
    (j) => j.userId === userId && j.status === 'running'
  );
  if (userJobs.length >= MAX_CONCURRENT_PER_USER) {
    throw new Error('Too many concurrent headless jobs');
  }

  const sessionId = randomUUID();
  const args = ['-p', '--session-id', sessionId, '--output-format', 'json', '--dangerously-skip-permissions'];

  // 워크트리 조합
  if (options.useWorktree) {
    const prefix = options.category === 'bug' ? 'fix' : 'feat';
    const randomWord = Math.random().toString(36).slice(2, 8);
    args.push('-w', `${prefix}/claude-${randomWord}`);
  }

  const proc = spawn('claude', args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, X_LAUNCHPAD_PLAN_ID: planId },
  });

  // stdin으로 prompt 전달 (에러 핸들링 포함)
  proc.stdin.on('error', (err) => {
    console.error('[headless] stdin error:', err.message);
  });
  proc.stdin.write(prompt);
  proc.stdin.end();

  const job: HeadlessJob = {
    planId,
    userId,
    sessionId,
    process: proc,
    stdout: '',
    stderr: '',
    status: 'running',
    timer: setTimeout(() => {
      if (job.status === 'running') {
        proc.kill();
        job.status = 'failed';
        broadcast(wss, { type: 'headless_failed', planId, sessionId, error: 'Timeout (10m)' });
        headlessJobs.delete(sessionId);
      }
    }, TIMEOUT_MS),
  };
  headlessJobs.set(sessionId, job);

  // stdout 수집
  proc.stdout.on('data', (chunk: Buffer) => {
    job.stdout += chunk.toString();
    if (job.stdout.length > MAX_STDOUT) {
      proc.kill();
      job.status = 'failed';
      broadcast(wss, { type: 'headless_failed', planId, sessionId, error: 'Output too large (>1MB)' });
      clearTimeout(job.timer);
      headlessJobs.delete(sessionId);
    }
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    job.stderr += chunk.toString();
  });

  // 프로세스 종료 처리
  proc.on('close', async (code) => {
    clearTimeout(job.timer);
    if (job.status !== 'running') return; // 이미 처리됨 (timeout/kill/cancel)

    if (code === 0) {
      job.status = 'done';
      // JSON 파싱 → 텍스트 추출
      let resultText = job.stdout;
      try {
        const parsed = JSON.parse(job.stdout);
        resultText = parsed.result || parsed.content || parsed.text || job.stdout;
      } catch {
        // JSON 파싱 실패 시 raw stdout 사용
      }

      // 카드 content에 append + 액티비티 로그 기록
      try {
        const plan = await userDb.getPlan(userId, planId);
        if (plan) {
          const newContent = (plan.content || '') + '\n\n---\n**AI 결과 (headless):**\n' + resultText;
          await userDb.updatePlan(userId, planId, { content: newContent });
          // appendPlanLog with type 'summary' triggers ai_done + status 'done'
          await userDb.appendPlanLog(userId, {
            plan_id: planId,
            type: 'summary',
            content: `[headless] ${resultText.slice(0, 500)}`,
          });
        }
      } catch (err) {
        console.error('[headless] failed to update plan:', err);
      }

      broadcast(wss, { type: 'headless_done', planId, sessionId, result: resultText });
    } else {
      job.status = 'failed';
      broadcast(wss, { type: 'headless_failed', planId, sessionId, error: job.stderr || `Exit code ${code}` });
    }
    headlessJobs.delete(sessionId);
  });

  // 시작 이벤트
  broadcast(wss, { type: 'headless_started', planId, sessionId });

  return { sessionId };
}

export function cancelHeadless(sessionId: string): boolean {
  const job = headlessJobs.get(sessionId);
  if (!job || job.status !== 'running') return false;
  job.process.kill();
  job.status = 'failed';
  clearTimeout(job.timer);
  headlessJobs.delete(sessionId);
  return true;
}

export function getRunningJobs(userId: number) {
  return [...headlessJobs.values()]
    .filter((j) => j.userId === userId && j.status === 'running')
    .map((j) => ({ planId: j.planId, sessionId: j.sessionId }));
}
