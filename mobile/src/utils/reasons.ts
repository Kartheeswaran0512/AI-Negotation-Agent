/**
 * Turning the agent's machine-readable reasons into sentences a buyer can read.
 *
 * The backend returns short codes ('awaiting_price', 'already_answered') on
 * every tick and every audit row. A UI that renders those raw looks like a
 * debugger; a UI that hides them cannot explain what the agent did. So each one
 * is mapped, and an unknown code degrades to the code itself rather than to
 * silence - a new server reason should be visible, not swallowed.
 */

import type { AgentAction, RecommendationDecision, Verdict } from '@/api/types';

const REASON_TEXT: Record<string, string> = {
  // Why nothing was sent.
  terminal: 'This negotiation has finished. The agent takes no further action.',
  awaiting_reply: 'The opening enquiry has been sent. Waiting for the supplier to reply.',
  awaiting_price: 'The supplier replied but has not quoted a price yet.',
  already_answered: 'The supplier has not said anything new since the last message.',
  rounds_spent: 'The agreed number of negotiating rounds has been used.',
  agent_disabled: 'The agent is switched off on the server.',
  dry_run: 'The agent is in dry-run mode: it decided on a message but sent nothing.',
  send_limit: 'The daily sending limit has been reached.',
  not_opened: 'The opening enquiry has not been sent yet.',

  // Why something was sent.
  opening: 'Opening the enquiry with this supplier.',
  improve_price: 'Countering to move the supplier closer to your target.',
  answering_budget_question: 'The supplier asked what you will pay, so the agent stated your target.',

  // Why it stopped.
  target_met: 'The supplier reached your target price.',
  seller_declined: 'The supplier declined to quote for this requirement.',
  needs_human: 'This negotiation needs a person to look at it.',
  prompt_injection_suspected:
    'The supplier message tried to give the agent instructions. It was not interpreted, and the negotiation was handed to you.',
};

export function describeReason(reason: string | null | undefined): string {
  if (!reason) return 'No reason recorded.';
  return REASON_TEXT[reason] ?? reason.replace(/_/g, ' ');
}

const ACTION_TEXT: Record<AgentAction, string> = {
  hold: 'Held',
  open: 'Opened enquiry',
  counter: 'Countered',
  end: 'Ended',
  escalate: 'Escalated',
};

export function describeAction(action: AgentAction): string {
  return ACTION_TEXT[action] ?? action;
}

/** A hold is a normal, correct outcome - never render it as a failure. */
export function isQuietAction(action: AgentAction): boolean {
  return action === 'hold';
}

const VERDICT_TEXT: Record<Verdict, string> = {
  awaiting: 'No price yet',
  below_target: 'Below your target',
  at_target: 'At your target',
  within_budget: 'Within budget, above target',
  over_budget: 'Over your maximum',
  declined: 'Supplier declined',
};

export function describeVerdict(verdict: Verdict | null | undefined): string | null {
  if (!verdict) return null;
  return VERDICT_TEXT[verdict] ?? verdict.replace(/_/g, ' ');
}

const DECISION_TEXT: Record<RecommendationDecision, string> = {
  accept: 'Accept',
  reject: 'Reject',
  continue: 'Keep negotiating',
};

export function describeDecision(decision: RecommendationDecision): string {
  return DECISION_TEXT[decision] ?? decision;
}

const RATIONALE_TEXT: Record<string, string> = {
  target_met: 'A supplier met your target.',
  best_within_budget_and_finished:
    'Every negotiation has finished and this is the best price inside your budget.',
  nothing_within_budget: 'Every negotiation finished and none came in within your budget.',
  no_offers_at_all: 'No supplier quoted a usable price.',
  still_negotiating: 'At least one negotiation is still running.',
};

export function describeRationale(rationale: string | null | undefined): string {
  if (!rationale) return '';
  return RATIONALE_TEXT[rationale] ?? rationale.replace(/_/g, ' ');
}

/** Field names from POST /api/requirements/read, in the buyer's language. */
const FIELD_TEXT: Record<string, string> = {
  product: 'product',
  quantity: 'quantity',
  unit: 'unit',
  currency: 'currency',
  target_price: 'target price',
  max_price: 'maximum price',
  price_basis: 'price basis',
};

export function describeField(field: string): string {
  return FIELD_TEXT[field] ?? field.replace(/_/g, ' ');
}
