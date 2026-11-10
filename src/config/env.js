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

/** An http(s) URL, or unset. An empty string counts as unset. */
const optionalHttpUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url({ protocol: /^https?$/ }).optional(),
);

const PAYPAL_BASE_URLS = Object.freeze({
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
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

  // Where data lives: `mysql`, or `memory` - no database needed, and everything
  // is gone when the process stops. Unset: memory when DB_PASSWORD is empty.
  STORE: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : undefined),
    z.enum(['mysql', 'memory']).optional(),
  ),

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

  PAYPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: z.string().default(''),
  PAYPAL_CLIENT_SECRET: z.string().default(''),
  PAYPAL_RETURN_URL: optionalHttpUrl,
  PAYPAL_CANCEL_URL: optionalHttpUrl,
  // Create orders and invoices through @paypal/agent-toolkit instead of the
  // REST client, falling back to REST if the toolkit fails.
  PAYPAL_USE_TOOLKIT: booleanish(false),
  // INR per USD. A fixed demo rate, not a market rate: PayPal cannot charge INR
  // to most accounts, so INR deals are charged in USD at this rate.
  DEMO_INR_PER_USD: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'expected a rate like 85 or 83.25')
    .refine((value) => Number(value) > 0, 'must be greater than zero')
    .default('85'),

  // The "Run demo" button. Unset means on, except in production.
  DEMO_ENABLED: booleanish(null),

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

  // No password means no MySQL to talk to, so default to memory - except in
  // production, where guessing wrong either way is costly: memory would lose
  // every accepted deal and payment record on restart.
  const passwordless = env.DB_PASSWORD.trim() === '';
  if (!env.STORE && passwordless && env.NODE_ENV === 'production') {
    throw new Error(
      'DB_PASSWORD is empty in production: set STORE=mysql or STORE=memory explicitly (memory loses all data on restart)',
    );
  }
  const store = env.STORE ?? (passwordless ? 'memory' : 'mysql');

  // PayPal is optional - without it, accepting a deal records the acceptance
  // and starts no payment. Half a credential pair is a mistake, not "off".
  const paypalId = env.PAYPAL_CLIENT_ID.trim();
  const paypalSecret = env.PAYPAL_CLIENT_SECRET.trim();
  if (Boolean(paypalId) !== Boolean(paypalSecret)) {
    throw new Error('Set both PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, or neither');
  }

  return Object.freeze({
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,

    /** 'mysql' or 'memory'. The `db` settings below are used only for mysql. */
    store,

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

    paypal: Object.freeze({
      enabled: Boolean(paypalId),
      env: env.PAYPAL_ENV,
      baseUrl: PAYPAL_BASE_URLS[env.PAYPAL_ENV],
      clientId: paypalId,
      clientSecret: paypalSecret,
      // Where PayPal sends the buyer back. GET /paid and GET /cancelled on this
      // server, unless the app is reachable at some other address.
      returnUrl: env.PAYPAL_RETURN_URL ?? `http://localhost:${env.PORT}/paid`,
      cancelUrl: env.PAYPAL_CANCEL_URL ?? `http://localhost:${env.PORT}/cancelled`,
      inrPerUsd: env.DEMO_INR_PER_USD,
      useToolkit: env.PAYPAL_USE_TOOLKIT,
    }),

    // The demo routes take no API key, create rows and run the agent (which
    // may call a paid model), so they are opt-in where it matters.
    demo: Object.freeze({
      enabled: env.DEMO_ENABLED ?? env.NODE_ENV !== 'production',
    }),

    test: Object.freeze({
      runDbTests: env.RUN_DB_TESTS,
      dbName: env.TEST_DB_NAME,
    }),
  });
}
