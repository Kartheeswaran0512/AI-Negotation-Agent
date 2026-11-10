/**
 * Composition root.
 *
 * The one place that knows how the pieces fit together, so that the web server,
 * the worker, the demo script and the tests all build the same object graph
 * with different parts swapped in.
 */

import { loadConfig } from './config/env.js';
import { createLogger, silentLogger } from './config/logger.js';
import { createRepositories } from './repositories/index.js';
import { createLlm } from './llm/index.js';
import { createServices } from './services/index.js';
import { createToolRegistry } from './agent/tools/index.js';
import { createRunner } from './agent/runner.js';
import { createPayPalClient } from './payments/paypal.js';
import { createToolkitClient, withToolkit } from './payments/toolkit.js';

/**
 * @param {object} [options]
 * @param {object} [options.config]        defaults to loadConfig()
 * @param {'mysql'|'memory'} [options.driver]  defaults to config.store
 * @param {object} [options.repositories]  inject a prebuilt store
 * @param {object} [options.interpreter]   inject a prebuilt interpreter
 * @param {object} [options.llmClient]     inject an Anthropic stub
 * @param {object|null} [options.paypalClient] inject a PayPal stub (null: payments off)
 * @param {object} [options.logger]
 * @param {() => Date} [options.clock]
 */
export function createContainer({
  config = loadConfig(),
  driver = config.store,
  repositories,
  interpreter,
  llmClient,
  paypalClient,
  logger,
  clock,
} = {}) {
  const log = logger ?? (config.env === 'test' ? silentLogger : createLogger({ level: config.logLevel }));

  const store = repositories ?? createRepositories({ driver, db: config.db });
  const llm = interpreter ?? createLlm(config, { client: llmClient, logger: log });
  const paypal = paypalClient !== undefined ? paypalClient : buildPayPal(config.paypal, log);

  const services = createServices({
    repositories: store,
    interpreter: llm,
    config,
    paypal,
    logger: log,
    clock,
  });

  const tools = createToolRegistry({ services, repositories: store });
  const runner = createRunner({ repositories: store, services, config, logger: log });

  return { config, logger: log, repositories: store, interpreter: llm, services, tools, runner };
}

/**
 * The REST client, or - with PAYPAL_USE_TOOLKIT=true - the Agent Toolkit in
 * front of it, falling back to REST. Null when PayPal is not configured.
 */
function buildPayPal(paypalConfig, logger) {
  if (!paypalConfig.enabled) return null;
  const rest = createPayPalClient(paypalConfig);
  if (!paypalConfig.useToolkit) return rest;
  const toolkit = createToolkitClient({
    clientId: paypalConfig.clientId,
    clientSecret: paypalConfig.clientSecret,
    sandbox: paypalConfig.env !== 'live',
  });
  return withToolkit({ rest, toolkit, logger });
}
