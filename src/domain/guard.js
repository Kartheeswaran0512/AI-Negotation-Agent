/**
 * The send guard: may this message be put on the wire at all?
 *
 * Separate from `decide` on purpose. `decide` answers "what would a good move
 * be?"; this answers "is sending anything permitted right now?". They fail for
 * different reasons and must be able to disagree - an agent that re-asks on
 * every tick is the same class of bug as a runaway retry loop, except it writes
 * to someone's inbox under the buyer's name.
 *
 * IDENTITY, NOT CONTENT. "Have I already answered this?" is derived from the id
 * of the seller message being answered - one seller utterance has exactly one
 * id, so answering it twice is a state this module simply refuses. Deriving it
 * from the price instead would re-send whenever an unrelated field changed and
 * stay silent when the seller repeated a price, which is backwards on both
 * counts. The key returned here is also stored under a UNIQUE index, so the
 * refusal survives two workers racing.
 */

import { isTerminal } from './machine.js';

/** @enum {string} */
export const REFUSAL = Object.freeze({
  AGENT_DISABLED: 'agent_disabled',
  TERMINAL: 'terminal',
  ROUNDS_SPENT: 'rounds_spent',
  ALREADY_ANSWERED: 'already_answered',
  SEND_LIMIT: 'send_limit',
  DRY_RUN: 'dry_run',
});

/** The opener has no inbound message to answer, so it gets a reserved suffix. */
export const OPENING_SUFFIX = 'open';

/**
 * The database-level idempotency key. Stored UNIQUE in `outbox`, so a duplicate
 * send is impossible even if two workers decide identically at the same moment.
 *
 * @param {object} params
 * @param {number|string} params.negotiationId
 * @param {number|string|null} [params.inReplyToMessageId]
 * @returns {string}
 */
export function idempotencyKey({ negotiationId, inReplyToMessageId = null }) {
  const suffix = inReplyToMessageId === null || inReplyToMessageId === undefined
    ? OPENING_SUFFIX
    : String(inReplyToMessageId);
  return `neg:${negotiationId}:reply:${suffix}`;
}

/**
 * @typedef {object} GuardInput
 * @property {string}  status                 current negotiation state
 * @property {number}  round                  agent messages already sent
 * @property {number}  maxRounds
 * @property {number|null} inReplyToMessageId the seller message being answered
 * @property {number|null} answeredMessageId  the last one we answered
 * @property {boolean} [enabled]              global agent switch
 * @property {boolean} [dryRun]               decide and record, send nothing
 * @property {number}  [sentToday]
 * @property {number}  [dailyLimit]
 */

/**
 * @param {GuardInput} input
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function maySend(input) {
  const {
    status,
    round,
    maxRounds,
    inReplyToMessageId = null,
    answeredMessageId = null,
    enabled = true,
    dryRun = false,
    sentToday = 0,
    dailyLimit = Infinity,
  } = input;

  if (!enabled) return refuse(REFUSAL.AGENT_DISABLED);
  if (isTerminal(status)) return refuse(REFUSAL.TERMINAL);
  if (round >= maxRounds) return refuse(REFUSAL.ROUNDS_SPENT);

  // Only meaningful once there is something to answer: the opener answers
  // nothing, and two openers are prevented by the reserved key instead.
  if (
    inReplyToMessageId !== null &&
    answeredMessageId !== null &&
    String(inReplyToMessageId) === String(answeredMessageId)
  ) {
    return refuse(REFUSAL.ALREADY_ANSWERED);
  }

  if (sentToday >= dailyLimit) return refuse(REFUSAL.SEND_LIMIT);
  if (dryRun) return refuse(REFUSAL.DRY_RUN);

  return { allowed: true, reason: null };
}

function refuse(reason) {
  return { allowed: false, reason };
}
