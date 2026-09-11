/**
 * The API contract, transcribed from the backend.
 *
 * Every shape here mirrors src/http/presenters.js and the route handlers. Where
 * the backend returns a field in camelCase (the free-text reading, which is not
 * passed through a presenter) that is preserved exactly rather than tidied, so
 * this file can be diffed against the server.
 *
 * MONEY IS NEVER A BARE NUMBER. The server sends {minor, amount, display}:
 * compute with `minor` (integer paise/cents), render `display`. `amount` is the
 * plain decimal string and exists for forms.
 */

export interface Money {
  /** Integer minor units. The only field safe to do arithmetic on. */
  minor: number;
  /** Plain decimal string, e.g. "600.00". */
  amount: string;
  /** Human-facing, e.g. "₹600.00". */
  display: string;
}

export type PriceBasis = 'per_unit' | 'total';

export type RequirementStatus = 'draft' | 'active' | 'closed';

export interface Requirement {
  id: number | string;
  buyer_id: number | string;
  product: string;
  quantity: number;
  unit: string | null;
  currency: string;
  price_basis: PriceBasis;
  target_price: Money;
  max_price: Money;
  status: RequirementStatus;
  created_at: string;
}

/** The eight states in src/domain/machine.js. */
export type NegotiationState =
  | 'DRAFT'
  | 'AWAITING_REPLY'
  | 'EVALUATING'
  | 'COUNTERED'
  | 'TARGET_MET'
  | 'ROUNDS_SPENT'
  | 'DECLINED'
  | 'ESCALATED';

/** Terminal states have no outgoing transitions; the agent stops for good. */
export const TERMINAL_STATES: readonly NegotiationState[] = [
  'TARGET_MET',
  'ROUNDS_SPENT',
  'DECLINED',
  'ESCALATED',
] as const;

export function isTerminalState(state: NegotiationState): boolean {
  return TERMINAL_STATES.includes(state);
}

export interface Negotiation {
  id: number | string;
  requirement_id: number | string;
  seller_id: number | string;
  state: NegotiationState;
  round: number;
  max_rounds: number;
  supplier_price: Money | null;
  seller_declined: boolean;
  outcome: string | null;
  created_at: string;
}

export type MessageAuthor = 'buyer' | 'seller' | 'agent' | 'system';

export type MessageKind = 'text' | 'offer' | 'question' | 'accept' | 'decline' | 'system';

/** Which layer wrote the words: a deterministic template, or the model. */
export type GeneratedBy = 'template' | 'llm';

export interface Message {
  id: number | string;
  negotiation_id: number | string;
  author: MessageAuthor;
  kind: MessageKind;
  body: string;
  price: Money | null;
  in_reply_to: number | string | null;
  generated_by: GeneratedBy | null;
  created_at: string;
}

/** The five things the agent can do. There is deliberately no 'accept'. */
export type AgentAction = 'hold' | 'open' | 'counter' | 'end' | 'escalate';

/** src/domain/verdict.js */
export type Verdict =
  | 'awaiting'
  | 'below_target'
  | 'at_target'
  | 'within_budget'
  | 'over_budget'
  | 'declined';

/** The JSON blob on an agent_runs row. */
export interface AgentRunDetail {
  verdict?: Verdict;
  sellerPriceMinor?: number | null;
  sellerAskedOurBudget?: boolean;
  droppedByVerification?: string[];
  injection?: string | null;
  readingSource?: string | null;
  refusal?: string | null;
}

export interface AgentRun {
  id: number | string;
  action: AgentAction;
  reason: string;
  state_before: NegotiationState;
  state_after: NegotiationState;
  counter_price: Money | null;
  llm_provider: string | null;
  llm_model: string | null;
  grounded: boolean | null;
  fell_back: boolean;
  latency_ms: number | null;
  detail: AgentRunDetail | null;
  created_at: string;
}

export type RecommendationDecision = 'accept' | 'reject' | 'continue';

export interface Recommendation {
  id: number | string;
  requirement_id: number | string;
  negotiation_id: number | string | null;
  decision: RecommendationDecision;
  rationale: string;
  price: Money | null;
  summary: string | null;
  created_at: string;
  note: string;
}

export interface Health {
  ok: boolean;
  service: string;
  env: string;
  llm: {
    provider: string;
    model: string | null;
    model_backed: boolean;
  };
  agent: {
    enabled: boolean;
    dry_run: boolean;
    max_rounds: number;
  };
}

/**
 * The result of POST /api/negotiations/:id/tick.
 *
 * `action: 'hold'` is the most common outcome and is NOT an error - it means
 * the agent considered the negotiation and correctly decided to say nothing.
 * `recommendation` is populated only when this tick ended the negotiation.
 */
export interface TickResult {
  ok: boolean;
  action: AgentAction;
  reason: string;
  state: NegotiationState;
  message: Message | null;
  generated_by: GeneratedBy | null;
  recommendation: Recommendation | null;
}

/**
 * The proposed requirement from POST /api/requirements/read.
 *
 * NOTE: this object does NOT go through a presenter, so its keys are camelCase
 * and its money is raw MINOR units, unlike everything else in this file.
 */
export interface RequirementReading {
  product: string | null;
  quantity: number | null;
  unit: string | null;
  currency: string | null;
  targetPriceMinor: number | null;
  maxPriceMinor: number | null;
  priceBasis: PriceBasis | null;
}

export interface ReadRequirementResult {
  ok: boolean;
  reading: RequirementReading | null;
  /** Field names the server could not verify against the buyer's own words. */
  unverified: string[];
  ready: boolean;
  question: string | null;
  source: string;
  note: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolListResult {
  ok: boolean;
  tools: ToolDefinition[];
  note: string;
}

/** The one error shape the whole API uses (src/http/middleware/errors.js). */
export interface ApiErrorBody {
  ok: false;
  error: {
    message: string;
    details: Array<{ field: string; message: string }> | null;
  };
}

export interface CreateRequirementInput {
  buyer_id: number | string;
  product: string;
  quantity?: number;
  unit?: string;
  currency?: string;
  target_price: string;
  max_price: string;
  price_basis: PriceBasis;
  source_text?: string;
}

export interface OpenNegotiationInput {
  seller_id: number | string;
  max_rounds?: number;
}

export interface SellerMessageInput {
  body: string;
  price?: string;
  quantity?: number;
}
