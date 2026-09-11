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

export { createIntakeService, createNegotiationService, createRecommendService };
export { ValidationError } from './intakeService.js';
export { NotFoundError, ConflictError } from './negotiationService.js';

/**
 * @param {object} deps
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.interpreter
 * @param {object} deps.config
 * @param {object} [deps.logger]
 * @param {() => Date} [deps.clock]
 */
export function createServices({ repositories, interpreter, config, logger = null, clock }) {
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

  return { intake, negotiations, recommendations };
}
