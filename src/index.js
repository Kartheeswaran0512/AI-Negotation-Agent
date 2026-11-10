#!/usr/bin/env node
/**
 * Entry point for both processes.
 *
 *   node src/index.js web      the HTTP API
 *   node src/index.js worker   the agent loop
 *   node src/index.js both     both, for local convenience
 *
 * They are separate processes in anything real: the agent must keep negotiating
 * when nobody has the API open, and a slow model call must not occupy a request
 * handler.
 *
 * The store is STORE in .env: mysql, or memory (the default when DB_PASSWORD is
 * empty). A memory store lives inside one process, so it pairs with `web` or
 * `both`, never with a separate `worker`.
 */

import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { createApp } from './http/app.js';

const MODES = new Set(['web', 'worker', 'both']);

async function main() {
  const mode = process.argv[2] ?? 'web';
  if (!MODES.has(mode)) {
    process.stderr.write(`unknown mode "${mode}" (expected: ${[...MODES].join(', ')})\n`);
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  if (config.store === 'memory' && mode === 'worker') {
    process.stderr.write(
      'STORE=memory keeps data inside one process, so a separate worker would only ever see an empty store.\n' +
        'Run `node src/index.js both` to serve and negotiate from one process, or set STORE=mysql.\n',
    );
    process.exitCode = 1;
    return;
  }

  const container = createContainer({ config });
  const { logger, services, repositories, interpreter, tools, runner } = container;

  logger.info('starting', {
    mode,
    env: config.env,
    store: repositories.kind,
    llmProvider: interpreter.provider,
    agentEnabled: config.agent.enabled,
    dryRun: config.agent.dryRun,
    paypal: config.paypal.enabled ? config.paypal.env : 'off',
  });
  if (repositories.kind === 'memory') {
    logger.warn('in-memory store: no database is used, and all data is lost when this process stops');
  }

  let server = null;

  if (mode === 'web' || mode === 'both') {
    const app = createApp({ config, services, repositories, interpreter, tools, logger });
    server = app.listen(config.port, () => {
      logger.info('http listening', { port: config.port });
    });
  }

  if (mode === 'worker' || mode === 'both') {
    runner.start();
  }

  const shutdown = async (signal) => {
    logger.info('shutting down', { signal });
    runner.stop();
    if (server) await new Promise((resolve) => server.close(resolve));
    await repositories.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
