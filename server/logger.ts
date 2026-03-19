/**
 * Structured logger for consistent, parseable log output.
 * Supports log levels: debug, info, warn, error.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, context: string, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `${timestamp} [${level.toUpperCase()}] [${context}] ${message}`;
  if (meta !== undefined) {
    return `${base} ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
  }
  return base;
}

export const logger = {
  debug(context: string, message: string, meta?: unknown): void {
    if (shouldLog('debug')) console.debug(formatMessage('debug', context, message, meta));
  },

  info(context: string, message: string, meta?: unknown): void {
    if (shouldLog('info')) console.log(formatMessage('info', context, message, meta));
  },

  warn(context: string, message: string, meta?: unknown): void {
    if (shouldLog('warn')) console.warn(formatMessage('warn', context, message, meta));
  },

  error(context: string, message: string, meta?: unknown): void {
    if (shouldLog('error')) console.error(formatMessage('error', context, message, meta));
  },
};
