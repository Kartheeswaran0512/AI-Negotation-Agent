/**
 * Play one negotiation against one simulated supplier until it settles.
 *
 * Shared by the scenario suite (through harness.js) and the "Run demo" button,
 * so the demo shows exactly the loop the tests assert on.
 *
 * It follows the THREAD, not just what its own tick returned: the supplier
 * answers whenever the agent spoke last and has not been answered. That keeps
 * the demo moving when a worker process is ticking the same negotiation - the
 * outbox lets only one of them send, and whichever did, the supplier replies.
 */

import { isTerminal } from '../domain/machine.js';

/** The example requirement from the project brief. */
export const DEFAULT_REQUIREMENT = Object.freeze({
  product: 'wireless earbuds',
  quantity: 100,
  unit: 'pieces',
  currency: 'INR',
  target: '600',
  max: '700',
  basis: 'per_unit',
});

/**
 * @param {object} params
 * @param {object} params.services
 * @param {import('../repositories/types.js').Repositories} params.repositories
 * @param {number|string} params.negotiationId
 * @param {import('./mockSellers.js').SellerPersona} params.seller
 * @param {number} [params.maxTicks]       a safety stop, not a business rule
 * @param {string} [params.triggerSource]  recorded on every agent run
 * @returns {Promise<object[]>} one entry per tick
 */
export async function playAgainst({
  services,
  repositories,
  negotiationId,
  seller,
  maxTicks = 24,
  triggerSource = 'simulation',
}) {
  const ticks = [];
  let answeredAgentMessageId = null;

  for (let index = 0; index < maxTicks; index += 1) {
    const before = await repositories.negotiations.findById(negotiationId);
    if (isTerminal(before.state)) break;

    const result = await services.negotiations.tick({ negotiationId, triggerSource });

    ticks.push({
      action: result.action.kind,
      reason: result.action.reason,
      state: result.state,
      sent: Boolean(result.message),
      body: result.message?.body ?? null,
      generatedBy: result.generatedBy,
    });

    const thread = await repositories.messages.listByNegotiation(negotiationId);
    const last = thread[thread.length - 1];
    const agentSpokeLast =
      last?.author === 'agent' && String(last.id) !== String(answeredAgentMessageId);

    if (agentSpokeLast) {
      answeredAgentMessageId = last.id;
      const reply = seller.reply({ round: before.round, agentMessage: last });
      // A silent supplier: one more tick would only re-hold.
      if (!reply) break;
      await services.negotiations.recordSellerMessage({ negotiationId, body: reply });
      continue;
    }

    // Nothing was sent and nothing new arrived - another tick changes nothing.
    if (result.action.kind === 'hold') break;
  }

  return ticks;
}
