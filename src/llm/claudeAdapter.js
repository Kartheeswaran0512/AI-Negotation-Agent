/**
 * The Claude adapter.
 *
 * The API key lives here and only here - server side, read from the
 * environment, never sent to a client and never written to a log. This module
 * is the single point at which this project talks to a model.
 *
 * Structured output is done with a strict tool definition rather than free
 * text: the API validates the arguments against the JSON Schema, we re-validate
 * with Zod on arrival, and `verify.js` then checks the values against reality.
 * `tool_choice` is left on `auto` with an explicit instruction naming the tool,
 * which is the shape that works across the whole current model family.
 *
 * Thinking is not configured: on the current Opus family, omitting the
 * parameter runs adaptive thinking, which is what these short tasks want.
 * `effort: low` keeps them cheap - they are narrow, fully specified jobs.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  readingZod,
  readingJsonSchema,
  extractionZod,
  extractionJsonSchema,
} from './schemas.js';
import {
  READER_SYSTEM,
  EXTRACTOR_SYSTEM,
  PHRASER_SYSTEM,
  EXPLAINER_SYSTEM,
  readerUser,
  extractorUser,
  phraserUser,
  explainerUser,
} from './prompts.js';

/**
 * @param {object} options
 * @param {string} [options.apiKey]
 * @param {string} options.model
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxTokens]
 * @param {object} [options.client] inject a stub in tests; never used in production
 * @returns {object} an LLM port implementation
 */
export function createClaudeAdapter({
  apiKey,
  model,
  timeoutMs = 8000,
  maxTokens = 8192,
  client,
} = {}) {
  const anthropic = client ?? new Anthropic({ apiKey });

  async function call(request) {
    const started = Date.now();
    const response = await anthropic.messages.create(
      { model, max_tokens: maxTokens, output_config: { effort: 'low' }, ...request },
      { timeout: timeoutMs },
    );
    return { response, latencyMs: Date.now() - started };
  }

  return {
    name: 'claude',
    model,

    async readSellerMessage({ text }) {
      const { response, latencyMs } = await call({
        system: READER_SYSTEM,
        messages: [{ role: 'user', content: readerUser(text) }],
        tools: [
          {
            name: 'record_reading',
            description: 'Record what the supplier message says. Always call this tool.',
            input_schema: readingJsonSchema,
            strict: true,
          },
        ],
      });

      const input = toolInput(response, 'record_reading');
      const parsed = input ? readingZod.safeParse(input) : null;

      return {
        reading: parsed?.success ? parsed.data : null,
        usage: usageOf(response, latencyMs),
      };
    },

    async extractRequirement({ text }) {
      const { response, latencyMs } = await call({
        system: EXTRACTOR_SYSTEM,
        messages: [{ role: 'user', content: extractorUser(text) }],
        tools: [
          {
            name: 'record_requirement',
            description: 'Record the requirement in the buyer message. Always call this tool.',
            input_schema: extractionJsonSchema,
            strict: true,
          },
        ],
      });

      const input = toolInput(response, 'record_requirement');
      const parsed = input ? extractionZod.safeParse(input) : null;

      return {
        extraction: parsed?.success ? parsed.data : null,
        usage: usageOf(response, latencyMs),
      };
    },

    async phraseMessage({ facts, permitted, lastSupplierMessage = null }) {
      const { response, latencyMs } = await call({
        system: PHRASER_SYSTEM,
        messages: [{ role: 'user', content: phraserUser({ facts, permitted, lastSupplierMessage }) }],
      });

      return { text: firstText(response), usage: usageOf(response, latencyMs) };
    },

    async explainOutcome({ facts, permitted }) {
      const { response, latencyMs } = await call({
        system: EXPLAINER_SYSTEM,
        messages: [{ role: 'user', content: explainerUser({ facts, permitted }) }],
      });

      return { text: firstText(response), usage: usageOf(response, latencyMs) };
    },
  };
}

/**
 * A refusal, a truncation or a turn with no tool call all mean the same thing
 * to this system: no usable answer, fall back to the deterministic path.
 */
function toolInput(response, name) {
  if (!response || response.stop_reason === 'refusal') return null;
  const blocks = Array.isArray(response.content) ? response.content : [];
  const block = blocks.find((item) => item.type === 'tool_use' && item.name === name);
  if (!block) return null;
  // Tool inputs arrive parsed; a string here means something upstream changed.
  return typeof block.input === 'string' ? safeJson(block.input) : (block.input ?? null);
}

function firstText(response) {
  if (!response || response.stop_reason === 'refusal') return null;
  const blocks = Array.isArray(response.content) ? response.content : [];
  const block = blocks.find((item) => item.type === 'text' && typeof item.text === 'string');
  return block ? block.text.trim() : null;
}

function usageOf(response, latencyMs) {
  const usage = response?.usage ?? {};
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    latencyMs,
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
