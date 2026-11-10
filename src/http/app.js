/**
 * The Express application: wiring only.
 *
 * No business logic lives here. Routes translate HTTP into service calls and
 * service results back into JSON; everything that decides anything is a layer
 * down. That is why the app can be constructed against an in-memory store in a
 * test and against MySQL in production with no change.
 */

import { fileURLToPath } from 'node:url';
import express from 'express';

import { apiKeyAuth, identity } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import { healthRoutes } from './routes/health.js';
import { requirementRoutes } from './routes/requirements.js';
import { negotiationRoutes } from './routes/negotiations.js';
import { toolRoutes } from './routes/tools.js';
import { paypalReturnRoutes } from './routes/paypalReturn.js';
import { demoRoutes } from './routes/demo.js';

/** The static buyer UI. It holds no secrets: the API key is typed in by the user. */
const PUBLIC_DIR = fileURLToPath(new URL('../../public', import.meta.url));

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {object} deps.services
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.interpreter
 * @param {object} deps.tools
 * @param {object} [deps.logger]
 */
export function createApp({ config, services, repositories, interpreter, tools, logger = null }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(identity());

  // Health is deliberately outside the API key check so a container probe does
  // not need a secret.
  app.use(healthRoutes({ config, interpreter, repositories }));

  // Also outside the key check: the page itself, and PayPal's browser
  // redirects back to /paid and /cancelled.
  app.use(express.static(PUBLIC_DIR));
  app.use(paypalReturnRoutes({ services, logger }));
  // The demo's own token stands in for the key; off in production by default.
  if (config.demo.enabled) app.use('/demo', demoRoutes({ services }));

  app.use('/api', apiKeyAuth(config));
  app.use('/api', rateLimit({ windowMs: 60_000, max: 240 }));

  app.use('/api/requirements', requirementRoutes({ services, repositories, config }));
  app.use('/api/negotiations', negotiationRoutes({ services, repositories }));
  app.use('/api/tools', toolRoutes({ tools }));

  app.use(notFound);
  app.use(errorHandler(logger));

  return app;
}
