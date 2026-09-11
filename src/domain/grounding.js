/**
 * Grounding: no number leaves this system that the system cannot account for.
 *
 * A prompt is a request, not a constraint. "We told the model not to invent
 * prices" is not an enforcement mechanism, so generated prose is scanned for
 * numbers and checked against an allow-list built from the buyer's own limits
 * and the price the deterministic engine already chose. One number that is not
 * on the list discards the WHOLE generation in favour of deterministic wording.
 *
 * The check errs towards rejection. A false rejection costs a slightly stiffer
 * sentence from a template; a false acceptance puts a number nobody offered in
 * front of a real company.
 */

import { MINOR } from './money.js';

/**
 * Multipliers for the shorthand a model might use to smuggle a figure past a
 * digit scan. ORDER MATTERS: "lakh" contains a "k", so the longer words are
 * tested first and the bare "k" rule is last.
 */
const SHORTHAND = [
  { pattern: /^\s*lakhs?\b/i, multiplier: 100000 },
  { pattern: /^\s*lacs?\b/i, multiplier: 100000 },
  { pattern: /^\s*crores?\b/i, multiplier: 10000000 },
  { pattern: /^\s*millions?\b/i, multiplier: 1000000 },
  { pattern: /^\s*k\b/i, multiplier: 1000 },
];

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?\s*(?:k\b|lakhs?\b|lacs?\b|crores?\b|millions?\b)?/gi;

/**
 * Every number a reader could take away from this text, in major units.
 * Shorthand is expanded, so "1.2k" reads as 1200 and cannot hide.
 *
 * @param {string|null|undefined} text
 * @returns {number[]}
 */
export function numbersIn(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = [];
  const matches = text.match(NUMBER_TOKEN) ?? [];

  for (const raw of matches) {
    const digits = raw.match(/\d[\d,]*(?:\.\d+)?/);
    if (!digits) continue;
    const base = Number(digits[0].replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;

    const suffix = raw.slice(digits[0].length);
    const shorthand = SHORTHAND.find((s) => s.pattern.test(suffix));
    found.push(shorthand ? base * shorthand.multiplier : base);
  }
  return found;
}

/**
 * The numbers this particular message is authorised to contain.
 *
 * The buyer's MAXIMUM is never added by this function. There is no code path in
 * this project that authorises the ceiling to appear in outbound text.
 *
 * @param {object} params
 * @param {import('./limits.js').Limits} params.limits
 * @param {number|null} [params.counterMinor] the price the engine chose
 * @param {boolean} [params.discloseTarget]
 * @param {number[]} [params.extra] additional authorised numbers (major units)
 * @returns {Set<number>}
 */
export function allowedNumbers({ limits, counterMinor = null, discloseTarget = false, extra = [] }) {
  const allowed = new Set();

  if (counterMinor !== null && counterMinor !== undefined) {
    addMoney(allowed, counterMinor);
  }
  if (discloseTarget) {
    addMoney(allowed, limits.targetMinor);
  }
  if (limits.quantity > 0) {
    allowed.add(limits.quantity);
  }
  for (const value of extra) {
    if (Number.isFinite(value)) allowed.add(value);
  }
  return allowed;
}

/**
 * A money figure can legitimately be written several ways: 600, 600.00, or with
 * separators. All of them normalise to the same JavaScript number, so one entry
 * covers them - but a whole-rupee figure written as "600.00" and one written as
 * "600" must both be present, hence the two adds.
 */
function addMoney(set, minor) {
  set.add(minor / MINOR);
  set.add(Math.round(minor / MINOR));
}

/**
 * @param {string} text
 * @param {Set<number>} allowed
 * @returns {{ok: boolean, offending: number[]}}
 */
export function checkGrounding(text, allowed) {
  const offending = numbersIn(text).filter((value) => !allowed.has(value));
  return { ok: offending.length === 0, offending };
}

/**
 * Does this exact figure literally appear in the given text?
 *
 * Used the other way round from `checkGrounding`: before believing a price the
 * model claims to have read out of a seller's message, confirm the seller
 * actually wrote it. A model that paraphrases a price into existence fails this.
 *
 * @param {number} minor
 * @param {string} text
 * @returns {boolean}
 */
export function moneyAppearsIn(minor, text) {
  if (typeof text !== 'string') return false;
  const major = minor / MINOR;
  return numbersIn(text).some((value) => value === major || value === Math.round(major));
}
