/**
 * decide(state, limits, context) -> action
 *
 * The whole agent, as one pure function. It performs no I/O, reads no clock,
 * touches no environment variable and cannot call a model, so what it returns
 * is a function of its arguments alone - which is what makes the behaviour of
 * this system something you can assert in a unit test rather than something you
 * observe in production.
 *
 * WHAT IT CANNOT EXPRESS. There is no 'accept' action. The union below is the
 * complete set of things the agent may do, and closing a deal is not in it, so
 * "the AI never commits the buyer" is a property of the type rather than a rule
 * somebody has to remember. Acceptance is a separate, human-only path.
 *
 * EVERY BRANCH CARRIES A REASON. The reason is what the buyer sees, what the
 * audit table stores, and what the tests assert on. A decision without a reason
 * is a decision nobody can explain three weeks later.
 */

import { verdictFor, meetsTarget, VERDICT } from './verdict.js';
import { nextCounter, openingAsk } from './pricing.js';
import { isTerminal } from './machine.js';

/** @enum {string} */
export const ACTION = Object.freeze({
  HOLD: 'hold',
  OPEN: 'open',
  COUNTER: 'counter',
  END: 'end',
  ESCALATE: 'escalate',
});

/**
 * The complete set of action kinds. Asserted in a test: if anybody ever adds
 * an acceptance action here, that test fails loudly.
 */
export const ACTION_KINDS = Object.freeze(Object.values(ACTION));

/** @enum {string} */
export const OUTCOME = Object.freeze({
  TARGET_MET: 'target_met',
  ROUNDS_SPENT: 'rounds_spent',
  DECLINED: 'declined',
});

/** @enum {string} */
export const REASON = Object.freeze({
  TERMINAL: 'terminal',
  NEEDS_HUMAN: 'needs_human',
  SELLER_DECLINED: 'seller_declined',
  OPENING: 'opening',
  TARGET_MET: 'target_met',
  ALREADY_ANSWERED: 'already_answered',
  AWAITING_REPLY: 'awaiting_reply',
  AWAITING_PRICE: 'awaiting_price',
  ROUNDS_SPENT: 'rounds_spent',
  ANSWERING_BUDGET_QUESTION: 'answering_budget_question',
  IMPROVE_PRICE: 'improve_price',
});

/**
 * @typedef {object} NegotiationState
 * @property {number|string} negotiationId
 * @property {string}  status                 a machine.STATE
 * @property {number}  round                  agent messages sent so far
 * @property {number}  maxRounds
 * @property {boolean} opened                 has the opening enquiry gone out
 * @property {number|null} sellerPriceMinor   latest VERIFIED seller price
 * @property {boolean} [sellerDeclined]
 * @property {number|string|null} lastInboundMessageId
 * @property {number|string|null} answeredMessageId
 */

/**
 * @typedef {object} DecisionContext
 * @property {boolean} [sellerAskedOurBudget] decided by disclosure.asksOurBudget
 * @property {string|false} [requiresHuman]   a reason string, or false
 */

/**
 * @param {NegotiationState} state
 * @param {import('./limits.js').Limits} limits
 * @param {DecisionContext} [context]
 * @returns {object} an action
 */
export function decide(state, limits, context = {}) {
  const { sellerAskedOurBudget = false, requiresHuman = false } = context;

  // 1. Terminal states are closed. Nothing below this line may reopen one.
  if (isTerminal(state.status)) {
    return hold(state, REASON.TERMINAL);
  }

  // 2. A human has to look at this. Checked before anything that could send,
  //    because the point of escalating is to stop the agent talking.
  if (requiresHuman) {
    return {
      kind: ACTION.ESCALATE,
      negotiationId: state.negotiationId,
      reason: typeof requiresHuman === 'string' ? requiresHuman : REASON.NEEDS_HUMAN,
    };
  }

  // 3. A decline is the one outcome that calls for finding another supplier,
  //    so it is named rather than folded into a generic close.
  if (state.sellerDeclined) {
    return end(state, OUTCOME.DECLINED, REASON.SELLER_DECLINED);
  }

  // 4. Nothing has been said yet.
  if (!state.opened) {
    return {
      kind: ACTION.OPEN,
      negotiationId: state.negotiationId,
      discloseTarget: false,
      reason: REASON.OPENING,
    };
  }

  const verdict = verdictFor(state.sellerPriceMinor, limits);

  // 5. The negotiation has succeeded. Checked before the guard conditions
  //    below, because a met target ends the negotiation whether or not we have
  //    already replied to the message that carried it.
  if (meetsTarget(verdict)) {
    return end(state, OUTCOME.TARGET_MET, REASON.TARGET_MET);
  }

  // 6. Nothing new has been said since our last message.
  if (alreadyAnswered(state)) {
    return hold(state, REASON.ALREADY_ANSWERED);
  }

  // 7. Chasing a seller who has not had a chance to reply is noise.
  if (state.lastInboundMessageId === null || state.lastInboundMessageId === undefined) {
    return hold(state, REASON.AWAITING_REPLY);
  }

  // 8. The round budget is spent. The buyer's recommendation is computed
  //    separately from whatever the best standing offer turns out to be.
  if (state.round >= state.maxRounds) {
    return end(state, OUTCOME.ROUNDS_SPENT, REASON.ROUNDS_SPENT);
  }

  // 9. They replied without a price. Normally there is nothing to negotiate
  //    against - countering here would mean inventing the thing being
  //    countered. UNLESS they asked what we expect to pay, which is a fair
  //    question and deserves the one figure the buyer authorised.
  if (verdict === VERDICT.AWAITING) {
    if (!sellerAskedOurBudget) {
      return hold(state, REASON.AWAITING_PRICE);
    }
    return {
      kind: ACTION.COUNTER,
      negotiationId: state.negotiationId,
      priceMinor: openingAsk(limits),
      discloseTarget: true,
      inReplyToMessageId: state.lastInboundMessageId,
      reason: REASON.ANSWERING_BUDGET_QUESTION,
    };
  }

  // 10. A real price, above the target. Counter with arithmetic.
  const priceMinor = nextCounter(state.sellerPriceMinor, limits);
  if (priceMinor === null) {
    // Unreachable while `meetsTarget` is checked above; kept as a guard so a
    // future change to the verdict rules degrades to silence, not to a send.
    return hold(state, REASON.AWAITING_PRICE);
  }

  return {
    kind: ACTION.COUNTER,
    negotiationId: state.negotiationId,
    priceMinor,
    discloseTarget: sellerAskedOurBudget,
    inReplyToMessageId: state.lastInboundMessageId,
    reason: REASON.IMPROVE_PRICE,
  };
}

function alreadyAnswered(state) {
  return (
    state.lastInboundMessageId !== null &&
    state.lastInboundMessageId !== undefined &&
    state.answeredMessageId !== null &&
    state.answeredMessageId !== undefined &&
    String(state.lastInboundMessageId) === String(state.answeredMessageId)
  );
}

function hold(state, reason) {
  return { kind: ACTION.HOLD, negotiationId: state.negotiationId, reason };
}

function end(state, outcome, reason) {
  return { kind: ACTION.END, negotiationId: state.negotiationId, outcome, reason };
}
