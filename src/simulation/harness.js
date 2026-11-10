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
import { toMinor } from '../domain/money.js';
import { DEFAULT_REQUIREMENT, playAgainst } from './play.js';

export { DEFAULT_REQUIREMENT };

/**
 * A deterministic configuration that needs no environment and no API key.
 * @param {Record<string,string>} [overrides]
 */
export function simulationConfig(overrides = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    API_KEY: 'simulation-key',
    STORE: 'memory',
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
 * @param {object} [options.paypal]      inject a PayPal stub; payments are off without one
 */
export async function createWorld({ configOverrides = {}, interpreter, paypal = null } = {}) {
  const config = simulationConfig(configOverrides);
  const repositories = createMemoryRepositories();

  const container = createContainer({
    config,
    repositories,
    interpreter:
      interpreter ?? createInterpreter({ llm: createRulesAdapter(), timeoutMs: 2000 }),
    paypalClient: paypal,
    logger: silentLogger,
  });

  const buyer = await repositories.users.create({
    role: 'buyer',
    name: 'Simulation Buyer',
    email: `buyer-${Math.random().toString(36).slice(2)}@example.test`,
  });

  return { ...container, buyer };
}

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

  const ticks = await playAgainst({
    services,
    repositories,
    negotiationId: negotiation.id,
    seller,
    maxTicks,
  });

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
