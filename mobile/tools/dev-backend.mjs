/**
 * A development backend for exercising the mobile app.
 *
 * This starts the REAL Express app, the real services, the real decision core
 * and the real guards - it only swaps the MySQL store for the in-memory one,
 * which is a first-class implementation of the same repository contract and
 * the store the backend's own API integration tests run against. No backend
 * file is modified or imported in any way other than through its public
 * composition root.
 *
 * Usage:  node mobile/tools/dev-backend.mjs
 *
 * It seeds one buyer (id 1) and three suppliers (ids 2, 3, 4) so the app has
 * something to point at, then prints the ids and the LAN addresses a device
 * can reach.
 */

import { networkInterfaces } from 'node:os';

import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';
import { createContainer } from '../../src/container.js';
import { createApp } from '../../src/http/app.js';

const API_KEY = process.env.DEV_API_KEY ?? 'dev-key';
const PORT = process.env.DEV_PORT ?? '3000';

const config = loadConfig({
  NODE_ENV: 'development',
  PORT,
  LOG_LEVEL: 'info',
  API_KEY,
  // No Anthropic key here: the rules engine is the interpreter, which is the
  // same path the shipped default takes when no key is configured.
  LLM_PROVIDER: 'rules',
  AGENT_ENABLED: 'true',
  AGENT_DRY_RUN: 'false',
  AGENT_MAX_ROUNDS: '6',
});

const logger = createLogger({ level: config.logLevel });

const container = createContainer({
  config,
  driver: 'memory',
  logger,
});

const { repositories, services, interpreter, tools } = container;

const buyer = await repositories.users.create({
  role: 'buyer',
  name: 'Demo Buyer',
  email: 'buyer@example.test',
  company: 'Demo Trading Co',
});

const sellers = [];
for (const seller of [
  { name: 'Supplier One', email: 'seller1@example.test', company: 'Northline Electronics' },
  { name: 'Supplier Two', email: 'seller2@example.test', company: 'Harbour Components' },
  { name: 'Supplier Three', email: 'seller3@example.test', company: 'Peak Audio Supply' },
]) {
  sellers.push(await repositories.users.create({ role: 'seller', ...seller }));
}

const app = createApp({ config, services, repositories, interpreter, tools, logger });

app.listen(Number(PORT), '0.0.0.0', () => {
  const addresses = ['127.0.0.1'];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }

  process.stdout.write(
    [
      '',
      '='.repeat(66),
      '  DEV BACKEND (in-memory store, rules interpreter)',
      '='.repeat(66),
      `  buyer id      : ${buyer.id}`,
      `  supplier ids  : ${sellers.map((s) => s.id).join(', ')}`,
      `  api key       : ${API_KEY}`,
      `  interpreter   : ${interpreter.provider}`,
      '',
      '  reachable at:',
      ...addresses.map((address) => `    http://${address}:${PORT}`),
      '='.repeat(66),
      '',
    ].join('\n'),
  );
});
