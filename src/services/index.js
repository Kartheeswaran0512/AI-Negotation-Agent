/**
 * Wire the services together.
 *
 * Everything is injected: the store, the interpreter, the config, the clock.
 * That is what lets `npm run demo` and the scenario suite run the real service
 * code against an in-memory store and a scripted supplier, with no database,
 * no network and no API key.
 */

import { createIntakeService } from './intakeService.js';
import { createNegotiationService } from './negotiationService.js';
import { createRecommendService } from './recommendService.js';
import { createPaymentService } from './paymentService.js';
import { createDemoService } from './demoService.js';

export { createIntakeService, createNegotiationService, createRecommendService, createPaymentService };
export { ValidationError } from './intakeService.js';
export { NotFoundError, ConflictError } from './negotiationService.js';
export { PaymentProviderError, PAYMENT_STATUS } from './paymentService.js';

/**
 * @param {object} deps
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.interpreter
 * @param {object} deps.config
 * @param {object|null} [deps.paypal]  a PayPal client, or null for no payments
 * @param {object} [deps.logger]
 * @param {() => Date} [deps.clock]
 */
export function createServices({ repositories, interpreter, config, paypal = null, logger = null, clock }) {
  const recommendations = createRecommendService({ repositories, interpreter });

  const negotiations = createNegotiationService({
    repositories,
    interpreter,
    config,
    recommendService: recommendations,
    logger,
    clock,
  });

  const intake = createIntakeService({ repositories, interpreter });

  const payments = createPaymentService({
    repositories,
    negotiations,
    paypal,
    config,
    logger,
    clock,
  });

  const demo = createDemoService({
    services: { intake, negotiations, recommendations, payments },
    repositories,
    config,
    logger,
  });

  return { intake, negotiations, recommendations, payments, demo };
}
