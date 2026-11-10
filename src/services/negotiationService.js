/**
 * The orchestrator: load state, decide, guard, act, record.
 *
 * This is the only file that gets to combine the pure core with a database and
 * a language model, and the order it does it in is the whole safety story:
 *
 *   interpret (verified)  ->  decide (pure)  ->  guard  ->  claim  ->  send
 *
 * The claim is a row in `outbox` with a UNIQUE key. Nothing is sent before that
 * insert succeeds, so two workers ticking the same negotiation at the same
 * instant produce one message, not two - the duplicate is refused by the
 * database rather than by a lock somebody remembered to take.
 *
 * EVERY tick writes an `agent_runs` row, including the ones that do nothing.
 * A decision that left no trace is a decision nobody can explain later.
 */

import { decide, ACTION, OUTCOME, REASON } from '../domain/decide.js';
import { maySend, idempotencyKey, REFUSAL } from '../domain/guard.js';
import { STATE, isTerminal, canTransition } from '../domain/machine.js';
import { allowedNumbers, checkGrounding } from '../domain/grounding.js';
import { asksOurBudget } from '../domain/disclosure.js';
import { verdictFor } from '../domain/verdict.js';
import { formatMoney } from '../domain/money.js';
import {
  openingMessage,
  counterMessage,
  budgetAnswerMessage,
  outcomeExplanation,
} from '../domain/templates.js';
import { limitsFor } from './recommendService.js';

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.status = 404;
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConflictError';
    this.status = 409;
  }
}

/**
 * Refusals that will resolve on their own. The inbound message is NOT marked as
 * dealt with for these, so the next tick picks it up again.
 */
const TEMPORARY_REFUSALS = new Set([REFUSAL.DRY_RUN, REFUSAL.SEND_LIMIT, REFUSAL.AGENT_DISABLED]);

/** State to move to after sending each kind of message. */
const STATE_AFTER_SEND = Object.freeze({
  [ACTION.OPEN]: STATE.AWAITING_REPLY,
  [ACTION.COUNTER]: STATE.COUNTERED,
});

const OUTCOME_STATE = Object.freeze({
  [OUTCOME.TARGET_MET]: STATE.TARGET_MET,
  [OUTCOME.ROUNDS_SPENT]: STATE.ROUNDS_SPENT,
  [OUTCOME.DECLINED]: STATE.DECLINED,
});

/**
 * @param {object} deps
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.interpreter
 * @param {object} deps.config
 * @param {object} [deps.recommendService]
 * @param {object} [deps.logger]
 * @param {() => Date} [deps.clock]
 */
export function createNegotiationService({
  repositories,
  interpreter,
  config,
  recommendService = null,
  logger = null,
  clock = () => new Date(),
}) {
  /**
   * Create a negotiation with one seller. Sends nothing - the opening message
   * is the agent's first action, so it goes through exactly the same decide ->
   * guard -> claim path as every other message.
   */
  async function open({ requirementId, sellerId, maxRounds }) {
    const requirement = await repositories.requirements.findById(requirementId);
    if (!requirement) throw new NotFoundError('requirement not found');

    const seller = await repositories.users.findById(sellerId);
    if (!seller) throw new NotFoundError('seller not found');
    if (seller.role !== 'seller') throw new ConflictError('that user is not a seller');

    return repositories.negotiations.create({
      requirementId,
      sellerId,
      state: STATE.DRAFT,
      maxRounds: maxRounds ?? config.agent.maxRounds,
    });
  }

  /**
   * Record an inbound supplier message. This is the seller's side of the wire;
   * in a fuller system it would be fed by email, a portal or a webhook.
   */
  async function recordSellerMessage({ negotiationId, body, priceMinor = null, quantity = null }) {
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation) throw new NotFoundError('negotiation not found');
    if (isTerminal(negotiation.state)) {
      throw new ConflictError(`this negotiation is ${negotiation.state} and accepts no new messages`);
    }

    const message = await repositories.messages.append({
      negotiationId,
      author: 'seller',
      kind: priceMinor === null ? 'text' : 'offer',
      body,
      priceMinor,
      quantity,
    });

    const nextState = canTransition(negotiation.state, STATE.EVALUATING)
      ? STATE.EVALUATING
      : negotiation.state;

    await repositories.negotiations.update(
      negotiationId,
      { lastInboundMessageId: message.id, state: nextState },
      negotiation.version,
    );

    return message;
  }

  /**
   * One agent step. Safe to call repeatedly: everything that could send is
   * behind the guard and the idempotency claim.
   */
  async function tick({ negotiationId, triggerSource = 'worker', correlationId = null }) {
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation) throw new NotFoundError('negotiation not found');

    const requirement = await repositories.requirements.findById(negotiation.requirementId);
    if (!requirement) throw new NotFoundError('requirement not found');

    const limits = limitsFor(requirement);
    const stateBefore = negotiation.state;

    // ---- 1. Interpret the newest unanswered supplier message ---------------
    const inbound = await repositories.messages.lastInbound(negotiationId);
    const unanswered =
      inbound && String(inbound.id) !== String(negotiation.answeredMessageId) ? inbound : null;

    let interpretation = null;
    let sellerPriceMinor = negotiation.currentSellerPriceMinor;
    let sellerDeclined = negotiation.sellerDeclined;
    let sellerAskedOurBudget = false;
    let requiresHuman = false;

    if (unanswered) {
      interpretation = await interpreter.readSeller({ text: unanswered.body });

      // The disclosure decision is made here, by a pure predicate over the
      // supplier's words - never by the model, whose "they asked" can be
      // prompted into existence.
      sellerAskedOurBudget = asksOurBudget(unanswered.body);
      if (interpretation.injection) requiresHuman = interpretation.injection;

      // A price supplied through the structured API is already trusted; a price
      // read out of prose is only trusted after `verify.js` found it in the text.
      const readPrice = unanswered.priceMinor ?? interpretation.reading?.unitPriceMinor ?? null;
      if (readPrice !== null && readPrice > 0) {
        sellerPriceMinor = readPrice;
        await repositories.offers.record({
          negotiationId,
          actor: 'seller',
          unitPriceMinor: readPrice,
          quantity: interpretation.reading?.quantity ?? unanswered.quantity ?? null,
          currency: limits.currency,
          sourceMessageId: unanswered.id,
        });
      }

      if (interpretation.reading?.intent === 'decline') sellerDeclined = true;
    }

    // ---- 2. Decide (pure) --------------------------------------------------
    const decisionState = {
      negotiationId,
      status: negotiation.state,
      round: negotiation.round,
      maxRounds: negotiation.maxRounds,
      opened: negotiation.state !== STATE.DRAFT,
      sellerPriceMinor,
      sellerDeclined,
      lastInboundMessageId: unanswered ? unanswered.id : null,
      answeredMessageId: negotiation.answeredMessageId,
    };

    let action = decide(decisionState, limits, { sellerAskedOurBudget, requiresHuman });

    // ---- 3. Guard ----------------------------------------------------------
    let refusal = null;
    if (action.kind === ACTION.OPEN || action.kind === ACTION.COUNTER) {
      const verdict = maySend({
        status: negotiation.state,
        round: negotiation.round,
        maxRounds: negotiation.maxRounds,
        inReplyToMessageId: action.inReplyToMessageId ?? null,
        answeredMessageId: negotiation.answeredMessageId,
        enabled: config.agent.enabled,
        dryRun: config.agent.dryRun,
        sentToday: await countSentToday(),
        dailyLimit: config.agent.dailySendLimit,
      });

      if (!verdict.allowed) {
        refusal = verdict.reason;
        action = { kind: ACTION.HOLD, negotiationId, reason: verdict.reason };
      }
    }

    // ---- 4. Act ------------------------------------------------------------
    const outcome = await perform({
      action,
      negotiation,
      requirement,
      limits,
      unanswered,
      sellerPriceMinor,
      sellerDeclined,
      interpretation,
      refusal,
    });

    // ---- 5. Record, always -------------------------------------------------
    const run = await repositories.agentRuns.record({
      negotiationId,
      triggerSource,
      action: action.kind,
      reason: action.reason ?? 'none',
      stateBefore,
      stateAfter: outcome.state,
      counterPriceMinor: action.priceMinor ?? null,
      llmProvider: interpreter.provider,
      llmModel: interpreter.model,
      inputTokens: interpretation?.usage?.inputTokens ?? null,
      outputTokens: interpretation?.usage?.outputTokens ?? null,
      latencyMs: interpretation?.usage?.latencyMs ?? null,
      grounded: outcome.grounded ?? null,
      fellBack: Boolean(interpretation?.fellBack || outcome.generatedBy === 'template'),
      correlationId,
      detail: {
        verdict: verdictFor(sellerPriceMinor, limits),
        sellerPriceMinor,
        sellerAskedOurBudget,
        droppedByVerification: interpretation?.dropped ?? [],
        injection: interpretation?.injection || null,
        readingSource: interpretation?.source ?? null,
        refusal,
      },
    });

    logger?.info?.('agent tick', {
      negotiationId,
      action: action.kind,
      reason: action.reason,
      stateBefore,
      stateAfter: outcome.state,
    });

    return {
      action,
      state: outcome.state,
      message: outcome.message ?? null,
      generatedBy: outcome.generatedBy ?? null,
      recommendation: outcome.recommendation ?? null,
      run,
    };
  }

  /** Execute whatever `decide` returned. */
  async function perform({
    action,
    negotiation,
    requirement,
    limits,
    unanswered,
    sellerPriceMinor,
    sellerDeclined,
    interpretation,
    refusal,
  }) {
    const negotiationId = negotiation.id;

    if (action.kind === ACTION.HOLD) {
      // Mark the inbound message as dealt with unless the refusal is one that
      // will clear by itself, so a permanent hold does not re-read the same
      // message - and a temporary one does.
      const patch = {};
      if (unanswered && !TEMPORARY_REFUSALS.has(refusal)) {
        patch.answeredMessageId = unanswered.id;
      }
      if (sellerPriceMinor !== negotiation.currentSellerPriceMinor) {
        patch.currentSellerPriceMinor = sellerPriceMinor;
      }
      if (Object.keys(patch).length > 0) {
        await repositories.negotiations.update(negotiationId, patch, negotiation.version);
      }
      return { state: negotiation.state };
    }

    if (action.kind === ACTION.ESCALATE) {
      await repositories.negotiations.update(
        negotiationId,
        {
          state: STATE.ESCALATED,
          outcome: 'escalated',
          closedAt: clock(),
          answeredMessageId: unanswered ? unanswered.id : negotiation.answeredMessageId,
          currentSellerPriceMinor: sellerPriceMinor,
        },
        negotiation.version,
      );
      return { state: STATE.ESCALATED };
    }

    if (action.kind === ACTION.END) {
      const nextState = OUTCOME_STATE[action.outcome] ?? STATE.ESCALATED;
      await repositories.negotiations.update(
        negotiationId,
        {
          state: nextState,
          outcome: action.outcome,
          closedAt: clock(),
          sellerDeclined,
          currentSellerPriceMinor: sellerPriceMinor,
          answeredMessageId: unanswered ? unanswered.id : negotiation.answeredMessageId,
        },
        negotiation.version,
      );

      const recommendation = recommendService
        ? await recommendService.refresh(requirement.id)
        : null;

      return { state: nextState, recommendation };
    }

    // ---- a send -----------------------------------------------------------
    const key = idempotencyKey({
      negotiationId,
      inReplyToMessageId: action.inReplyToMessageId ?? null,
    });

    const claim = await repositories.outbox.claim({
      negotiationId,
      idempotencyKey: key,
      payload: {
        kind: action.kind,
        reason: action.reason,
        priceMinor: action.priceMinor ?? null,
        inReplyTo: action.inReplyToMessageId ?? null,
      },
    });

    // Somebody already answered this exact message. Not an error - the whole
    // point of the key is that the loser of the race stays silent.
    if (!claim.claimed) {
      return { state: negotiation.state };
    }

    const template = templateFor({ action, limits });
    const allowed = allowedNumbers({
      limits,
      counterMinor: action.kind === ACTION.COUNTER ? action.priceMinor : null,
      discloseTarget: Boolean(action.discloseTarget),
    });

    let body = template;
    let generatedBy = 'template';
    let grounded = null;

    try {
      const phrased = await interpreter.phrase({
        facts: factsFor({ action, limits }),
        allowed,
        template,
        lastSupplierMessage: unanswered?.body ?? null,
      });
      body = phrased.text;
      generatedBy = phrased.generatedBy;
      grounded = phrased.grounded;
    } catch (error) {
      logger?.warn?.('phrasing failed; using template', { error: error?.message });
    }

    // Belt and braces. The template is grounded by construction and a generated
    // message was already checked, so this can only fire if something upstream
    // changed - in which case the deterministic text is used and the run is
    // recorded as ungrounded.
    const finalCheck = checkGrounding(body, allowed);
    if (!finalCheck.ok) {
      body = template;
      generatedBy = 'template';
      grounded = false;
    }

    let message;
    try {
      message = await repositories.messages.append({
        negotiationId,
        author: 'agent',
        kind: action.kind === ACTION.COUNTER ? 'offer' : 'text',
        body,
        priceMinor: action.kind === ACTION.COUNTER ? action.priceMinor : null,
        quantity: limits.quantity || null,
        inReplyTo: action.inReplyToMessageId ?? null,
        generatedBy,
      });
    } catch (error) {
      await repositories.outbox.markFailed(claim.entry.id, error?.message ?? 'append failed');
      throw error;
    }

    await repositories.outbox.markSent(claim.entry.id, message.id);

    const nextState = STATE_AFTER_SEND[action.kind] ?? negotiation.state;
    await repositories.negotiations.update(
      negotiationId,
      {
        state: canTransition(negotiation.state, nextState) ? nextState : negotiation.state,
        round: negotiation.round + 1,
        answeredMessageId: unanswered ? unanswered.id : negotiation.answeredMessageId,
        currentSellerPriceMinor: sellerPriceMinor,
        openedAt: negotiation.openedAt ?? clock(),
      },
      negotiation.version,
    );

    return { state: nextState, message, generatedBy, grounded };
  }

  /**
   * The buyer accepts an offer.
   *
   * Deliberately NOT reachable from the agent: it takes a buyer id, checks it
   * against the requirement's owner, and is exposed only on a buyer-authenticated
   * route. There is no tool for it and no action that can reach it.
   */
  async function accept({ negotiationId, buyerId }) {
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation) throw new NotFoundError('negotiation not found');

    const requirement = await repositories.requirements.findById(negotiation.requirementId);
    if (!requirement) throw new NotFoundError('requirement not found');
    if (String(requirement.buyerId) !== String(buyerId)) {
      throw new ConflictError('only the buyer who owns this requirement can accept');
    }
    if (negotiation.outcome === 'accepted_by_buyer') {
      throw new ConflictError('this offer has already been accepted');
    }
    // One requirement, one deal. Accepting is what closes a requirement, so a
    // closed one already has an accepted offer from another supplier.
    if (requirement.status === 'closed') {
      throw new ConflictError('another offer on this requirement has already been accepted');
    }
    if (negotiation.currentSellerPriceMinor === null) {
      throw new ConflictError('there is no supplier price to accept');
    }

    const limits = limitsFor(requirement);
    const price = negotiation.currentSellerPriceMinor;

    const message = await repositories.messages.append({
      negotiationId,
      author: 'buyer',
      kind: 'accept',
      body: `Accepted at ${formatMoney(price, limits.currency)} per unit.`,
      priceMinor: price,
    });

    await repositories.offers.record({
      negotiationId,
      actor: 'buyer',
      unitPriceMinor: price,
      quantity: limits.quantity || null,
      currency: limits.currency,
      sourceMessageId: message.id,
    });

    await repositories.negotiations.update(
      negotiationId,
      { state: STATE.TARGET_MET, outcome: 'accepted_by_buyer', closedAt: clock() },
      negotiation.version,
    );
    await repositories.requirements.setStatus(requirement.id, 'closed');

    return { message, priceMinor: price };
  }

  /** @param {number|string} negotiationId */
  async function thread(negotiationId) {
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation) throw new NotFoundError('negotiation not found');
    const messages = await repositories.messages.listByNegotiation(negotiationId);
    return { negotiation, messages };
  }

  async function countSentToday() {
    const since = new Date(clock().getTime() - 24 * 60 * 60 * 1000);
    return repositories.messages.countAgentSince(since);
  }

  return { open, recordSellerMessage, tick, accept, thread };
}

function templateFor({ action, limits }) {
  if (action.kind === ACTION.OPEN) {
    return openingMessage({ limits, discloseTarget: Boolean(action.discloseTarget) });
  }
  if (action.reason === REASON.ANSWERING_BUDGET_QUESTION) {
    return budgetAnswerMessage({ limits, counterMinor: action.priceMinor });
  }
  return counterMessage({
    limits,
    counterMinor: action.priceMinor,
    discloseTarget: Boolean(action.discloseTarget),
  });
}

function factsFor({ action, limits }) {
  const facts = {
    product: limits.product,
    quantity: limits.quantity || 'not stated',
    unit: limits.unit || 'unit',
    message_purpose:
      action.kind === ACTION.OPEN
        ? 'open an enquiry and ask for their best price'
        : 'put a counter-offer to the supplier',
  };

  if (action.kind === ACTION.COUNTER) {
    facts.our_offer = formatMoney(action.priceMinor, limits.currency);
    facts.may_state_our_target = Boolean(action.discloseTarget);
    if (action.discloseTarget) {
      facts.our_target = formatMoney(limits.targetMinor, limits.currency);
    }
  }
  return facts;
}

/** Re-exported so callers do not have to reach into the domain for it. */
export { outcomeExplanation };
