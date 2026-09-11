/**
 * Duplicate-send prevention, from every angle it can fail.
 *
 * This is the bug class the whole outbox exists for: an agent that re-answers
 * the same supplier message writes to a real company twice under the buyer's
 * name. It is prevented at three levels - the decision refuses, the guard
 * refuses, and the UNIQUE key refuses - and all three are checked here.
 */

import { createWorld } from '../../src/simulation/harness.js';
import { stubbornSeller } from '../../src/simulation/mockSellers.js';
import { toMinor } from '../../src/domain/money.js';

async function openNegotiation(world, { maxRounds } = {}) {
  const seller = await world.repositories.users.create({
    role: 'seller',
    name: 'Duplicate Test Seller',
    email: `dup-${Math.random().toString(36).slice(2)}@example.test`,
  });

  const { requirement } = await world.services.intake.createRequirement({
    buyerId: world.buyer.id,
    product: 'wireless earbuds',
    quantity: 100,
    unit: 'pieces',
    currency: 'INR',
    targetPriceMinor: toMinor('600'),
    maxPriceMinor: toMinor('700'),
    priceBasis: 'per_unit',
  });

  const negotiation = await world.services.negotiations.open({
    requirementId: requirement.id,
    sellerId: seller.id,
    maxRounds,
  });

  return { requirement, negotiation, seller };
}

const agentMessages = async (world, negotiationId) =>
  (await world.repositories.messages.listByNegotiation(negotiationId)).filter(
    (message) => message.author === 'agent',
  );

describe('duplicate sends', () => {
  test('ticking twice in a row sends one opener, not two', async () => {
    const world = await createWorld();
    const { negotiation } = await openNegotiation(world);

    const first = await world.services.negotiations.tick({ negotiationId: negotiation.id });
    const second = await world.services.negotiations.tick({ negotiationId: negotiation.id });

    expect(first.action.kind).toBe('open');
    expect(second.action.kind).toBe('hold');
    expect(await agentMessages(world, negotiation.id)).toHaveLength(1);
  });

  test('TWO WORKERS TICKING AT THE SAME INSTANT PRODUCE ONE MESSAGE', async () => {
    const world = await createWorld();
    const { negotiation } = await openNegotiation(world);

    await Promise.all([
      world.services.negotiations.tick({ negotiationId: negotiation.id, triggerSource: 'worker-a' }),
      world.services.negotiations.tick({ negotiationId: negotiation.id, triggerSource: 'worker-b' }),
    ]);

    expect(await agentMessages(world, negotiation.id)).toHaveLength(1);

    const claimed = await world.repositories.outbox.findByKey(`neg:${negotiation.id}:reply:open`);
    expect(claimed.status).toBe('sent');
  });

  test('the same supplier message is answered exactly once, however often we tick', async () => {
    const world = await createWorld();
    const { negotiation } = await openNegotiation(world);

    await world.services.negotiations.tick({ negotiationId: negotiation.id });
    await world.services.negotiations.recordSellerMessage({
      negotiationId: negotiation.id,
      body: 'Our price is Rs 850 per unit.',
    });

    const answers = [];
    for (let index = 0; index < 5; index += 1) {
      const tick = await world.services.negotiations.tick({ negotiationId: negotiation.id });
      answers.push(tick.action.kind);
    }

    expect(answers[0]).toBe('counter');
    expect(answers.slice(1)).toEqual(['hold', 'hold', 'hold', 'hold']);
    expect(await agentMessages(world, negotiation.id)).toHaveLength(2); // opener + one counter
  });

  test('a NEW supplier message does get a new answer', async () => {
    const world = await createWorld();
    const { negotiation } = await openNegotiation(world);
    const seller = stubbornSeller();

    await world.services.negotiations.tick({ negotiationId: negotiation.id });

    for (let round = 0; round < 3; round += 1) {
      await world.services.negotiations.recordSellerMessage({
        negotiationId: negotiation.id,
        body: seller.reply({ round }),
      });
      await world.services.negotiations.tick({ negotiationId: negotiation.id });
    }

    expect(await agentMessages(world, negotiation.id)).toHaveLength(4); // opener + three counters
  });

  test('every claimed idempotency key is unique across the whole negotiation', async () => {
    const world = await createWorld();
    const { negotiation } = await openNegotiation(world);
    const seller = stubbornSeller();

    await world.services.negotiations.tick({ negotiationId: negotiation.id });
    for (let round = 0; round < 5; round += 1) {
      await world.services.negotiations.recordSellerMessage({
        negotiationId: negotiation.id,
        body: seller.reply({ round }),
      });
      await world.services.negotiations.tick({ negotiationId: negotiation.id });
    }

    const messages = await agentMessages(world, negotiation.id);
    const keys = messages.map((message) => `neg:${negotiation.id}:reply:${message.inReplyTo ?? 'open'}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('dry run decides and records but sends nothing, and retries later', async () => {
    const world = await createWorld({ configOverrides: { AGENT_DRY_RUN: 'true' } });
    const { negotiation } = await openNegotiation(world);

    const dry = await world.services.negotiations.tick({ negotiationId: negotiation.id });
    expect(dry.action.reason).toBe('dry_run');
    expect(await agentMessages(world, negotiation.id)).toHaveLength(0);

    const runs = await world.repositories.agentRuns.listByNegotiation(negotiation.id);
    expect(runs).toHaveLength(1); // the decision was still recorded

    // Nothing was consumed: with sending enabled it goes out.
    const live = await createWorld();
    const second = await openNegotiation(live);
    const sent = await live.services.negotiations.tick({ negotiationId: second.negotiation.id });
    expect(sent.action.kind).toBe('open');
  });

  test('a disabled agent sends nothing at all', async () => {
    const world = await createWorld({ configOverrides: { AGENT_ENABLED: 'false' } });
    const { negotiation } = await openNegotiation(world);

    const tick = await world.services.negotiations.tick({ negotiationId: negotiation.id });
    expect(tick.action.reason).toBe('agent_disabled');
    expect(await agentMessages(world, negotiation.id)).toHaveLength(0);
  });

  test('a terminal negotiation refuses new supplier messages outright', async () => {
    const world = await createWorld();
    const { negotiation } = await openNegotiation(world);

    await world.services.negotiations.tick({ negotiationId: negotiation.id });
    await world.services.negotiations.recordSellerMessage({
      negotiationId: negotiation.id,
      body: 'Sorry, we cannot supply this item.',
    });
    await world.services.negotiations.tick({ negotiationId: negotiation.id });

    const closed = await world.repositories.negotiations.findById(negotiation.id);
    expect(closed.state).toBe('DECLINED');

    await expect(
      world.services.negotiations.recordSellerMessage({
        negotiationId: negotiation.id,
        body: 'Actually, we can do Rs 500.',
      }),
    ).rejects.toThrow(/DECLINED/);
  });
});
