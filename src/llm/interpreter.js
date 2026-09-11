/**
 * The interpreter: one place where a model's answer becomes something the rest
 * of the system is allowed to believe.
 *
 * Order of operations, and none of it is optional:
 *   1. an injection attempt is never shown to the model at all - it is read by
 *      the rules engine and flagged, and the agent escalates to a human;
 *   2. the primary adapter is called under a timeout;
 *   3. a null, malformed or timed-out answer falls back to the rules engine;
 *   4. whatever comes back goes through the fences in `verify.js`;
 *   5. the caller is told which path produced the answer, so the audit row can
 *      record it.
 *
 * The fallback is what makes the whole product resilient: with the model off,
 * slow, rate-limited or wrong, the agent still negotiates - it just writes
 * plainer sentences.
 */

import { detectInjection, verifyReading, verifyExtraction, verifyPhrasing } from './verify.js';

/**
 * @param {object} options
 * @param {object} options.llm       primary adapter
 * @param {object} [options.fallback] used when the primary yields nothing
 * @param {number} [options.timeoutMs]
 * @param {object} [options.logger]
 */
export function createInterpreter({ llm, fallback = null, timeoutMs = 8000, logger = null }) {
  const runFallback = fallback && fallback !== llm ? fallback : null;

  async function attempt(adapter, method, args) {
    if (!adapter || typeof adapter[method] !== 'function') return null;
    try {
      return await withTimeout(adapter[method](args), timeoutMs);
    } catch (error) {
      logger?.warn?.('llm call failed', {
        provider: adapter.name,
        method,
        error: error?.message ?? String(error),
      });
      return null;
    }
  }

  return {
    provider: llm?.name ?? 'off',
    model: llm?.model ?? null,

    /**
     * @param {object} params
     * @param {string} params.text the supplier's message
     */
    async readSeller({ text }) {
      const injection = detectInjection(text);

      // An attempt to instruct the agent is not interpreted at all - not by the
      // model, and not by the rules engine either. Nothing in a message like
      // that is allowed to move a number or a state; the negotiation goes to a
      // human and the text is kept verbatim for them to read.
      if (injection) {
        return { reading: null, dropped: [], injection, source: 'none', fellBack: false, usage: {} };
      }

      let source = llm?.name ?? 'none';
      let result = await attempt(llm, 'readSellerMessage', { text });
      let fellBack = false;

      if ((!result || !result.reading) && runFallback) {
        result = await attempt(runFallback, 'readSellerMessage', { text });
        source = runFallback.name;
        fellBack = true;
      }

      const { reading, dropped } = verifyReading(result?.reading ?? null, text);

      return {
        reading,
        dropped,
        injection,
        source: reading ? source : 'none',
        fellBack,
        usage: result?.usage ?? {},
      };
    },

    /**
     * @param {object} params
     * @param {string} params.text the buyer's own words
     */
    async extract({ text }) {
      let source = llm?.name ?? 'none';
      let result = await attempt(llm, 'extractRequirement', { text });
      let fellBack = false;

      if ((!result || !result.extraction) && runFallback) {
        result = await attempt(runFallback, 'extractRequirement', { text });
        source = runFallback.name;
        fellBack = true;
      }

      const { extraction, unverified } = verifyExtraction(result?.extraction ?? null, text);

      return {
        extraction,
        unverified,
        source: extraction ? source : 'none',
        fellBack,
        usage: result?.usage ?? {},
      };
    },

    /**
     * Wording for a message whose CONTENT was already decided.
     *
     * @param {object} params
     * @param {object} params.facts       already-decided facts for the prompt
     * @param {Set<number>} params.allowed the only numbers permitted in the text
     * @param {string} params.template    the deterministic wording to fall back to
     * @param {string} [params.lastSupplierMessage]
     */
    async phrase({ facts, allowed, template, lastSupplierMessage = null }) {
      const permitted = [...allowed].sort((a, b) => a - b);
      const result = await attempt(llm, 'phraseMessage', {
        facts,
        permitted,
        lastSupplierMessage,
      });

      const checked = verifyPhrasing(result?.text ?? null, allowed);

      if (checked.ok) {
        return {
          text: checked.text,
          generatedBy: 'llm',
          grounded: true,
          offending: [],
          usage: result?.usage ?? {},
        };
      }

      return {
        text: template,
        generatedBy: 'template',
        // `grounded` is null when nothing was generated: there was no claim to
        // check. It is false only when a generation was produced and rejected.
        grounded: result?.text ? false : null,
        offending: checked.offending,
        usage: result?.usage ?? {},
      };
    },

    /**
     * @param {object} params
     * @param {object} params.facts
     * @param {Set<number>} params.allowed
     * @param {string} params.fallbackText
     */
    async explain({ facts, allowed, fallbackText }) {
      const permitted = [...allowed].sort((a, b) => a - b);
      const result = await attempt(llm, 'explainOutcome', { facts, permitted });
      const checked = verifyPhrasing(result?.text ?? null, allowed);

      return checked.ok
        ? { text: checked.text, generatedBy: 'llm', usage: result?.usage ?? {} }
        : { text: fallbackText, generatedBy: 'template', usage: result?.usage ?? {} };
    },
  };
}

function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`llm call timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
