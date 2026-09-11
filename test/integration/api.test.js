/**
 * The HTTP surface, against the real services and an in-memory store.
 *
 * No database and no API key needed, which means these run in CI on a clean
 * checkout - and they still exercise every layer below the router.
 */

import request from 'supertest';

import { createApp } from '../../src/http/app.js';
import { createWorld } from '../../src/simulation/harness.js';

const KEY = 'simulation-key';

async function setup(configOverrides = {}) {
  const world = await createWorld({ configOverrides });
  const app = createApp({
    config: world.config,
    services: world.services,
    repositories: world.repositories,
    interpreter: world.interpreter,
    tools: world.tools,
    logger: null,
  });

  const seller = await world.repositories.users.create({
    role: 'seller',
    name: 'API Seller',
    email: `api-seller-${Math.random().toString(36).slice(2)}@example.test`,
  });

  return { world, app, seller };
}

const auth = (agent) => agent.set('x-api-key', KEY);

async function createRequirement(app, buyerId, overrides = {}) {
  const response = await auth(request(app).post('/api/requirements')).send({
    buyer_id: buyerId,
    product: 'wireless earbuds',
    quantity: 100,
    unit: 'pieces',
    currency: 'INR',
    target_price: '600',
    max_price: '700',
    price_basis: 'per_unit',
    ...overrides,
  });
  return response;
}

describe('health', () => {
  test('reports the interpreter and the agent switches without a key', async () => {
    const { app } = await setup();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.llm.provider).toBe('rules');
    expect(response.body.agent.max_rounds).toBe(6);
  });
});

describe('auth', () => {
  test('the API needs the key; health does not', async () => {
    const { app } = await setup();
    await expect(request(app).get('/api/requirements/1').then((r) => r.status)).resolves.toBe(401);
    await expect(request(app).get('/health').then((r) => r.status)).resolves.toBe(200);
  });
});

describe('requirements', () => {
  test('creates one and returns money three ways', async () => {
    const { app, world } = await setup();
    const response = await createRequirement(app, world.buyer.id);

    expect(response.status).toBe(201);
    expect(response.body.requirement.target_price).toEqual({
      minor: 60000,
      amount: '600.00',
      display: '₹600.00',
    });
  });

  test('REFUSES A MAXIMUM BELOW THE TARGET', async () => {
    const { app, world } = await setup();
    const response = await createRequirement(app, world.buyer.id, { max_price: '500' });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/maximum cannot be below the target/i);
  });

  test('REQUIRES AN EXPLICIT PRICE BASIS', async () => {
    const { app, world } = await setup();
    const response = await auth(request(app).post('/api/requirements')).send({
      buyer_id: world.buyer.id,
      product: 'wireless earbuds',
      target_price: '600',
      max_price: '700',
    });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body.error.details)).toMatch(/price_basis/);
  });

  test('refuses a total-basis budget with no quantity', async () => {
    const { app, world } = await setup();
    const response = await createRequirement(app, world.buyer.id, {
      price_basis: 'total',
      quantity: 0,
    });

    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/quantity/i);
  });

  test('reading free text proposes a requirement and creates nothing', async () => {
    const { app, world } = await setup();
    const response = await auth(request(app).post('/api/requirements/read')).send({
      text: 'I need 100 wireless earbuds. My target is 600 per unit and my maximum budget is 700 per unit.',
    });

    expect(response.status).toBe(200);
    expect(response.body.reading.targetPriceMinor).toBe(60000);
    expect(response.body.note).toMatch(/Nothing has been created/i);

    const stored = await world.repositories.requirements.listByBuyer(world.buyer.id);
    expect(stored).toHaveLength(0);
  });

  test('an ambiguous budget is reported as not ready, with a question', async () => {
    const { app } = await setup();
    const response = await auth(request(app).post('/api/requirements/read')).send({
      text: 'I want 5 chairs, budget 10000.',
    });

    expect(response.body.ready).toBe(false);
    expect(response.body.unverified).toContain('price_basis');
    expect(response.body.question).toMatch(/per unit, or for the whole order/i);
  });
});

describe('a negotiation over HTTP', () => {
  test('open, tick, reply, tick, and read the audit trail', async () => {
    const { app, world, seller } = await setup();
    const requirement = (await createRequirement(app, world.buyer.id)).body.requirement;

    const opened = await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send(
      { seller_id: seller.id },
    );
    expect(opened.status).toBe(201);
    const negotiationId = opened.body.negotiation.id;

    const first = await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    expect(first.body.action).toBe('open');
    expect(first.body.message.author).toBe('agent');

    await auth(request(app).post(`/api/negotiations/${negotiationId}/seller-messages`)).send({
      body: 'We can supply 100 pieces at Rs 850 per unit.',
    });

    const second = await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    expect(second.body.action).toBe('counter');
    expect(second.body.message.price.display).toBe('₹650.00');
    expect(second.body.message.body).not.toContain('700');

    const runs = await auth(request(app).get(`/api/negotiations/${negotiationId}/runs`));
    expect(runs.body.runs).toHaveLength(2);
    expect(runs.body.runs[1].reason).toBe('improve_price');

    const messages = await auth(request(app).get(`/api/negotiations/${negotiationId}/messages`));
    expect(messages.body.messages.map((m) => m.author)).toEqual(['agent', 'seller', 'agent']);
  });

  test('a structured price is used as given, with no interpretation needed', async () => {
    const { app, world, seller } = await setup({ LLM_PROVIDER: 'off' });
    const requirement = (await createRequirement(app, world.buyer.id)).body.requirement;
    const opened = await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send(
      { seller_id: seller.id },
    );
    const negotiationId = opened.body.negotiation.id;

    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    await auth(request(app).post(`/api/negotiations/${negotiationId}/seller-messages`)).send({
      body: 'Our quote is attached.',
      price: '850',
    });

    const tick = await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    expect(tick.body.action).toBe('counter');
    expect(tick.body.message.price.minor).toBe(65000);
  });
});

describe('acceptance is a buyer action', () => {
  test('the buyer can accept, and it is recorded as the buyer', async () => {
    const { app, world, seller } = await setup();
    const requirement = (await createRequirement(app, world.buyer.id)).body.requirement;
    const opened = await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send(
      { seller_id: seller.id },
    );
    const negotiationId = opened.body.negotiation.id;

    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    await auth(request(app).post(`/api/negotiations/${negotiationId}/seller-messages`)).send({
      body: 'We can do Rs 660 per unit.',
    });
    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});

    const accepted = await auth(request(app).post(`/api/negotiations/${negotiationId}/accept`))
      .set('x-user-id', String(world.buyer.id))
      .send({});

    expect(accepted.status).toBe(200);
    expect(accepted.body.message.author).toBe('buyer');
    expect(accepted.body.message.kind).toBe('accept');
  });

  test('ACCEPTING REQUIRES AN IDENTITY, AND IT MUST BE THE OWNER', async () => {
    const { app, world, seller } = await setup();
    const requirement = (await createRequirement(app, world.buyer.id)).body.requirement;
    const opened = await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send(
      { seller_id: seller.id },
    );
    const negotiationId = opened.body.negotiation.id;

    const anonymous = await auth(request(app).post(`/api/negotiations/${negotiationId}/accept`)).send({});
    expect(anonymous.status).toBe(401);

    const impostor = await auth(request(app).post(`/api/negotiations/${negotiationId}/accept`))
      .set('x-user-id', String(seller.id))
      .send({});
    expect(impostor.status).toBe(409);
  });

  test('there is nothing to accept before a supplier has quoted', async () => {
    const { app, world, seller } = await setup();
    const requirement = (await createRequirement(app, world.buyer.id)).body.requirement;
    const opened = await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send(
      { seller_id: seller.id },
    );

    const response = await auth(
      request(app).post(`/api/negotiations/${opened.body.negotiation.id}/accept`),
    )
      .set('x-user-id', String(world.buyer.id))
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/no supplier price/i);
  });
});

describe('the tool surface over HTTP', () => {
  test('lists the tools and says what is missing from the list', async () => {
    const { app } = await setup();
    const response = await auth(request(app).get('/api/tools'));

    expect(response.body.tools.map((tool) => tool.name)).not.toContain('accept_deal');
    expect(response.body.note).toMatch(/no accept_deal tool/i);
  });

  test('an unknown tool is a 404, not a silent no-op', async () => {
    const { app } = await setup();
    const response = await auth(request(app).post('/api/tools/accept_deal')).send({});
    expect(response.status).toBe(404);
  });
});

describe('errors', () => {
  test('unknown routes and missing rows are clean 404s', async () => {
    const { app } = await setup();
    expect((await auth(request(app).get('/api/nope'))).status).toBe(404);
    expect((await auth(request(app).get('/api/requirements/999999'))).status).toBe(404);
  });
});
