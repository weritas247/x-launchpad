/**
 * Environment variable validation and typed access.
 * Fails fast on startup if required variables are missing.
 */

interface EnvConfig {
  // Server
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';

  // Auth (all optional)
  AUTH_TOKEN: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  ALLOW_REGISTRATION: boolean;

  // Supabase (optional — features degrade gracefully)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Terminal
  ENABLE_TMUX: boolean;
  SHELL: string;
  HOME: string;

  // Electron
  ELECTRON: boolean;
}

function getEnv(): EnvConfig {
  const env = process.env;

  return {
    PORT: parseInt(env.PORT || '3000', 10),
    NODE_ENV: (env.NODE_ENV as EnvConfig['NODE_ENV']) || 'development',
    LOG_LEVEL: (env.LOG_LEVEL as EnvConfig['LOG_LEVEL']) || 'info',

    AUTH_TOKEN: env.AUTH_TOKEN || '',
    JWT_SECRET: env.JWT_SECRET || '',
    JWT_EXPIRES_IN: env.JWT_EXPIRES_IN || '7d',
    ALLOW_REGISTRATION: env.ALLOW_REGISTRATION === '1',

    SUPABASE_URL: env.SUPABASE_URL || '',
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '',
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY || '',

    ENABLE_TMUX: env.ENABLE_TMUX === '1',
    SHELL: env.SHELL || '/bin/bash',
    HOME: env.HOME || '/',

    ELECTRON: env.ELECTRON === '1',
  };
}

/** Validated, typed environment configuration */
export const env = getEnv();

/**
 * Log a summary of the environment configuration at startup.
 * Sensitive values are masked.
 */
export function logEnvSummary(): void {
  const mask = (s: string) => (s ? `${s.slice(0, 4)}****` : '(not set)');

  console.log('[env] Configuration:');
  console.log(`  PORT=${env.PORT}`);
  console.log(`  NODE_ENV=${env.NODE_ENV}`);
  console.log(`  LOG_LEVEL=${env.LOG_LEVEL}`);
  console.log(`  AUTH_TOKEN=${env.AUTH_TOKEN ? 'set' : '(not set)'}`);
  console.log(`  JWT_SECRET=${env.JWT_SECRET ? 'set' : '(auto-generated)'}`);
  console.log(`  SUPABASE_URL=${env.SUPABASE_URL ? mask(env.SUPABASE_URL) : '(not set)'}`);
  console.log(`  ENABLE_TMUX=${env.ENABLE_TMUX}`);
  console.log(`  ALLOW_REGISTRATION=${env.ALLOW_REGISTRATION}`);
}
