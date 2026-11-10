import { loadConfig } from '../../src/config/env.js';
import { splitStatements } from '../../src/db/migrate.js';

describe('configuration', () => {
  test('runs with an empty environment, in rules mode', () => {
    const config = loadConfig({});
    expect(config.llm.provider).toBe('rules');
    expect(config.agent.enabled).toBe(true);
    expect(config.agent.dryRun).toBe(false);
    expect(config.agent.maxRounds).toBe(6);
  });

  test('auto resolves to Claude only when a key is present', () => {
    expect(loadConfig({ LLM_PROVIDER: 'auto' }).llm.provider).toBe('rules');
    expect(loadConfig({ LLM_PROVIDER: 'auto', ANTHROPIC_API_KEY: 'sk-test' }).llm.provider).toBe(
      'claude',
    );
  });

  test('LLM_PROVIDER=claude without a key fails fast', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'claude' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  test('rejects nonsense rather than coercing it', () => {
    expect(() => loadConfig({ PORT: 'http' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ AGENT_MAX_ROUNDS: '0' })).toThrow(/Invalid configuration/);
  });

  test('boolean switches accept the spellings people actually use', () => {
    for (const truthy of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(loadConfig({ AGENT_DRY_RUN: truthy }).agent.dryRun).toBe(true);
    }
    for (const falsy of ['0', 'false', 'no', 'off', '']) {
      expect(loadConfig({ AGENT_DRY_RUN: falsy }).agent.dryRun).toBe(false);
    }
  });

  test('the config object is frozen so nothing edits it at runtime', () => {
    const config = loadConfig({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.agent)).toBe(true);
  });

  test('the default model is the current Claude Opus id', () => {
    expect(loadConfig({}).llm.model).toBe('claude-opus-5');
  });
});

describe('demo switch', () => {
  test('is on by default, except in production', () => {
    const production = { NODE_ENV: 'production', STORE: 'mysql' };
    expect(loadConfig({}).demo.enabled).toBe(true);
    expect(loadConfig(production).demo.enabled).toBe(false);
    expect(loadConfig({ ...production, DEMO_ENABLED: 'true' }).demo.enabled).toBe(true);
    expect(loadConfig({ DEMO_ENABLED: 'false' }).demo.enabled).toBe(false);
  });
});

describe('store', () => {
  test('defaults to memory when there is no database password, mysql when there is', () => {
    expect(loadConfig({}).store).toBe('memory');
    expect(loadConfig({ DB_PASSWORD: '   ' }).store).toBe('memory');
    expect(loadConfig({ DB_PASSWORD: 'secret' }).store).toBe('mysql');
  });

  test('STORE wins over the default, either way, in any case', () => {
    expect(loadConfig({ STORE: 'mysql' }).store).toBe('mysql');
    expect(loadConfig({ STORE: 'Memory', DB_PASSWORD: 'secret' }).store).toBe('memory');
    expect(loadConfig({ STORE: '' }).store).toBe('memory');
    expect(() => loadConfig({ STORE: 'sqlite' })).toThrow(/Invalid configuration/);
  });

  test('PRODUCTION NEVER GUESSES: an empty password needs STORE set explicitly', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/STORE=mysql or STORE=memory/);
    expect(loadConfig({ NODE_ENV: 'production', STORE: 'memory' }).store).toBe('memory');
    expect(loadConfig({ NODE_ENV: 'production', DB_PASSWORD: 'secret' }).store).toBe('mysql');
  });
});

describe('PayPal configuration', () => {
  test('is off without credentials and on, in sandbox, with both', () => {
    expect(loadConfig({}).paypal.enabled).toBe(false);

    const paypal = loadConfig({ PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' }).paypal;
    expect(paypal.enabled).toBe(true);
    expect(paypal.env).toBe('sandbox');
    expect(paypal.baseUrl).toBe('https://api-m.sandbox.paypal.com');
  });

  test('the Agent Toolkit path is off unless PAYPAL_USE_TOOLKIT is set', () => {
    expect(loadConfig({}).paypal.useToolkit).toBe(false);
    expect(loadConfig({ PAYPAL_USE_TOOLKIT: 'true' }).paypal.useToolkit).toBe(true);
  });

  test('half a credential pair fails fast', () => {
    expect(() => loadConfig({ PAYPAL_CLIENT_ID: 'id' })).toThrow(/PAYPAL_CLIENT_SECRET/);
  });

  test('return URLs default to this server and must be http(s)', () => {
    expect(loadConfig({ PORT: '4000' }).paypal.returnUrl).toBe('http://localhost:4000/paid');
    expect(loadConfig({ PAYPAL_CANCEL_URL: '' }).paypal.cancelUrl).toBe('http://localhost:3000/cancelled');
    expect(() => loadConfig({ PAYPAL_RETURN_URL: 'javascript:alert(1)' })).toThrow(/Invalid configuration/);
  });

  test('the demo rate must be a positive decimal', () => {
    expect(loadConfig({ DEMO_INR_PER_USD: '83.25' }).paypal.inrPerUsd).toBe('83.25');
    expect(() => loadConfig({ DEMO_INR_PER_USD: '0' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ DEMO_INR_PER_USD: 'eighty' })).toThrow(/Invalid configuration/);
  });
});

describe('migration splitter', () => {
  test('splits on semicolons at end of line', () => {
    const statements = splitStatements('CREATE TABLE a (id INT);\nCREATE TABLE b (id INT);\n');
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TABLE a');
  });

  test('drops comment-only chunks', () => {
    const statements = splitStatements('-- a comment\n-- another\n\nSELECT 1;\n');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('SELECT 1');
  });

  test('keeps a leading comment attached to its statement', () => {
    const statements = splitStatements('-- explains the table\nCREATE TABLE a (id INT);\n');
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('CREATE TABLE a');
  });

  test('tolerates a final statement with no trailing newline', () => {
    expect(splitStatements('SELECT 1')).toEqual(['SELECT 1']);
  });
});
