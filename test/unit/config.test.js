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
