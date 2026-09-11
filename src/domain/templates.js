/**
 * Deterministic wording.
 *
 * Two jobs. It is the message the agent sends when no language model is
 * available, and it is the fallback whenever a generated message fails the
 * grounding check - which means the product degrades in tone, never in
 * correctness, when the model is slow, absent, or wrong.
 *
 * Every sentence here is grounded BY CONSTRUCTION: the only figures inserted
 * are ones the caller was already authorised to state.
 */

import { formatMoney } from './money.js';

/**
 * @param {object} params
 * @param {import('./limits.js').Limits} params.limits
 * @param {boolean} [params.discloseTarget]
 * @returns {string}
 */
export function openingMessage({ limits, discloseTarget = false }) {
  const quantity = limits.quantity > 0 ? `${limits.quantity}${unitSuffix(limits)} of ` : '';
  const opening = `Hello - we are sourcing ${quantity}${limits.product} and would like your best price.`;

  if (discloseTarget) {
    return `${opening} We are working to ${formatMoney(limits.targetMinor, limits.currency)} per ${unitWord(limits)}. Can you supply at that level?`;
  }
  return `${opening} Could you share your rate and any minimum order quantity?`;
}

/**
 * The counter-offer. The figure is the one `pricing.nextCounter` chose; this
 * function only decides how to say it.
 *
 * @param {object} params
 * @param {import('./limits.js').Limits} params.limits
 * @param {number} params.counterMinor
 * @param {boolean} [params.discloseTarget]
 * @param {number} [params.round]
 * @returns {string}
 */
export function counterMessage({ limits, counterMinor, discloseTarget = false, round = 0 }) {
  const price = formatMoney(counterMinor, limits.currency);
  const per = `per ${unitWord(limits)}`;
  const volume = limits.quantity > 0 ? ` for the full ${limits.quantity}${unitSuffix(limits)}` : '';

  const opener = round === 0
    ? 'Thank you for the quote.'
    : 'Thanks for coming back to us.';

  if (discloseTarget) {
    return `${opener} We are aiming for ${formatMoney(limits.targetMinor, limits.currency)} ${per}. We can move to ${price} ${per}${volume} - can you work with that?`;
  }
  return `${opener} We can proceed at ${price} ${per}${volume}. Is that workable on your side?`;
}

/**
 * The seller asked what we expect to pay and has not quoted a price yet.
 *
 * @param {object} params
 * @param {import('./limits.js').Limits} params.limits
 * @param {number} params.counterMinor
 * @returns {string}
 */
export function budgetAnswerMessage({ limits, counterMinor }) {
  const price = formatMoney(counterMinor, limits.currency);
  const volume = limits.quantity > 0 ? ` on ${limits.quantity}${unitSuffix(limits)}` : '';
  return `We are working to ${price} per ${unitWord(limits)}${volume}. If you can supply at that level we can move quickly - what is your best rate?`;
}

/**
 * Buyer-facing explanation of a tick that sent nothing. Never shown to a seller.
 *
 * @param {string} reason
 * @returns {string}
 */
export function holdExplanation(reason) {
  return HOLD_TEXT[reason] ?? 'No action was taken on this negotiation.';
}

const HOLD_TEXT = Object.freeze({
  terminal: 'This negotiation has finished; the agent takes no further action.',
  awaiting_reply: 'The opening enquiry has been sent and the supplier has not replied yet.',
  awaiting_price: 'The supplier has replied but has not quoted a price yet.',
  already_answered: 'The supplier has not said anything new since our last message.',
  rounds_spent: 'The agreed number of negotiating rounds has been used.',
  agent_disabled: 'The agent is switched off.',
  dry_run: 'The agent is in dry-run mode: it decided on a message but sent nothing.',
  send_limit: 'The daily sending limit has been reached.',
  not_opened: 'The opening enquiry has not been sent yet.',
});

/**
 * @param {object} params
 * @param {string} params.outcome
 * @param {import('./limits.js').Limits} params.limits
 * @param {number|null} [params.priceMinor]
 * @returns {string}
 */
export function outcomeExplanation({ outcome, limits, priceMinor = null }) {
  const price = priceMinor === null ? null : formatMoney(priceMinor, limits.currency);
  const per = `per ${unitWord(limits)}`;

  switch (outcome) {
    case 'target_met':
      return `The supplier is at ${price} ${per}, which meets your target of ${formatMoney(limits.targetMinor, limits.currency)} ${per}.`;
    case 'rounds_spent':
      return price
        ? `The negotiating rounds are used up. The supplier's last price was ${price} ${per}.`
        : 'The negotiating rounds are used up and the supplier never quoted a price.';
    case 'declined':
      return 'The supplier declined to quote for this requirement.';
    case 'escalated':
      return 'This negotiation needs a human decision and the agent has stopped.';
    default:
      return 'The negotiation has ended.';
  }
}

/**
 * @param {object} recommendation
 * @param {import('./limits.js').Limits} limits
 * @returns {string}
 */
export function recommendationSummary(recommendation, limits) {
  const { decision, priceMinor } = recommendation;
  const price = priceMinor === null || priceMinor === undefined
    ? null
    : formatMoney(priceMinor, limits.currency);
  const per = `per ${unitWord(limits)}`;
  const target = formatMoney(limits.targetMinor, limits.currency);

  switch (decision) {
    case 'accept':
      return `Recommended: accept at ${price} ${per} (your target was ${target} ${per}). The decision is yours - the agent cannot accept on your behalf.`;
    case 'reject':
      return 'Recommended: reject. No supplier came back within your budget.';
    case 'continue':
      return price
        ? `Recommended: keep negotiating. The best price so far is ${price} ${per} against a target of ${target} ${per}.`
        : 'Recommended: keep negotiating. No supplier has quoted a usable price yet.';
    default:
      return 'No recommendation is available yet.';
  }
}

function unitWord(limits) {
  return limits.unit ? singular(limits.unit) : 'unit';
}

function unitSuffix(limits) {
  return limits.unit ? ` ${limits.unit}` : ' units';
}

function singular(unit) {
  const trimmed = unit.trim();
  if (/(ss|s)$/i.test(trimmed) && !/ss$/i.test(trimmed)) return trimmed.slice(0, -1);
  return trimmed;
}
