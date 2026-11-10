/**
 * The "Run demo" button: a whole procurement round, on demand, on a fresh server.
 *
 * run() creates a demo buyer, the brief's requirement (100 wireless earbuds,
 * target Rs 600, maximum Rs 700 per unit) and a negotiation with each of three
 * simulated suppliers, then lets the agent negotiate every one to its end.
 * Only the suppliers are scripted: the agent, guards, audit trail and
 * recommendation are the real ones, writing to the real store.
 *
 * The demo routes take no API key, so access to a run is a capability. run()
 * returns a token signed for that run's requirement and buyer; view() and
 * accept() take only that token, which opens its own run and no other.
 * Accepting still goes through the normal buyer acceptance and its ownership
 * check, as the run's buyer. The signing key lives in memory: restarting the
 * server retires every token, and there is no secret to configure.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { gradualSeller, questioningSeller, stubbornSeller } from '../simulation/mockSellers.js';
import { DEFAULT_REQUIREMENT, playAgainst } from '../simulation/play.js';
import { multiplyMinor, toMinor } from '../domain/money.js';
import { ConflictError, NotFoundError } from './negotiationService.js';
import { limitsFor } from './recommendService.js';

/** The three suppliers the demo negotiates with, side by side. */
const SUPPLIERS = Object.freeze([
  { persona: gradualSeller, company: 'Northline Electronics' },
  { persona: stubbornSeller, company: 'Harbour Components' },
  { persona: questioningSeller, company: 'Peak Audio Supply' },
]);

const DESCRIPTIONS = Object.freeze(
  Object.fromEntries(SUPPLIERS.map(({ persona }) => [persona().name, persona().description])),
);

export class DemoAccessError extends Error {
  constructor() {
    super('This demo run is not available any more (the server may have restarted). Run the demo again.');
    this.name = 'DemoAccessError';
    this.status = 403;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.services        intake, negotiations, recommendations, payments
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.config
 * @param {Buffer} [deps.secret]        token signing key; random per process by default
 * @param {object} [deps.logger]
 */
export function createDemoService({
  services,
  repositories,
  config,
  secret = randomBytes(32),
  logger = null,
}) {
  async function run() {
    // Say why up front, rather than showing three negotiations that never moved.
    if (!config.agent.enabled) {
      throw new ConflictError('The agent is switched off (AGENT_ENABLED=false), so there is nothing to demo.');
    }
    if (config.agent.dryRun) {
      throw new ConflictError(
        'The agent is in dry-run mode (AGENT_DRY_RUN=true) and sends nothing, so no supplier would ever answer.',
      );
    }

    const tag = randomBytes(4).toString('hex');
    const buyer = await repositories.users.create({
      role: 'buyer',
      name: 'Demo Buyer',
      email: `demo-buyer-${tag}@demo.invalid`,
      company: 'Demo Trading Co',
    });

    const spec = DEFAULT_REQUIREMENT;
    const { requirement } = await services.intake.createRequirement({
      buyerId: buyer.id,
      product: spec.product,
      quantity: spec.quantity,
      unit: spec.unit,
      currency: spec.currency,
      targetPriceMinor: toMinor(spec.target),
      maxPriceMinor: toMinor(spec.max),
      priceBasis: spec.basis,
      sourceText: 'Demo: 100 wireless earbuds, target 600 and maximum 700 per unit.',
    });

    const matches = [];
    for (const { persona, company } of SUPPLIERS) {
      const script = persona();
      const seller = await repositories.users.create({
        role: 'seller',
        name: script.name,
        email: `demo-${script.name}-${tag}@demo.invalid`,
        company,
      });
      const negotiation = await services.negotiations.open({
        requirementId: requirement.id,
        sellerId: seller.id,
      });
      matches.push({ negotiation, script });
    }

    await Promise.all(
      matches.map(({ negotiation, script }) =>
        playAgainst({
          services,
          repositories,
          negotiationId: negotiation.id,
          seller: script,
          triggerSource: 'demo',
        }),
      ),
    );

    // Once more with every negotiation finished, so the recommendation sees all three.
    await services.recommendations.refresh(requirement.id);

    logger?.info?.('demo run', { requirementId: requirement.id, buyerId: buyer.id });
    return { token: sign(requirement.id, buyer.id), run: await describe(requirement.id) };
  }

  async function view({ token }) {
    const { requirementId } = verify(token);
    return describe(requirementId);
  }

  /** The run's buyer accepts one of the run's negotiations, then pays. */
  async function accept({ token, negotiationId }) {
    const { requirementId, buyerId } = verify(token);
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation || String(negotiation.requirementId) !== String(requirementId)) {
      throw new NotFoundError('that negotiation is not part of this demo run');
    }
    const requirement = await repositories.requirements.findById(requirementId);
    const result = await services.payments.checkout({ negotiationId: negotiation.id, buyerId });
    return { ...result, currency: requirement.currency };
  }

  /**
   * The audit trail of one of the run's negotiations - the same agent_runs
   * rows GET /api/negotiations/:id/runs serves - with the requirement's limits
   * so the presenter can keep them out of what it shows.
   */
  async function runs({ token, negotiationId }) {
    const { requirementId } = verify(token);
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation || String(negotiation.requirementId) !== String(requirementId)) {
      throw new NotFoundError('that negotiation is not part of this demo run');
    }
    const requirement = await repositories.requirements.findById(requirementId);
    return {
      limits: limitsFor(requirement),
      runs: await repositories.agentRuns.listByNegotiation(negotiation.id),
    };
  }

  /** Retry the PayPal invoice for one of the run's paid deals. */
  async function retryInvoice({ token, negotiationId }) {
    const { requirementId } = verify(token);
    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation || String(negotiation.requirementId) !== String(requirementId)) {
      throw new NotFoundError('that negotiation is not part of this demo run');
    }
    return services.payments.retryInvoice({ negotiationId: negotiation.id });
  }

  /** Everything the side-by-side view shows, rebuilt from the store each time. */
  async function describe(requirementId) {
    const requirement = await repositories.requirements.findById(requirementId);
    if (!requirement) throw new NotFoundError('this demo run no longer exists');

    const limits = limitsFor(requirement);
    const negotiations = await repositories.negotiations.listByRequirement(requirement.id);
    const recommendation = await services.recommendations.latest(requirement.id);

    const suppliers = await Promise.all(
      negotiations.map(async (negotiation) => {
        const [seller, offers, messages, runs, payment] = await Promise.all([
          repositories.users.findById(negotiation.sellerId),
          repositories.offers.listByNegotiation(negotiation.id),
          repositories.messages.listByNegotiation(negotiation.id),
          repositories.agentRuns.listByNegotiation(negotiation.id),
          repositories.payments.findByNegotiation(negotiation.id),
        ]);

        const openingMinor = offers.find((offer) => offer.actor === 'seller')?.unitPriceMinor ?? null;
        const finalMinor = negotiation.currentSellerPriceMinor;
        const priced = openingMinor !== null && finalMinor !== null;
        const savingsPerUnitMinor = priced ? openingMinor - finalMinor : null;
        const perOrder = (minor) =>
          minor !== null && limits.quantity > 0 ? multiplyMinor(minor, limits.quantity) : null;

        return {
          negotiation,
          seller,
          description: DESCRIPTIONS[seller?.name] ?? null,
          openingMinor,
          finalMinor,
          savingsPerUnitMinor,
          savingsTotalMinor: savingsPerUnitMinor !== null && savingsPerUnitMinor >= 0
            ? perOrder(savingsPerUnitMinor)
            : null,
          orderTotalMinor: perOrder(finalMinor),
          withinBudget: finalMinor !== null && finalMinor <= limits.maxMinor,
          meetsTarget: finalMinor !== null && finalMinor <= limits.targetMinor,
          recommended:
            recommendation?.decision === 'accept' &&
            String(recommendation.negotiationId) === String(negotiation.id),
          // Why the agent stopped, when a safety switch rather than the
          // negotiation itself stopped it (e.g. the daily send limit).
          heldBecause: runs[runs.length - 1]?.detail?.refusal ?? null,
          messages,
          payment,
        };
      }),
    );

    return { requirement, limits, recommendation, suppliers };
  }

  function sign(requirementId, buyerId) {
    const body = `${requirementId}.${buyerId}`;
    return `${body}.${mac(body)}`;
  }

  function verify(token) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new DemoAccessError();
    const [requirementId, buyerId, signature] = parts;
    const expected = Buffer.from(mac(`${requirementId}.${buyerId}`));
    const given = Buffer.from(signature);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new DemoAccessError();
    }
    return { requirementId, buyerId };
  }

  function mac(body) {
    return createHmac('sha256', secret).update(`demo:${body}`).digest('base64url');
  }

  return { run, view, accept, runs, retryInvoice };
}
