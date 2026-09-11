/**
 * Configuration, validated once at boot.
 *
 * A missing or malformed setting fails the process immediately with a readable
 * message, rather than surfacing as `undefined` inside a database driver twenty
 * minutes later. Nothing in src/domain imports this file - the domain layer is
 * pure and takes its numbers as arguments.
 */

import 'dotenv/config';
import { z } from 'zod';

const booleanish = (defaultValue) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),

  DB_HOST: z.string().min(1).default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1).default('negotiation'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1).default('negotiation_agent'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),

  API_KEY: z.string().default(''),

  LLM_PROVIDER: z.enum(['auto', 'claude', 'rules', 'off']).default('auto'),
  ANTHROPIC_API_KEY: z.string().default(''),
  CLAUDE_MODEL: z.string().min(1).default('claude-opus-5'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(8192),

  AGENT_ENABLED: booleanish(true),
  AGENT_DRY_RUN: booleanish(false),
  AGENT_TICK_MS: z.coerce.number().int().min(500).default(5000),
  AGENT_MAX_ROUNDS: z.coerce.number().int().min(1).max(20).default(6),
  AGENT_DAILY_SEND_LIMIT: z.coerce.number().int().positive().default(200),

  RUN_DB_TESTS: booleanish(false),
  TEST_DB_NAME: z.string().default('negotiation_agent_test'),
});

/**
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {object} frozen configuration
 */
export function loadConfig(source = process.env) {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }

  const env = parsed.data;

  // `auto` is the setting that lets the whole project run with no API key: it
  // resolves to Claude only when a key is actually present.
  const provider =
    env.LLM_PROVIDER === 'auto'
      ? env.ANTHROPIC_API_KEY.trim()
        ? 'claude'
        : 'rules'
      : env.LLM_PROVIDER;

  if (provider === 'claude' && !env.ANTHROPIC_API_KEY.trim()) {
    throw new Error('LLM_PROVIDER=claude requires ANTHROPIC_API_KEY to be set');
  }

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,

    db: Object.freeze({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      connectionLimit: env.DB_CONNECTION_LIMIT,
    }),

    apiKey: env.API_KEY,

    llm: Object.freeze({
      provider,
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.CLAUDE_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxTokens: env.LLM_MAX_TOKENS,
    }),

    agent: Object.freeze({
      enabled: env.AGENT_ENABLED,
      dryRun: env.AGENT_DRY_RUN,
      tickMs: env.AGENT_TICK_MS,
      maxRounds: env.AGENT_MAX_ROUNDS,
      dailySendLimit: env.AGENT_DAILY_SEND_LIMIT,
    }),

    test: Object.freeze({
      runDbTests: env.RUN_DB_TESTS,
      dbName: env.TEST_DB_NAME,
    }),
  });
}
