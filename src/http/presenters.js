/**
 * How rows leave the API.
 *
 * Money is presented three ways on purpose: the integer minor units a client
 * should compute with, a plain decimal string, and a formatted string for
 * display. Clients that do their own arithmetic get integers; clients that just
 * render get the string; nobody has to guess which one a bare number is.
 */

import { fromMinor, formatMoney } from '../domain/money.js';
import { explainRun } from '../domain/explain.js';

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

/**
 * `amount` is what PayPal charges; `deal_amount` is the agreed total in the
 * requirement's own currency. The approval link is only offered while there is
 * still something to approve.
 */
export function presentPayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    negotiation_id: payment.negotiationId,
    provider: payment.provider,
    order_id: payment.providerOrderId,
    status: payment.status,
    amount: money(payment.amountMinor, payment.currency),
    currency: payment.currency,
    deal_amount: money(payment.dealAmountMinor, payment.dealCurrency),
    deal_currency: payment.dealCurrency,
    approve_url: payment.status === 'CREATED' ? payment.approveUrl : null,
    capture_id: payment.captureId,
    // 'rest' or 'toolkit' (@paypal/agent-toolkit).
    created_via: payment.createdVia ?? 'rest',
    invoice: payment.invoiceId
      ? { id: payment.invoiceId, status: payment.invoiceStatus, via: payment.invoiceVia }
      : null,
    // Why a paid deal has no invoice yet - the last refusal, kept so it can be
    // seen without the server logs.
    invoice_error:
      !payment.invoiceId && payment.invoiceError
        ? { message: payment.invoiceError, attempted_at: payment.invoiceAttemptedAt ?? null }
        : null,
    created_at: payment.createdAt,
    paid_at: payment.paidAt,
  };
}

/**
 * One agent_runs row as "why the agent did this", for the buyer-facing card.
 * Deliberately narrower than presentRun: no raw detail, no counter_price -
 * only what explainRun lets through, which never includes the buyer's target
 * or maximum.
 */
export function presentRunWhy(run, limits) {
  const why = explainRun(run, limits);
  return {
    id: run.id,
    action: run.action,
    reason: run.reason,
    headline: why.headline,
    detail: why.detail,
    notes: why.notes,
    supplier_price: money(why.supplierPriceMinor, limits.currency),
    agent_offer: money(why.agentOfferMinor, limits.currency),
    state_before: run.stateBefore,
    state_after: run.stateAfter,
    created_at: run.createdAt,
  };
}

/**
 * A demo run, one entry per supplier. "Savings" is the supplier's opening quote
 * minus the price the negotiation ended at - what the agent talked them down.
 */
export function presentDemoRun({ requirement, limits, recommendation, suppliers }) {
  const currency = requirement.currency;
  return {
    requirement: presentRequirement(requirement),
    target_per_unit: money(limits.targetMinor, currency),
    max_per_unit: money(limits.maxMinor, currency),
    recommendation: presentRecommendation(recommendation, currency),
    suppliers: suppliers.map((s) => ({
      negotiation_id: s.negotiation.id,
      supplier: {
        name: s.seller?.name ?? null,
        company: s.seller?.company ?? null,
        description: s.description,
      },
      state: s.negotiation.state,
      outcome: s.negotiation.outcome,
      round: s.negotiation.round,
      max_rounds: s.negotiation.maxRounds,
      opening_price: money(s.openingMinor, currency),
      final_price: money(s.finalMinor, currency),
      savings_per_unit: money(s.savingsPerUnitMinor, currency),
      savings_total: money(s.savingsTotalMinor, currency),
      savings_percent:
        s.openingMinor && s.savingsPerUnitMinor !== null
          ? Math.round((s.savingsPerUnitMinor * 1000) / s.openingMinor) / 10
          : null,
      order_total: money(s.orderTotalMinor, currency),
      within_budget: s.withinBudget,
      meets_target: s.meetsTarget,
      recommended: s.recommended,
      accepted: s.negotiation.outcome === 'accepted_by_buyer',
      held_because: s.heldBecause,
      payment: presentPayment(s.payment),
      transcript: s.messages.map((m) => ({
        author: m.author,
        body: m.body,
        price: money(m.priceMinor, currency),
      })),
    })),
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
