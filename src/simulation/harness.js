/**
 * Run a whole negotiation, start to finish, in memory.
 *
 * This drives the REAL services, the real decision core, the real guards and
 * the real verification fences - only the store and the supplier are simulated.
 * That is what makes an assertion here worth something: nothing about the
 * agent's behaviour is stubbed out.
 */

import { loadConfig } from '../config/env.js';
import { silentLogger } from '../config/logger.js';
import { createMemoryRepositories } from '../repositories/memoryRepositories.js';
import { createInterpreter, createRulesAdapter } from '../llm/index.js';
import { createContainer } from '../container.js';
import { isTerminal } from '../domain/machine.js';
import { toMinor } from '../domain/money.js';

/**
 * A deterministic configuration that needs no environment and no API key.
 * @param {Record<string,string>} [overrides]
 */
export function simulationConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_KEY: 'simulation-key',
    LLM_PROVIDER: 'rules',
    AGENT_ENABLED: 'true',
    AGENT_DRY_RUN: 'false',
    AGENT_MAX_ROUNDS: '6',
    ...overrides,
  });
}

/**
 * Build an isolated world: memory store, rules interpreter, one buyer.
 *
 * @param {object} [options]
 * @param {Record<string,string>} [options.configOverrides]
 * @param {object} [options.interpreter] inject a different interpreter
 */
export async function createWorld({ configOverrides = {}, interpreter } = {}) {
  const config = simulationConfig(configOverrides);
  const repositories = createMemoryRepositories();

  const container = createContainer({
    config,
    repositories,
    interpreter:
      interpreter ?? createInterpreter({ llm: createRulesAdapter(), timeoutMs: 2000 }),
    logger: silentLogger,
  });

  const buyer = await repositories.users.create({
    role: 'buyer',
    name: 'Simulation Buyer',
    email: `buyer-${Math.random().toString(36).slice(2)}@example.test`,
  });

  return { ...container, buyer };
}

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
 * Play one negotiation against one simulated supplier.
 *
 * @param {object} params
 * @param {object} params.world             from createWorld()
 * @param {object} params.seller            a persona from mockSellers.js
 * @param {object} [params.requirement]     overrides for DEFAULT_REQUIREMENT
 * @param {number} [params.maxTicks]        a safety stop, not a business rule
 * @returns {Promise<object>} the full trace
 */
export async function playNegotiation({
  world,
  seller,
  requirement: requirementInput = {},
  maxTicks = 24,
}) {
  const spec = { ...DEFAULT_REQUIREMENT, ...requirementInput };
  const { repositories, services } = world;

  const sellerUser = await repositories.users.create({
    role: 'seller',
    name: `Simulated ${seller.name}`,
    email: `seller-${seller.name}-${Math.random().toString(36).slice(2)}@example.test`,
  });

  const { requirement } = await services.intake.createRequirement({
    buyerId: world.buyer.id,
    product: spec.product,
    quantity: spec.quantity,
    unit: spec.unit,
    currency: spec.currency,
    targetPriceMinor: toMinor(spec.target),
    maxPriceMinor: toMinor(spec.max),
    priceBasis: spec.basis,
  });

  const negotiation = await services.negotiations.open({
    requirementId: requirement.id,
    sellerId: sellerUser.id,
  });

  const ticks = [];

  for (let index = 0; index < maxTicks; index += 1) {
    const before = await repositories.negotiations.findById(negotiation.id);
    if (isTerminal(before.state)) break;

    const result = await services.negotiations.tick({
      negotiationId: negotiation.id,
      triggerSource: 'simulation',
    });

    ticks.push({
      action: result.action.kind,
      reason: result.action.reason,
      state: result.state,
      sent: Boolean(result.message),
      body: result.message?.body ?? null,
      generatedBy: result.generatedBy,
    });

    if (result.message) {
      const reply = seller.reply({ round: before.round, agentMessage: result.message });
      if (reply) {
        await services.negotiations.recordSellerMessage({
          negotiationId: negotiation.id,
          body: reply,
        });
        continue;
      }
      // A silent supplier: one more tick would only re-hold.
      break;
    }

    // Nothing was sent and nothing new arrived - another tick changes nothing.
    if (result.action.kind === 'hold') break;
  }

  const final = await repositories.negotiations.findById(negotiation.id);
  const messages = await repositories.messages.listByNegotiation(negotiation.id);
  const runs = await repositories.agentRuns.listByNegotiation(negotiation.id);
  const recommendation = await services.recommendations.latest(requirement.id);

  return {
    requirement,
    seller: sellerUser,
    negotiation: final,
    messages,
    runs,
    ticks,
    recommendation,
    agentMessages: messages.filter((message) => message.author === 'agent'),
  };
}
