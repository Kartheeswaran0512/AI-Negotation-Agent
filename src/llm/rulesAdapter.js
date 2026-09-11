/**
 * The rules adapter: interpretation with no model at all.
 *
 * It exists twice over. It is the PROVIDER when no API key is configured, which
 * is what makes `npm run demo`, the scenario suite and a fresh clone work with
 * nothing installed but Node. And it is the FALLBACK behind the Claude adapter,
 * so a timeout, a rate limit or a rejected generation degrades the product's
 * tone rather than its correctness.
 *
 * It returns the same raw shape as the model adapter, on purpose: both go
 * through the same fences in `verify.js`, so the verification layer is
 * exercised on every path rather than only the expensive one.
 *
 * It cannot write prose. `phraseMessage` returns null, which sends the caller to
 * the deterministic templates - an honest answer rather than a bad sentence.
 */

const CURRENCY_MARKED = /(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const PER_UNIT_MARKED =
  /([\d,]+(?:\.\d{1,2})?)\s*(?:\/-|\/\s*(?:unit|pc|piece)|per\s+(?:unit|piece|pc|item|nos?)|each|apiece|a\s+piece)/gi;
const QUANTITY_MARKED =
  /([\d,]+)\s*(?:units?|pieces?|pcs?|nos?\.?|items?|sets?|boxes|kgs?|kilograms?|tons?|litres?|liters?)\b/gi;
const ANY_NUMBER = /\b([\d,]+(?:\.\d{1,2})?)\b/g;

const DECLINE_MARKERS = [
  /\b(?:cannot|can't|can not|unable to|won't be able to)\s+(?:supply|provide|do|quote|fulfil|fulfill|deliver|serve)\b/i,
  /\bwe\s+(?:decline|pass|must decline|are not interested|regret)\b/i,
  /\b(?:not|no longer)\s+(?:available|in stock|possible for us)\b/i,
  /\bout of stock\b/i,
  /\bwe do not deal\b/i,
];

const ACCEPT_MARKERS = [
  /\bwe\s+(?:accept|agree|confirm)\b/i,
  /\b(?:agreed|accepted|confirmed)\b/i,
  /\b(?:deal|done)\b\s*[.!]/i,
  /\bok(?:ay)?\s+(?:for|at)\b/i,
];

/**
 * @returns {object} an LLM port implementation
 */
export function createRulesAdapter() {
  return {
    name: 'rules',
    model: null,

    async readSellerMessage({ text }) {
      const started = Date.now();
      const price = extractUnitPrice(text);
      const quantity = extractQuantity(text);

      return {
        reading: {
          intent: classifyIntent(text, price),
          unit_price: price,
          quantity,
          currency: detectCurrency(text),
          confidence: price === null ? 0.4 : 0.75,
        },
        usage: { latencyMs: Date.now() - started },
      };
    },

    async extractRequirement({ text }) {
      const started = Date.now();
      const unverified = [];

      const product = extractProduct(text);
      if (!product) unverified.push('product');

      const quantity = extractQuantity(text);
      if (quantity === null) unverified.push('quantity');

      const target = matchLabelledNumber(text, TARGET_LABELS);
      if (target === null) unverified.push('target_price');

      const max = matchLabelledNumber(text, MAX_LABELS);
      if (max === null) unverified.push('max_price');

      const basis = detectBasis(text);
      if (basis === null) unverified.push('price_basis');

      return {
        extraction: {
          product,
          quantity,
          unit: extractUnit(text),
          currency: detectCurrency(text),
          target_price: target,
          max_price: max,
          price_basis: basis,
          unverified,
        },
        usage: { latencyMs: Date.now() - started },
      };
    },

    // No model, no prose. The caller falls back to the deterministic templates.
    async phraseMessage() {
      return { text: null, usage: {} };
    },

    async explainOutcome() {
      return { text: null, usage: {} };
    },
  };
}

/**
 * Pick the number in the text most likely to be a unit price.
 *
 * Scored rather than "first match wins", because "100 units at 850 each" has
 * two numbers and only one of them is money.
 */
export function extractUnitPrice(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const flat = text.replace(/,/g, '');
  const scores = new Map();

  const bump = (value, score) => {
    if (!Number.isFinite(value) || value <= 0) return;
    scores.set(value, Math.max(scores.get(value) ?? -Infinity, score));
  };

  for (const match of flat.matchAll(reset(CURRENCY_MARKED))) bump(Number(match[1]), 3);
  for (const match of flat.matchAll(reset(PER_UNIT_MARKED))) bump(Number(match[1]), 3);
  for (const match of flat.matchAll(reset(QUANTITY_MARKED))) bump(Number(match[1]), -1);
  for (const match of flat.matchAll(reset(ANY_NUMBER))) bump(Number(match[1]), 1);

  let best = null;
  let bestScore = 0;
  for (const [value, score] of scores) {
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A quantity is either counted in units ("100 pieces") or stated right after an
 * intent verb ("I need 100 wireless earbuds"). The second form is why this is
 * not simply the first number in the sentence: in "target is 600 per unit" the
 * first number is money.
 */
const QUANTITY_INTENT =
  /(?:need|want|require|looking for|source|sourcing|buy|purchase|procure)\s+(?:about\s+|around\s+|approximately\s+)?([\d,]+)\b/i;

export function extractQuantity(text) {
  if (typeof text !== 'string') return null;
  const flat = text.replace(/,/g, '');

  for (const pattern of [reset(QUANTITY_MARKED), QUANTITY_INTENT]) {
    const match = pattern.exec(flat);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function classifyIntent(text, price) {
  if (typeof text !== 'string' || !text.trim()) return 'other';
  if (DECLINE_MARKERS.some((pattern) => pattern.test(text))) return 'decline';
  if (ACCEPT_MARKERS.some((pattern) => pattern.test(text))) return 'accept';
  if (price !== null) return 'offer';
  if (text.includes('?')) return 'question';
  return 'other';
}

const CURRENCY_SIGNS = [
  { pattern: /₹|\brs\.?\b|\binr\b|\brupees?\b/i, code: 'INR' },
  { pattern: /\$|\busd\b|\bdollars?\b/i, code: 'USD' },
  { pattern: /€|\beur\b|\beuros?\b/i, code: 'EUR' },
  { pattern: /£|\bgbp\b|\bpounds?\b/i, code: 'GBP' },
];

function detectCurrency(text) {
  if (typeof text !== 'string') return null;
  const hit = CURRENCY_SIGNS.find((entry) => entry.pattern.test(text));
  return hit ? hit.code : null;
}

const TARGET_LABELS = /(?:target|aiming for|aim for|hoping for|ideally|would like to pay)\D{0,24}?([\d,]+(?:\.\d{1,2})?)/i;
const MAX_LABELS =
  /(?:max(?:imum)?|budget|ceiling|no more than|not more than|up to|cannot exceed|can't exceed|limit)\D{0,24}?([\d,]+(?:\.\d{1,2})?)/i;

function matchLabelledNumber(text, pattern) {
  if (typeof text !== 'string') return null;
  const match = pattern.exec(text.replace(/,/g, ''));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const UNIT_WORD_SOURCE =
  'units?|pieces?|pcs?|nos?|items?|sets?|boxes|kgs?|kilograms?|tons?|litres?|liters?|metres?|meters?';

const UNIT_WORDS = new RegExp(`\\b(${UNIT_WORD_SOURCE})\\b`, 'i');

/**
 * "I need 100 wireless earbuds" -> "wireless earbuds".
 *
 * The optional group between the number and the product matches a UNIT word
 * only ("100 pieces of earbuds"). It deliberately does not match any word: an
 * earlier version did, and quietly ate the adjective, turning "wireless
 * earbuds" into "earbuds" - a different product from the one the buyer typed.
 */
const PRODUCT_PATTERN = new RegExp(
  '(?:need|want|looking for|source|sourcing|buy|purchase|require|procure)\\s+' +
    '(?:about\\s+|around\\s+|approximately\\s+)?' +
    '(?:[\\d,]+\\s+)?' +
    `(?:(?:${UNIT_WORD_SOURCE})\\s+(?:of\\s+)?)?` +
    '((?:[a-z][a-z-]*)(?:\\s+[a-z][a-z-]*){0,3})',
  'i',
);

function extractProduct(text) {
  if (typeof text !== 'string') return null;
  const match = PRODUCT_PATTERN.exec(text);
  if (!match) return null;

  const phrase = match[1]
    .split(/\s+/)
    .filter((word) => !UNIT_WORDS.test(word) && !STOP_WORDS.has(word.toLowerCase()))
    .join(' ')
    .trim();

  return phrase.length >= 3 ? phrase : null;
}

const STOP_WORDS = new Set(['of', 'the', 'a', 'an', 'some', 'my', 'our', 'for', 'at', 'with']);

function extractUnit(text) {
  if (typeof text !== 'string') return null;
  const match = UNIT_WORDS.exec(text);
  return match ? match[1].toLowerCase() : null;
}

function detectBasis(text) {
  if (typeof text !== 'string') return null;
  if (/per\s+(?:unit|piece|pc|item|each)|\beach\b|\bapiece\b|\/unit/i.test(text)) return 'per_unit';
  if (/\b(?:in total|total budget|for the (?:whole|entire|full) (?:order|lot)|all together|altogether)\b/i.test(text)) {
    return 'total';
  }
  return null;
}

/** Global regexes carry lastIndex between uses; reset before every scan. */
function reset(pattern) {
  pattern.lastIndex = 0;
  return pattern;
}
