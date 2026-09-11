/**
 * How rows leave the API.
 *
 * Money is presented three ways on purpose: the integer minor units a client
 * should compute with, a plain decimal string, and a formatted string for
 * display. Clients that do their own arithmetic get integers; clients that just
 * render get the string; nobody has to guess which one a bare number is.
 */

import { fromMinor, formatMoney } from '../domain/money.js';

export function money(minor, currency) {
  if (minor === null || minor === undefined) return null;
  return { minor, amount: fromMinor(minor), display: formatMoney(minor, currency) };
}

export function presentRequirement(requirement) {
  return {
    id: requirement.id,
    buyer_id: requirement.buyerId,
    product: requirement.product,
    quantity: requirement.quantity,
    unit: requirement.unit,
    currency: requirement.currency,
    price_basis: requirement.priceBasis,
    target_price: money(requirement.targetPriceMinor, requirement.currency),
    max_price: money(requirement.maxPriceMinor, requirement.currency),
    status: requirement.status,
    created_at: requirement.createdAt,
  };
}

export function presentNegotiation(negotiation, currency = 'INR') {
  return {
    id: negotiation.id,
    requirement_id: negotiation.requirementId,
    seller_id: negotiation.sellerId,
    state: negotiation.state,
    round: negotiation.round,
    max_rounds: negotiation.maxRounds,
    supplier_price: money(negotiation.currentSellerPriceMinor, currency),
    seller_declined: negotiation.sellerDeclined,
    outcome: negotiation.outcome,
    created_at: negotiation.createdAt,
  };
}

export function presentMessage(message, currency = 'INR') {
  return {
    id: message.id,
    negotiation_id: message.negotiationId,
    author: message.author,
    kind: message.kind,
    body: message.body,
    price: money(message.priceMinor, currency),
    in_reply_to: message.inReplyTo,
    generated_by: message.generatedBy,
    created_at: message.createdAt,
  };
}

export function presentRun(run, currency = 'INR') {
  return {
    id: run.id,
    action: run.action,
    reason: run.reason,
    state_before: run.stateBefore,
    state_after: run.stateAfter,
    counter_price: money(run.counterPriceMinor, currency),
    llm_provider: run.llmProvider,
    llm_model: run.llmModel,
    grounded: run.grounded,
    fell_back: run.fellBack,
    latency_ms: run.latencyMs,
    detail: run.detail,
    created_at: run.createdAt,
  };
}

export function presentRecommendation(recommendation, currency = 'INR') {
  if (!recommendation) return null;
  return {
    id: recommendation.id,
    requirement_id: recommendation.requirementId,
    negotiation_id: recommendation.negotiationId,
    decision: recommendation.decision,
    rationale: recommendation.rationale,
    price: money(recommendation.priceMinor, currency),
    summary: recommendation.summary,
    created_at: recommendation.createdAt,
    note: 'A recommendation only. Accepting is a buyer action.',
  };
}
