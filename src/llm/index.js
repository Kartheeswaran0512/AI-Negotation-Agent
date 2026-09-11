/**
 * Pick an LLM adapter and wrap it in the interpreter.
 *
 * `LLM_PROVIDER=auto` (the default) resolves to Claude when an API key is
 * present and to the rules engine when it is not, which is what lets someone
 * clone this repository and run the agent end to end without an account.
 */

import { createClaudeAdapter } from './claudeAdapter.js';
import { createRulesAdapter } from './rulesAdapter.js';
import { createInterpreter } from './interpreter.js';

export { createClaudeAdapter, createRulesAdapter, createInterpreter };

/** An adapter that answers nothing, for LLM_PROVIDER=off. */
export function createNullAdapter() {
  return {
    name: 'off',
    model: null,
    async readSellerMessage() {
      return { reading: null, usage: {} };
    },
    async extractRequirement() {
      return { extraction: null, usage: {} };
    },
    async phraseMessage() {
      return { text: null, usage: {} };
    },
    async explainOutcome() {
      return { text: null, usage: {} };
    },
  };
}

/**
 * @param {object} config the object returned by loadConfig()
 * @param {object} [options]
 * @param {object} [options.client]  inject an Anthropic stub in tests
 * @param {object} [options.logger]
 * @returns {object} an interpreter
 */
export function createLlm(config, { client, logger } = {}) {
  const { provider, apiKey, model, timeoutMs, maxTokens } = config.llm;

  if (provider === 'off') {
    return createInterpreter({ llm: createNullAdapter(), fallback: null, timeoutMs, logger });
  }

  if (provider === 'rules') {
    const rules = createRulesAdapter();
    return createInterpreter({ llm: rules, fallback: null, timeoutMs, logger });
  }

  const claude = createClaudeAdapter({ apiKey, model, timeoutMs, maxTokens, client });
  return createInterpreter({
    llm: claude,
    fallback: createRulesAdapter(),
    timeoutMs,
    logger,
  });
}
