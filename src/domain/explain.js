/**
 * "Why the agent did this": one agent_runs row in plain words, for the buyer.
 *
 * It describes what crossed the table - what the supplier asked, what the agent
 * offered - and the reason code behind each step. It NEVER states the buyer's
 * target or maximum. That is enforced, not hoped for: any amount equal to
 * either limit is dropped before it can be shown, even one the agent said out
 * loud (asked for a budget, the agent answers at the target, and a supplier's
 * quote can land on it too). The sentences name the limits only as ideas
 * ("your target"), never as figures.
 */

import { ACTION, REASON } from './decide.js';
import { REFUSAL } from './guard.js';
import { formatMoney } from './money.js';

/**
 * @param {object} run      an agent_runs row (repository shape)
 * @param {import('./limits.js').Limits} limits  used only to hide the limits
 * @returns {{headline: string, detail: string, notes: string[], supplierPriceMinor: number|null, agentOfferMinor: number|null}}
 */
export function explainRun(run, limits) {
  const hidden = new Set([limits.targetMinor, limits.maxMinor]);
  const visible = (minor) =>
    Number.isSafeInteger(minor) && minor > 0 && !hidden.has(minor) ? minor : null;

  const detail = run.detail ?? {};
  const supplierPriceMinor = visible(detail.sellerPriceMinor);
  const agentOfferMinor = run.action === ACTION.COUNTER ? visible(run.counterPriceMinor) : null;
  const money = (minor) => formatMoney(minor, limits.currency);
  const theirPrice = supplierPriceMinor !== null ? `Their price of ${money(supplierPriceMinor)}` : 'Their price';

  let headline;
  let text;

  switch (run.reason) {
    case REASON.OPENING:
      headline = 'Opened the negotiation';
      text = 'Sent the first message and asked for their best price, without mentioning your budget.';
      break;
    case REASON.ANSWERING_BUDGET_QUESTION:
      headline = 'Answered their budget question';
      text =
        'They asked what you would pay. The agent answered with your target and kept your maximum private, as it always does.';
      break;
    case REASON.IMPROVE_PRICE:
      headline = agentOfferMinor !== null ? `Countered at ${money(agentOfferMinor)}` : 'Made a counter-offer';
      text = `${theirPrice} was higher than you want to pay, so the agent asked for less.`;
      if (detail.sellerAskedOurBudget) {
        text += ' They had asked about your budget: it shared your target only, never your maximum.';
      }
      break;
    case REASON.TARGET_MET:
      headline = 'Stopped: your target was met';
      text = `${theirPrice} met your target, so the agent stopped negotiating and left the decision to you.`;
      break;
    case REASON.ROUNDS_SPENT:
      headline = 'Stopped: out of rounds';
      text =
        run.action === ACTION.END
          ? 'It used every round it was allowed without reaching your target, so it stopped rather than keep pushing.'
          : 'It had no rounds left, so it sent nothing more.';
      break;
    case REASON.SELLER_DECLINED:
      headline = 'Stopped: the supplier declined';
      text = 'The supplier said no, so the agent closed the negotiation without replying.';
      break;
    case REASON.NEEDS_HUMAN:
      headline = 'Handed to a person';
      text = detail.injection
        ? "The supplier's message looked like an attempt to give the agent instructions, so it stopped and flagged it for a person."
        : 'Something here needed a person to decide, so the agent stopped.';
      break;
    case REASON.AWAITING_REPLY:
      headline = 'Waited for their reply';
      text = 'It had already spoken and was waiting for the supplier to answer.';
      break;
    case REASON.AWAITING_PRICE:
      headline = 'Waited for a price';
      text = 'The supplier had not named a price yet, so there was nothing to counter.';
      break;
    case REASON.ALREADY_ANSWERED:
      headline = 'Nothing new to answer';
      text = "It had already replied to the supplier's latest message.";
      break;
    case REASON.TERMINAL:
      headline = 'No action';
      text = 'This negotiation was already finished.';
      break;
    default:
      headline = refusalHeadline(run.reason) ?? 'Took no action';
      text = refusalText(run.reason) ?? 'The agent recorded this step without sending anything.';
  }

  const notes = [];
  if (detail.refusal && run.reason !== detail.refusal) {
    const why = refusalText(detail.refusal);
    if (why) notes.push(why);
  }
  if (Array.isArray(detail.droppedByVerification) && detail.droppedByVerification.length > 0) {
    notes.push("It ignored details it could not find in the supplier's own words.");
  }
  if (run.action === ACTION.COUNTER || run.action === ACTION.OPEN) {
    notes.push(run.fellBack ? 'Worded from a fixed template.' : 'Worded by the language model, then checked against the allowed figures.');
  }

  return { headline, detail: text, notes, supplierPriceMinor, agentOfferMinor };
}

function refusalHeadline(code) {
  return {
    [REFUSAL.SEND_LIMIT]: 'Held: daily send limit',
    [REFUSAL.DRY_RUN]: 'Held: dry-run mode',
    [REFUSAL.AGENT_DISABLED]: 'Held: agent switched off',
  }[code] ?? null;
}

function refusalText(code) {
  return {
    [REFUSAL.SEND_LIMIT]: 'The daily send limit was reached, so it held its message.',
    [REFUSAL.DRY_RUN]: 'Dry-run mode is on: it decided what to say but sent nothing.',
    [REFUSAL.AGENT_DISABLED]: 'The agent is switched off, so it sent nothing.',
    [REFUSAL.ROUNDS_SPENT]: 'It had no rounds left.',
    [REFUSAL.ALREADY_ANSWERED]: 'It had already answered that message.',
    [REFUSAL.TERMINAL]: 'The negotiation was already finished.',
  }[code] ?? null;
}
