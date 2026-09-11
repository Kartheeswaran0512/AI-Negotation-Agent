/**
 * Where one seller's latest real price stands against the buyer's limits.
 *
 * A verdict is a fact about two numbers. It is computed, never interpreted -
 * so it can be asserted in a test and shown to the buyer without a caveat.
 */

import { isPositiveMinor } from './money.js';

/** @enum {string} */
export const VERDICT = Object.freeze({
  /** No real price from this seller yet. */
  AWAITING: 'awaiting',
  /** Better than the buyer asked for. */
  BELOW_TARGET: 'below_target',
  /** Exactly the target. */
  AT_TARGET: 'at_target',
  /** Above the target but at or under the ceiling - acceptable, not ideal. */
  WITHIN_BUDGET: 'within_budget',
  /** Above the buyer's ceiling. Never acceptable. */
  OVER_BUDGET: 'over_budget',
  /** The seller said no. */
  DECLINED: 'declined',
});

/**
 * @param {number|null|undefined} priceMinor per-unit price, minor units
 * @param {import('./limits.js').Limits} limits
 * @returns {string} a VERDICT
 */
export function verdictFor(priceMinor, limits) {
  if (priceMinor === null || priceMinor === undefined) return VERDICT.AWAITING;
  if (!isPositiveMinor(priceMinor)) return VERDICT.AWAITING; // 0 or negative is not a price
  if (priceMinor < limits.targetMinor) return VERDICT.BELOW_TARGET;
  if (priceMinor === limits.targetMinor) return VERDICT.AT_TARGET;
  if (priceMinor <= limits.maxMinor) return VERDICT.WITHIN_BUDGET;
  return VERDICT.OVER_BUDGET;
}

/** The negotiation has achieved what the buyer asked for. */
export function meetsTarget(verdict) {
  return verdict === VERDICT.AT_TARGET || verdict === VERDICT.BELOW_TARGET;
}

/** The price is one the buyer could accept, even if it is not the target. */
export function withinBudget(verdict) {
  return meetsTarget(verdict) || verdict === VERDICT.WITHIN_BUDGET;
}

/** There is a real number to negotiate against. */
export function hasRealPrice(verdict) {
  return verdict !== VERDICT.AWAITING && verdict !== VERDICT.DECLINED;
}
