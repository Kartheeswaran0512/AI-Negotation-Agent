/**
 * What to counter with.
 *
 * THIS FILE IS WHY THE PROJECT EXISTS. The counter price is arithmetic over two
 * real numbers - the buyer's own stated target and the seller's own stated
 * price - and nothing else. There is no notion of a "market rate", a "typical
 * discount" or an inferred cost base, because none of those are facts this
 * system holds, and a number the system does not hold is a number it must not
 * state.
 *
 * The language model is never consulted here and cannot be: this module has no
 * dependencies beyond money and limits.
 */

import { assertMinor, isPositiveMinor } from './money.js';
import { bandWidth } from './limits.js';

/**
 * How much of the remaining gap to close in one round. 0.5 halves the distance
 * between the seller's price and the buyer's target each time, so successive
 * asks converge instead of repeating one number the seller already refused.
 */
export const STEP = 0.5;

/**
 * How far into the buyer's own band the agent may go. 0.5 means the highest
 * figure the agent will ever put in front of a seller is the midpoint between
 * target and maximum - never the maximum itself.
 */
export const CEILING_MARGIN = 0.5;

/**
 * The highest figure the agent may ever name.
 *
 * NOT the buyer's maximum. If the cap were the maximum, then a seller far above
 * budget would be countered with exactly the buyer's ceiling, and the buyer's
 * private safety boundary would arrive in the seller's inbox as a number they
 * could simply accept. A ceiling the other side can see is not a safety
 * boundary, it is an opening price - and the buyer never offered it.
 *
 * When target === maximum the buyer named a single figure; that figure is the
 * ceiling, and stating it discloses nothing the target did not already.
 *
 * @param {import('./limits.js').Limits} limits
 * @returns {number} minor units
 */
export function askCeiling(limits) {
  const band = bandWidth(limits);
  if (band <= 0) return limits.targetMinor;
  return limits.targetMinor + Math.floor(band * CEILING_MARGIN);
}

/**
 * The next counter-offer, or null when there is nothing to counter.
 *
 * Guarantees, all of them tested:
 *   - never below the buyer's target (asking for less than the buyer already
 *     said they would pay is a self-inflicted loss);
 *   - never above `askCeiling`, and therefore never at or above the maximum
 *     whenever the buyer left any band at all;
 *   - non-increasing as the seller's price falls.
 *
 * @param {number|null|undefined} sellerPriceMinor per-unit, minor units
 * @param {import('./limits.js').Limits} limits
 * @returns {number|null}
 */
export function nextCounter(sellerPriceMinor, limits) {
  if (!isPositiveMinor(sellerPriceMinor)) return null;
  assertMinor(sellerPriceMinor);

  // Already at or under the target: there is nothing left to ask for, and any
  // counter here would be the agent inventing a position of its own.
  if (sellerPriceMinor <= limits.targetMinor) return null;

  const gap = sellerPriceMinor - limits.targetMinor;
  // Math.ceil, so the halved gap can never round down through the target.
  const halved = limits.targetMinor + Math.ceil(gap * (1 - STEP));
  const capped = Math.min(halved, askCeiling(limits));
  return Math.max(limits.targetMinor, capped);
}

/**
 * The opening position, used when no seller price exists yet and the agent has
 * been asked directly what the buyer expects to pay. It is the buyer's own
 * target - the only figure the buyer has authorised for that answer.
 *
 * @param {import('./limits.js').Limits} limits
 * @returns {number}
 */
export function openingAsk(limits) {
  return limits.targetMinor;
}

/**
 * Is this figure one the agent is permitted to put on the wire?
 * Used as a belt-and-braces check at the send boundary.
 *
 * @param {number} priceMinor
 * @param {import('./limits.js').Limits} limits
 * @returns {boolean}
 */
export function isSafeToState(priceMinor, limits) {
  if (!isPositiveMinor(priceMinor)) return false;
  return priceMinor >= limits.targetMinor && priceMinor <= askCeiling(limits);
}
