/**
 * The negotiation state machine.
 *
 * Small on purpose. Every state here is one the buyer would recognise, and the
 * terminal set is closed: once a negotiation reaches a terminal state no agent
 * action may follow it. That property is what stops a restarted worker, a
 * replayed webhook or a buggy caller from reopening a settled negotiation and
 * messaging a company that already said no.
 */

/** @enum {string} */
export const STATE = Object.freeze({
  /** Created, opening enquiry not yet sent. */
  DRAFT: 'DRAFT',
  /** We have spoken; it is the seller's turn. */
  AWAITING_REPLY: 'AWAITING_REPLY',
  /** A seller message has arrived and has not been acted on yet. */
  EVALUATING: 'EVALUATING',
  /** We have countered; it is the seller's turn again. */
  COUNTERED: 'COUNTERED',
  /** Terminal: the seller reached or beat the buyer's target. */
  TARGET_MET: 'TARGET_MET',
  /** Terminal: the round budget is spent. */
  ROUNDS_SPENT: 'ROUNDS_SPENT',
  /** Terminal: the seller declined. */
  DECLINED: 'DECLINED',
  /** Terminal for the agent: a human must look at this. */
  ESCALATED: 'ESCALATED',
});

export const STATES = Object.freeze(Object.values(STATE));

/** States in which the agent may take no further action. */
export const TERMINAL_STATES = Object.freeze([
  STATE.TARGET_MET,
  STATE.ROUNDS_SPENT,
  STATE.DECLINED,
  STATE.ESCALATED,
]);

const TERMINAL_SET = new Set(TERMINAL_STATES);

/** Legal transitions. Anything not listed here is a bug, not a surprise. */
export const TRANSITIONS = Object.freeze({
  [STATE.DRAFT]: [STATE.AWAITING_REPLY, STATE.ESCALATED, STATE.DECLINED],
  [STATE.AWAITING_REPLY]: [
    STATE.EVALUATING,
    STATE.TARGET_MET,
    STATE.ROUNDS_SPENT,
    STATE.DECLINED,
    STATE.ESCALATED,
  ],
  [STATE.EVALUATING]: [
    STATE.COUNTERED,
    STATE.AWAITING_REPLY,
    STATE.TARGET_MET,
    STATE.ROUNDS_SPENT,
    STATE.DECLINED,
    STATE.ESCALATED,
  ],
  [STATE.COUNTERED]: [
    STATE.EVALUATING,
    STATE.TARGET_MET,
    STATE.ROUNDS_SPENT,
    STATE.DECLINED,
    STATE.ESCALATED,
  ],
  [STATE.TARGET_MET]: [],
  [STATE.ROUNDS_SPENT]: [],
  [STATE.DECLINED]: [],
  [STATE.ESCALATED]: [],
});

export class TransitionError extends Error {
  constructor(from, to) {
    super(`illegal state transition: ${from} -> ${to}`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
  }
}

/** @param {string} state */
export function isState(state) {
  return STATES.includes(state);
}

/** @param {string} state */
export function isTerminal(state) {
  return TERMINAL_SET.has(state);
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransition(from, to) {
  if (!isState(from) || !isState(to)) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {string} the new state
 * @throws {TransitionError}
 */
export function transition(from, to) {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
  return to;
}
