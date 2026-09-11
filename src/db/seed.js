#!/usr/bin/env node
/**
 * Seed data for a local run: one buyer, three suppliers, one open requirement
 * with a negotiation against each supplier.
 *
 * Idempotent - re-running it reuses the users it already created, so it is safe
 * to run after every migration.
 */

import { loadConfig } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { createRepositories } from '../repositories/index.js';
import { toMinor } from '../domain/money.js';

const BUYER = { role: 'buyer', name: 'Demo Buyer', email: 'buyer@example.test', company: 'Demo Trading Co' };

const SELLERS = [
  { role: 'seller', name: 'Supplier One', email: 'seller1@example.test', company: 'Northline Electronics' },
  { role: 'seller', name: 'Supplier Two', email: 'seller2@example.test', company: 'Harbour Components' },
  { role: 'seller', name: 'Supplier Three', email: 'seller3@example.test', company: 'Peak Audio Supply' },
];

async function ensureUser(repositories, user) {
  const existing = await repositories.users.findByEmail(user.email);
  return existing ?? repositories.users.create(user);
}

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const repositories = createRepositories({ driver: 'mysql', db: config.db });

  try {
    const buyer = await ensureUser(repositories, BUYER);
    const sellers = [];
    for (const seller of SELLERS) sellers.push(await ensureUser(repositories, seller));

    const requirement = await repositories.requirements.create({
      buyerId: buyer.id,
      product: 'wireless earbuds',
      quantity: 100,
      unit: 'pieces',
      currency: 'INR',
      targetPriceMinor: toMinor('600'),
      maxPriceMinor: toMinor('700'),
      priceBasis: 'per_unit',
      status: 'active',
      sourceText:
        'I need 100 wireless earbuds. My target is 600 per unit and my maximum budget is 700 per unit.',
    });

    const negotiations = [];
    for (const seller of sellers) {
      negotiations.push(
        await repositories.negotiations.create({
          requirementId: requirement.id,
          sellerId: seller.id,
          maxRounds: config.agent.maxRounds,
        }),
      );
    }

    logger.info('seed complete', {
      buyerId: buyer.id,
      sellerIds: sellers.map((s) => s.id),
      requirementId: requirement.id,
      negotiationIds: negotiations.map((n) => n.id),
    });

    process.stdout.write(
      [
        '',
        'Seeded. Try:',
        `  curl localhost:${config.port}/health`,
        `  curl -H "x-api-key: $API_KEY" localhost:${config.port}/api/requirements/${requirement.id}`,
        `  curl -X POST -H "x-api-key: $API_KEY" localhost:${config.port}/api/negotiations/${negotiations[0].id}/tick`,
        '',
      ].join('\n'),
    );
  } finally {
    await repositories.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
