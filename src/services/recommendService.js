/**
 * The recommendation the buyer actually sees.
 *
 * It reads every negotiation on a requirement, asks the pure `recommendFor` for
 * a decision, stores it, and asks the interpreter for a sentence of English -
 * which is checked against the same allow-list as everything else, so the
 * explanation can never contain a price no supplier gave.
 *
 * It recommends. It does not accept. Acceptance is `negotiationService.accept`,
 * which requires the buyer's own identity.
 */

import { recommendFor } from '../domain/recommend.js';
import { createLimits } from '../domain/limits.js';
import { allowedNumbers } from '../domain/grounding.js';
import { recommendationSummary } from '../domain/templates.js';
import { formatMoney } from '../domain/money.js';

/**
 * @param {object} deps
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.interpreter
 */
export function createRecommendService({ repositories, interpreter }) {
  /**
   * Recompute and store the recommendation for one requirement.
   *
   * @param {number|string} requirementId
   */
  async function refresh(requirementId) {
    const requirement = await repositories.requirements.findById(requirementId);
    if (!requirement) return null;

    const limits = limitsFor(requirement);
    const negotiations = await repositories.negotiations.listByRequirement(requirementId);

    const offers = negotiations.map((negotiation) => ({
      negotiationId: negotiation.id,
      sellerId: negotiation.sellerId,
      priceMinor: negotiation.currentSellerPriceMinor,
      status: negotiation.state,
    }));

    const decision = recommendFor({ offers, limits });
    const fallbackText = recommendationSummary(decision, limits);

    const allowed = allowedNumbers({
      limits,
      counterMinor: decision.priceMinor,
      discloseTarget: true, // the buyer's own target, shown to the buyer
      extra: [decision.consideredCount],
    });

    const explained = await interpreter.explain({
      facts: {
        product: limits.product,
        decision: decision.decision,
        best_price: decision.priceMinor === null ? 'none' : formatMoney(decision.priceMinor, limits.currency),
        buyer_target: formatMoney(limits.targetMinor, limits.currency),
        suppliers_with_prices: decision.consideredCount,
        all_negotiations_finished: decision.finished,
      },
      allowed,
      fallbackText,
    });

    const stored = await repositories.recommendations.create({
      requirementId,
      negotiationId: decision.negotiationId,
      decision: decision.decision,
      rationale: decision.rationale,
      priceMinor: decision.priceMinor,
      summary: explained.text,
    });

    return { ...stored, generatedBy: explained.generatedBy, finished: decision.finished };
  }

  /** @param {number|string} requirementId */
  async function latest(requirementId) {
    return repositories.recommendations.latestForRequirement(requirementId);
  }

  return { refresh, latest };
}

/** @param {object} requirement a repository row */
export function limitsFor(requirement) {
  return createLimits({
    product: requirement.product,
    quantity: requirement.quantity,
    unit: requirement.unit,
    currency: requirement.currency,
    targetMinor: requirement.targetPriceMinor,
    maxMinor: requirement.maxPriceMinor,
    basis: requirement.priceBasis,
  });
}
