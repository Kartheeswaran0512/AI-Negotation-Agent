/**
 * What should the buyer do?
 *
 * The agent may RECOMMEND. It may not accept, and there is no code path in this
 * project by which it could: acceptance is an HTTP route that requires the
 * buyer's own identity, and this function returns a suggestion with the
 * reasoning attached.
 *
 * Every figure in the result traces to an offer row. Nothing is estimated.
 */

import { verdictFor, meetsTarget, withinBudget } from './verdict.js';
import { isTerminal } from './machine.js';
import { isPositiveMinor } from './money.js';

/** @enum {string} */
export const DECISION = Object.freeze({
  ACCEPT: 'accept',
  REJECT: 'reject',
  CONTINUE: 'continue',
});

/** @enum {string} */
export const RATIONALE = Object.freeze({
  TARGET_MET: 'target_met',
  BEST_WITHIN_BUDGET_AND_FINISHED: 'best_within_budget_and_finished',
  NOTHING_WITHIN_BUDGET: 'nothing_within_budget',
  NO_OFFERS_AT_ALL: 'no_offers_at_all',
  STILL_NEGOTIATING: 'still_negotiating',
});

/**
 * @typedef {object} OfferSummary
 * @property {number|string} negotiationId
 * @property {number|string} sellerId
 * @property {number|null}   priceMinor  per-unit, minor units
 * @property {string}        status      a machine.STATE
 */

/**
 * @param {object} params
 * @param {OfferSummary[]} params.offers   one entry per negotiation
 * @param {import('./limits.js').Limits} params.limits
 * @returns {{decision: string, rationale: string, negotiationId: (number|string|null), sellerId: (number|string|null), priceMinor: (number|null), consideredCount: number, finished: boolean}}
 */
export function recommendFor({ offers, limits }) {
  const priced = (offers ?? []).filter((offer) => isPositiveMinor(offer.priceMinor));
  const finished = (offers ?? []).length > 0 && offers.every((offer) => isTerminal(offer.status));

  const affordable = priced
    .filter((offer) => withinBudget(verdictFor(offer.priceMinor, limits)))
    .sort((a, b) => a.priceMinor - b.priceMinor);

  const best = affordable[0] ?? null;

  if (best && meetsTarget(verdictFor(best.priceMinor, limits))) {
    return result(DECISION.ACCEPT, RATIONALE.TARGET_MET, best, priced.length, finished);
  }

  if (finished) {
    if (best) {
      return result(
        DECISION.ACCEPT,
        RATIONALE.BEST_WITHIN_BUDGET_AND_FINISHED,
        best,
        priced.length,
        finished,
      );
    }
    return result(
      DECISION.REJECT,
      priced.length === 0 ? RATIONALE.NO_OFFERS_AT_ALL : RATIONALE.NOTHING_WITHIN_BUDGET,
      null,
      priced.length,
      finished,
    );
  }

  return result(DECISION.CONTINUE, RATIONALE.STILL_NEGOTIATING, best, priced.length, finished);
}

function result(decision, rationale, offer, consideredCount, finished) {
  return {
    decision,
    rationale,
    negotiationId: offer ? offer.negotiationId : null,
    sellerId: offer ? offer.sellerId : null,
    priceMinor: offer ? offer.priceMinor : null,
    consideredCount,
    finished,
  };
}
