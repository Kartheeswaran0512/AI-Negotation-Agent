/**
 * The buyer's negotiating boundary.
 *
 * Two figures, both stated by the buyer and never inferred: the TARGET they
 * want and the MAXIMUM they will not exceed. Everything the agent is allowed to
 * do is bounded by these, so this is the one object the LLM may never produce
 * or modify.
 *
 * Limits are always normalised to a PER-UNIT price. A buyer who states a total
 * budget must also state a quantity, because "5 pieces, budget 10,000" is a 5x
 * difference between the two readings and guessing it wrong sends a real offer
 * to a real company. Ambiguity is a hard stop, not a default.
 */

import { divideMinor, isPositiveMinor, assertMinor } from './money.js';

/** @enum {string} */
export const PRICE_BASIS = Object.freeze({
  PER_UNIT: 'per_unit',
  TOTAL: 'total',
});

export const PRICE_BASES = Object.freeze(Object.values(PRICE_BASIS));

export class LimitsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LimitsError';
  }
}

/**
 * @typedef {object} Limits
 * @property {string}  product      What is being sourced, in the buyer's words.
 * @property {number}  quantity     Whole units. 0 means "not stated".
 * @property {string}  unit         "pieces", "kg", ... Free text from the buyer.
 * @property {string}  currency     ISO 4217.
 * @property {number}  targetMinor  Per-unit target, minor units.
 * @property {number}  maxMinor     Per-unit ceiling, minor units.
 * @property {string}  basis        The basis the BUYER used (per_unit | total).
 */

/**
 * Build a validated Limits object.
 *
 * @param {object} input
 * @param {string} input.product
 * @param {number} [input.quantity]
 * @param {string} [input.unit]
 * @param {string} [input.currency]
 * @param {number} input.targetMinor  Target in the stated basis.
 * @param {number} input.maxMinor     Maximum in the stated basis.
 * @param {string} input.basis
 * @returns {Limits}
 */
export function createLimits(input) {
  const product = typeof input.product === 'string' ? input.product.trim() : '';
  if (!product) throw new LimitsError('limits: a product is required');

  const basis = input.basis;
  if (!PRICE_BASES.includes(basis)) {
    throw new LimitsError(`limits: basis must be one of ${PRICE_BASES.join(', ')}`);
  }

  const quantity = input.quantity ?? 0;
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new LimitsError('limits: quantity must be a non-negative whole number');
  }

  assertMinor(input.targetMinor);
  assertMinor(input.maxMinor);
  if (!isPositiveMinor(input.targetMinor)) throw new LimitsError('limits: target must be positive');
  if (!isPositiveMinor(input.maxMinor)) throw new LimitsError('limits: maximum must be positive');

  if (basis === PRICE_BASIS.TOTAL && quantity <= 0) {
    // The whole point of the explicit basis: refuse rather than pick a reading.
    throw new LimitsError('limits: a total-basis budget needs a quantity to be unambiguous');
  }

  const targetMinor =
    basis === PRICE_BASIS.TOTAL ? divideMinor(input.targetMinor, quantity) : input.targetMinor;
  const maxMinor =
    basis === PRICE_BASIS.TOTAL ? divideMinor(input.maxMinor, quantity) : input.maxMinor;

  if (maxMinor < targetMinor) {
    throw new LimitsError('limits: the maximum cannot be below the target');
  }

  return Object.freeze({
    product,
    quantity,
    unit: (input.unit ?? '').trim(),
    currency: (input.currency ?? 'INR').trim().toUpperCase(),
    targetMinor,
    maxMinor,
    basis,
  });
}

/**
 * The width of the buyer's negotiating band. Zero when target === maximum,
 * which is a legitimate state: the buyer named exactly one figure.
 *
 * @param {Limits} limits
 * @returns {number}
 */
export function bandWidth(limits) {
  return limits.maxMinor - limits.targetMinor;
}

/**
 * True when the buyer left no room to negotiate within their own limits.
 * @param {Limits} limits
 */
export function isSingleFigure(limits) {
  return bandWidth(limits) === 0;
}
