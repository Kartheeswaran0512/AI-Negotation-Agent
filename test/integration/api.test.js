/**
 * The HTTP surface, against the real services and an in-memory store.
 *
 * No database and no API key needed, which means these run in CI on a clean
 * checkout - and they still exercise every layer below the router.
 */

import request from 'supertest';

import { createApp } from '../../src/http/app.js';
import { createWorld } from '../../src/simulation/harness.js';
import { PayPalError } from '../../src/payments/paypal.js';
import { createToolkitClient, withToolkit } from '../../src/payments/toolkit.js';

const KEY = 'simulation-key';

async function setup(configOverrides = {}, { paypal = null } = {}) {
  const world = await createWorld({ configOverrides, paypal });
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
    expect(response.body.store).toBe('memory');
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
    // PayPal is not configured in this world: acceptance only, no order.
    expect(accepted.body.payment).toBeNull();
    expect(accepted.body.approveUrl).toBeNull();

    const again = await auth(request(app).post(`/api/negotiations/${negotiationId}/accept`))
      .set('x-user-id', String(world.buyer.id))
      .send({});
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already been accepted/i);
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

/** PayPal, as far as the app can tell. Records every call. */
function fakePayPal() {
  const fake = {
    calls: { create: [], capture: [], invoice: [] },
    failNextCreate: false,
    captureError: null,
    captureStatus: 'COMPLETED',
    invoiceError: null,
    async createInvoice(invoice) {
      fake.calls.invoice.push(invoice);
      if (fake.invoiceError) {
        const error = fake.invoiceError;
        fake.invoiceError = null;
        throw error;
      }
      return { invoiceId: `INV2-TEST-${fake.calls.invoice.length}`, status: 'DRAFT' };
    },
    async createOrder(order) {
      fake.calls.create.push(order);
      if (fake.failNextCreate) {
        fake.failNextCreate = false;
        throw new PayPalError('PayPal POST /v2/checkout/orders returned 503', { status: 503 });
      }
      const orderId = `ORDER${fake.calls.create.length}`;
      return {
        orderId,
        status: 'PAYER_ACTION_REQUIRED',
        approveUrl: `https://www.sandbox.paypal.com/checkoutnow?token=${orderId}`,
      };
    },
    async captureOrder(orderId, options) {
      fake.calls.capture.push({ orderId, ...options });
      if (fake.captureError) throw fake.captureError;
      return { orderId, status: 'COMPLETED', captureId: `CAP-${orderId}`, captureStatus: fake.captureStatus };
    },
  };
  return fake;
}

describe('paying for an accepted deal with PayPal', () => {
  /** A negotiation where the supplier has quoted Rs 660 per unit, for 100 units. */
  async function quoted({ requirement: overrides = {} } = {}) {
    const paypal = fakePayPal();
    const { app, world, seller } = await setup({}, { paypal });
    const requirement = (await createRequirement(app, world.buyer.id, overrides)).body.requirement;
    const opened = await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send(
      { seller_id: seller.id },
    );
    const negotiationId = opened.body.negotiation.id;

    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    await auth(request(app).post(`/api/negotiations/${negotiationId}/seller-messages`)).send({
      body: 'We can do Rs 660 per unit.',
    });
    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});

    const accept = () =>
      auth(request(app).post(`/api/negotiations/${negotiationId}/accept`))
        .set('x-user-id', String(world.buyer.id))
        .send({});
    const acceptances = async () =>
      (await auth(request(app).get(`/api/negotiations/${negotiationId}/messages`))).body.messages.filter(
        (m) => m.kind === 'accept',
      );
    const payment = async () =>
      (await auth(request(app).get(`/api/negotiations/${negotiationId}/payment`))).body.payment;

    return { app, world, paypal, negotiationId, accept, acceptances, payment };
  }

  test('accept opens a PayPal order in USD and returns where to pay', async () => {
    const { paypal, negotiationId, accept } = await quoted();
    const response = await accept();

    expect(response.status).toBe(200);
    expect(response.body.message.kind).toBe('accept');
    expect(response.body.approveUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=ORDER1');
    expect(response.body.payment).toMatchObject({
      status: 'CREATED',
      order_id: 'ORDER1',
      currency: 'USD',
      deal_currency: 'INR',
    });
    // 100 x Rs 660 = Rs 66000.00, at the default 85 INR/USD.
    expect(response.body.payment.deal_amount.display).toBe('₹66000.00');
    expect(response.body.payment.amount.display).toBe('$776.47');

    expect(paypal.calls.create).toHaveLength(1);
    expect(paypal.calls.create[0]).toMatchObject({
      amountMinor: 77647,
      currency: 'USD',
      referenceId: `negotiation-${negotiationId}`,
      returnUrl: 'http://localhost:3000/paid',
      cancelUrl: 'http://localhost:3000/cancelled',
    });
  });

  test('THE SAME NEGOTIATION ID IN ANOTHER DATABASE IS NOT THE SAME PAYPAL ORDER', async () => {
    // Two fresh stores both number their first negotiation 1. PayPal would
    // return the first store's order to the second if the request id were
    // built from that id alone.
    const first = await quoted();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await quoted();
    await first.accept();
    await second.accept();

    expect(String(first.negotiationId)).toBe(String(second.negotiationId));
    expect(first.paypal.calls.create[0].requestId).not.toBe(second.paypal.calls.create[0].requestId);
    expect(first.paypal.calls.create[0].requestId).toMatch(/77647USD$/);
  });

  test('accepting again before paying resumes the same order', async () => {
    const { paypal, accept, acceptances } = await quoted();
    const first = await accept();
    const second = await accept();

    expect(second.status).toBe(200);
    expect(second.body.approveUrl).toBe(first.body.approveUrl);
    expect(paypal.calls.create).toHaveLength(1);
    expect(await acceptances()).toHaveLength(1);
  });

  test('GET /paid captures the order, marks it PAID, and is safe to repeat', async () => {
    const { app, paypal, negotiationId, accept, payment } = await quoted();
    await accept();

    const returned = await request(app).get('/paid?token=ORDER1&PayerID=BUYER1');
    expect(returned.status).toBe(303);
    expect(returned.headers.location).toBe(`/?payment=PAID&negotiation=${negotiationId}`);

    const paid = await payment();
    expect(paid.status).toBe('PAID');
    expect(paid.capture_id).toBe('CAP-ORDER1');
    expect(paid.paid_at).not.toBeNull();
    expect(paid.approve_url).toBeNull();

    // A refresh of the return page does not capture twice.
    const refreshed = await request(app).get('/paid?token=ORDER1&PayerID=BUYER1');
    expect(refreshed.headers.location).toBe(`/?payment=PAID&negotiation=${negotiationId}`);
    expect(paypal.calls.capture).toHaveLength(1);
    // Keyed on PayPal's globally unique order id, not on our own row id.
    expect(paypal.calls.capture[0].requestId).toBe('capture-ORDER1');

    const afterPaying = await accept();
    expect(afterPaying.status).toBe(409);
    expect(afterPaying.body.error.message).toMatch(/already been paid/i);
  });

  test('a paid deal gets ONE PayPal invoice for the agreed amount, shown on the payment', async () => {
    const { app, paypal, negotiationId, accept, payment } = await quoted();
    await accept();
    await request(app).get('/paid?token=ORDER1');

    const paid = await payment();
    expect(paid.status).toBe('PAID');
    expect(paid.invoice).toEqual({ id: 'INV2-TEST-1', status: 'DRAFT', via: 'rest' });
    expect(paid.created_via).toBe('rest');

    const { round } = (await auth(request(app).get(`/api/negotiations/${negotiationId}`))).body.negotiation;
    const [invoice] = paypal.calls.invoice;
    expect(invoice).toMatchObject({
      invoiceNumber: 'NEG-ORDER1',
      currency: 'USD',
      amountMinor: 77647,
      itemName: 'Wireless earbuds x 100 pieces',
      requestId: 'invoice-ORDER1',
    });
    // Product, quantity, unit price and rounds used - and never the buyer's limits.
    expect(invoice.itemDescription).toContain('100 pieces of wireless earbuds at ₹660.00 per piece');
    expect(invoice.itemDescription).toContain('₹66000.00 in total');
    expect(invoice.itemDescription).toContain(`after ${round} negotiation round`);
    expect(invoice.itemDescription).toContain('Charged as $776.47');
    expect(JSON.stringify(invoice)).not.toMatch(/600\.00|700\.00/);
    expect(invoice.note).toContain('capture CAP-ORDER1');

    await request(app).get('/paid?token=ORDER1');
    expect(paypal.calls.invoice).toHaveLength(1);
  });

  test('AN INVOICE FAILURE NEVER UN-PAYS A DEAL, and the next return to /paid retries it', async () => {
    const { app, paypal, accept, payment } = await quoted();
    await accept();
    paypal.invoiceError = new PayPalError('PayPal POST /v2/invoicing/invoices returned 500', { status: 500 });

    const first = await request(app).get('/paid?token=ORDER1');
    expect(first.headers.location).toMatch(/payment=PAID/);
    const afterFailure = await payment();
    expect(afterFailure.status).toBe('PAID');
    expect(afterFailure.invoice).toBeNull();
    // The reason is kept on the payment, visible without the server logs.
    expect(afterFailure.invoice_error.message).toMatch(/invoicing\/invoices returned 500/);
    expect(afterFailure.invoice_error.attempted_at).not.toBeNull();

    await request(app).get('/paid?token=ORDER1');
    const invoiced = await payment();
    expect(invoiced.invoice.id).toBe('INV2-TEST-2');
    expect(invoiced.invoice_error).toBeNull();
    expect(paypal.calls.capture).toHaveLength(1);
  });

  test('a payment PayPal has not approved is not marked paid', async () => {
    const { app, paypal, accept, payment } = await quoted();
    await accept();
    paypal.captureError = new PayPalError('PayPal returned 422 (ORDER_NOT_APPROVED)', {
      status: 422,
      issue: 'ORDER_NOT_APPROVED',
    });

    const returned = await request(app).get('/paid?token=ORDER1');
    const params = new URL(returned.headers.location, 'http://x').searchParams;

    expect(params.get('payment')).toBe('error');
    expect(params.get('message')).toMatch(/not approved/i);
    expect((await payment()).status).toBe('CREATED');
  });

  test('a capture PayPal holds for review is recorded as PENDING, not PAID', async () => {
    const { app, paypal, accept, payment } = await quoted();
    await accept();
    paypal.captureStatus = 'PENDING';

    const returned = await request(app).get('/paid?token=ORDER1');
    expect(returned.headers.location).toMatch(/payment=PENDING/);
    expect((await payment()).status).toBe('PENDING');
  });

  test('unknown and malformed tokens go back to the page with an error', async () => {
    const { app, paypal } = await quoted();

    const unknown = await request(app).get('/paid?token=NOTOURS');
    expect(unknown.status).toBe(303);
    expect(unknown.headers.location).toMatch(/payment=error/);

    const malformed = await request(app).get('/paid?token=../../v1/oauth2');
    expect(malformed.headers.location).toMatch(/payment=error/);
    expect(paypal.calls.capture).toHaveLength(0);
  });

  test('if PayPal fails, the deal stays accepted and accepting again retries the payment', async () => {
    const { app, paypal, negotiationId, accept, acceptances } = await quoted();
    paypal.failNextCreate = true;

    const failed = await accept();
    expect(failed.status).toBe(502);
    expect(failed.body.error.message).toMatch(/PayPal did not create the order/);

    const negotiation = await auth(request(app).get(`/api/negotiations/${negotiationId}`));
    expect(negotiation.body.negotiation.outcome).toBe('accepted_by_buyer');

    const retried = await accept();
    expect(retried.status).toBe(200);
    expect(retried.body.approveUrl).toMatch(/sandbox\.paypal\.com/);
    expect(await acceptances()).toHaveLength(1);
  });

  test('NOTHING IS ACCEPTED THAT CANNOT BE CHARGED: no quantity, no order total', async () => {
    const { app, paypal, negotiationId, accept, acceptances } = await quoted({
      requirement: { quantity: 0 },
    });

    const response = await accept();
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/no quantity/i);

    const negotiation = await auth(request(app).get(`/api/negotiations/${negotiationId}`));
    expect(negotiation.body.negotiation.outcome).not.toBe('accepted_by_buyer');
    expect(await acceptances()).toHaveLength(0);
    expect(paypal.calls.create).toHaveLength(0);
  });

  test('cancelling on PayPal goes back to the page', async () => {
    const { app } = await quoted();
    const response = await request(app).get('/cancelled?token=ORDER1');
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/?payment=cancelled');
  });

  test('the payment needs the API key; the page and health do not', async () => {
    const { app, negotiationId } = await quoted();

    const payment = await request(app).get(`/api/negotiations/${negotiationId}/payment`);
    expect(payment.status).toBe(401);

    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/html/);
    expect(page.text).toMatch(/Accept and pay/);
  });
});

describe('the PayPal Agent Toolkit path (PAYPAL_USE_TOOLKIT)', () => {
  /** The real toolkit wrapper over a fake toolkit module, with a fake REST client behind it. */
  function toolkitBackedPayPal({ failOrders = false } = {}) {
    const executed = [];
    class PayPalAgentToolkit {
      constructor(options) {
        this.options = options;
      }
      getTools() {
        const context = this.options.configuration.context;
        return {
          create_order: {
            execute: async (params) => {
              executed.push({ method: 'create_order', params, context });
              if (failOrders) return JSON.stringify({ ok: false, status: 500, code: 'PAYPAL_API_HTTP_ERROR', message: 'boom' });
              return JSON.stringify({
                id: 'ORDERTK1',
                status: 'PAYER_ACTION_REQUIRED',
                links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDERTK1' }],
              });
            },
          },
          create_invoice: {
            execute: async (params) => {
              executed.push({ method: 'create_invoice', params, context });
              return JSON.stringify({ rel: 'self', href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-TOOL-KIT1-AAAA-BBBB', method: 'GET' });
            },
          },
        };
      }
    }
    const rest = fakePayPal();
    const toolkit = createToolkitClient({
      clientId: 'id',
      clientSecret: 'secret',
      loadToolkit: async () => ({ PayPalAgentToolkit }),
    });
    return { paypal: withToolkit({ rest, toolkit }), rest, executed };
  }

  async function quotedWith(paypal) {
    const { app, world, seller } = await setup({}, { paypal });
    const requirement = (await createRequirement(app, world.buyer.id)).body.requirement;
    const negotiationId = (
      await auth(request(app).post(`/api/requirements/${requirement.id}/negotiations`)).send({ seller_id: seller.id })
    ).body.negotiation.id;
    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    await auth(request(app).post(`/api/negotiations/${negotiationId}/seller-messages`)).send({
      body: 'We can do Rs 660 per unit.',
    });
    await auth(request(app).post(`/api/negotiations/${negotiationId}/tick`)).send({});
    const acceptAs = (userId) =>
      auth(request(app).post(`/api/negotiations/${negotiationId}/accept`)).set('x-user-id', String(userId)).send({});
    return { app, world, seller, negotiationId, acceptAs };
  }

  test('THE TOOLKIT IS CALLED ONLY AFTER THE BUYER APPROVES - never while the agent negotiates', async () => {
    const { paypal, executed } = toolkitBackedPayPal();
    const { app, world, seller, negotiationId, acceptAs } = await quotedWith(paypal);

    // Two agent ticks and a supplier reply later: not one toolkit call.
    expect(executed).toHaveLength(0);

    // Someone who is not the buyer cannot get past acceptance to the toolkit.
    expect((await acceptAs(seller.id)).status).toBe(409);
    expect(executed).toHaveLength(0);

    const accepted = await acceptAs(world.buyer.id);
    expect(accepted.status).toBe(200);
    expect(accepted.body.approveUrl).toBe('https://www.sandbox.paypal.com/checkoutnow?token=ORDERTK1');
    expect(accepted.body.payment.created_via).toBe('toolkit');
    expect(executed.map((e) => e.method)).toEqual(['create_order']);
    expect(executed[0].context.request_id).toMatch(new RegExp(`^neg-${negotiationId}-`));

    // Paid: capture goes through REST, the invoice through the toolkit.
    await request(app).get('/paid?token=ORDERTK1');
    const payment = (await auth(request(app).get(`/api/negotiations/${negotiationId}/payment`))).body.payment;
    expect(payment.status).toBe('PAID');
    expect(payment.invoice).toEqual({ id: 'INV2-TOOL-KIT1-AAAA-BBBB', status: 'DRAFT', via: 'toolkit' });
    expect(executed.map((e) => e.method)).toEqual(['create_order', 'create_invoice']);
  });

  test('if the toolkit fails, the REST API creates the order instead', async () => {
    const { paypal, rest, executed } = toolkitBackedPayPal({ failOrders: true });
    const { world, acceptAs } = await quotedWith(paypal);

    const accepted = await acceptAs(world.buyer.id);
    expect(accepted.status).toBe(200);
    expect(accepted.body.payment.created_via).toBe('rest');
    expect(accepted.body.approveUrl).toMatch(/token=ORDER1$/);
    expect(executed).toHaveLength(1);
    expect(rest.calls.create[0].requestId).toBe(executed[0].context.request_id);
  });
});

describe('the demo button, with no API key', () => {
  async function demoApp(configOverrides = {}) {
    const paypal = fakePayPal();
    const { app, world } = await setup(configOverrides, { paypal });
    const runDemo = () => request(app).post('/demo/run').send({});
    const view = (token) => request(app).get('/demo/run').set('x-demo-token', token);
    const accept = (token, negotiationId) =>
      request(app).post('/demo/accept').set('x-demo-token', token).send({ negotiation_id: negotiationId });
    return { app, world, paypal, runDemo, view, accept };
  }

  const bySupplier = (run) => Object.fromEntries(run.suppliers.map((s) => [s.supplier.name, s]));

  test('negotiates with three suppliers and shows final price and savings side by side', async () => {
    const { runDemo } = await demoApp();
    const response = await runDemo();

    expect(response.status).toBe(201);
    expect(response.body.token).toEqual(expect.any(String));

    const { run } = response.body;
    expect(run.requirement).toMatchObject({ product: 'wireless earbuds', quantity: 100, currency: 'INR' });
    expect(run.target_per_unit.display).toBe('₹600.00');
    expect(run.max_per_unit.display).toBe('₹700.00');

    const s = bySupplier(run);
    expect(Object.keys(s).sort()).toEqual(['gradual', 'questioning', 'stubborn']);

    expect(s.gradual).toMatchObject({ state: 'TARGET_MET', recommended: true, within_budget: true });
    expect(s.gradual.opening_price.display).toBe('₹850.00');
    expect(s.gradual.final_price.display).toBe('₹570.00');
    expect(s.gradual.savings_per_unit.display).toBe('₹280.00');
    expect(s.gradual.savings_total.display).toBe('₹28000.00');
    expect(s.gradual.savings_percent).toBe(32.9);
    expect(s.gradual.order_total.display).toBe('₹57000.00');

    expect(s.stubborn).toMatchObject({ state: 'ROUNDS_SPENT', within_budget: false, recommended: false });
    expect(s.stubborn.savings_per_unit.minor).toBe(0);

    expect(s.questioning).toMatchObject({ state: 'TARGET_MET', recommended: false });
    expect(s.questioning.final_price.display).toBe('₹600.00');

    // The run negotiates; it never accepts.
    expect(run.suppliers.every((x) => !x.accepted && x.payment === null)).toBe(true);
    expect(run.recommendation.decision).toBe('accept');
  });

  test('accepting the best deal opens the PayPal order, and paying shows up on the run', async () => {
    const { app, paypal, runDemo, view, accept } = await demoApp();
    const { token, run } = (await runDemo()).body;
    const best = run.suppliers.find((x) => x.recommended);

    const accepted = await accept(token, best.negotiation_id);
    expect(accepted.status).toBe(200);
    expect(accepted.body.message.author).toBe('buyer');
    expect(accepted.body.approveUrl).toMatch(/sandbox\.paypal\.com/);
    // Rs 570 x 100 = Rs 57000.00 -> $670.59 at the default demo rate.
    expect(paypal.calls.create[0].amountMinor).toBe(67059);

    const afterAccept = bySupplier((await view(token)).body.run);
    expect(afterAccept.gradual.accepted).toBe(true);
    expect(afterAccept.gradual.payment.status).toBe('CREATED');
    expect(afterAccept.questioning.accepted).toBe(false);

    await request(app).get(`/paid?token=${accepted.body.payment.order_id}`);
    expect(bySupplier((await view(token)).body.run).gradual.payment.status).toBe('PAID');
  });

  test('ONE REQUIREMENT, ONE DEAL: once one offer is accepted, another cannot be', async () => {
    const { paypal, runDemo, accept } = await demoApp();
    const { token, run } = (await runDemo()).body;
    const s = bySupplier(run);

    expect((await accept(token, s.gradual.negotiation_id)).status).toBe(200);
    const second = await accept(token, s.questioning.negotiation_id);

    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/another offer/i);
    expect(paypal.calls.create).toHaveLength(1);
  });

  test('A DEMO TOKEN OPENS ITS OWN RUN AND NOTHING ELSE', async () => {
    const { app, runDemo, view, accept } = await demoApp();
    const first = (await runDemo()).body;
    const second = (await runDemo()).body;
    const theirs = second.run.suppliers[0].negotiation_id;

    expect((await accept(first.token, theirs)).status).toBe(404);

    const [requirementId, , signature] = first.token.split('.');
    const forged = `${requirementId}.999.${signature}`;
    expect((await view(forged)).status).toBe(403);
    expect((await request(app).get('/demo/run')).status).toBe(403);

    // And it is not an API key.
    const api = await request(app).get(`/api/negotiations/${theirs}`).set('x-demo-token', first.token);
    expect(api.status).toBe(401);
  });

  test('"why the agent did this" explains every step, WITHOUT THE TARGET OR THE MAXIMUM', async () => {
    const { app, world, runDemo } = await demoApp();
    const { token, run } = (await runDemo()).body;

    for (const supplier of run.suppliers) {
      const why = await request(app)
        .get(`/demo/negotiations/${supplier.negotiation_id}/runs`)
        .set('x-demo-token', token);
      expect(why.status).toBe(200);

      const rows = await world.repositories.agentRuns.listByNegotiation(supplier.negotiation_id);
      expect(why.body.runs).toHaveLength(rows.length);
      expect(why.body.runs[0].headline).toBe('Opened the negotiation');

      const said = JSON.stringify(why.body);
      expect(said).not.toMatch(/600\.00|700\.00/);
      expect(said).not.toMatch(/"minor":(60000|70000)\b/);
      // Narrower than the audit API: no raw detail, no counter_price field.
      expect(why.body.runs.every((r) => !('detail' in r && typeof r.detail === 'object') && !('counter_price' in r))).toBe(true);
    }

    const s = bySupplier(run);
    const questioning = await request(app)
      .get(`/demo/negotiations/${s.questioning.negotiation_id}/runs`)
      .set('x-demo-token', token);
    expect(questioning.body.runs.map((r) => r.headline)).toContain('Answered their budget question');
  });

  test('a paid deal whose invoice failed shows why, and Retry invoice creates it', async () => {
    const { app, paypal, runDemo, view } = await demoApp();
    const { token, run } = (await runDemo()).body;
    const best = run.suppliers.find((x) => x.recommended);
    const accepted = await request(app).post('/demo/accept').set('x-demo-token', token).send({ negotiation_id: best.negotiation_id });

    paypal.invoiceError = new PayPalError('PayPal refused the invoice (403 NOT_AUTHORIZED): no Invoicing permission.', {
      status: 403,
      issue: 'INVOICING_PERMISSION_MISSING',
    });
    await request(app).get(`/paid?token=${accepted.body.payment.order_id}`);

    const before = bySupplier((await view(token)).body.run).gradual.payment;
    expect(before.status).toBe('PAID');
    expect(before.invoice).toBeNull();
    expect(before.invoice_error.message).toMatch(/no Invoicing permission/);

    const retried = await request(app)
      .post(`/demo/negotiations/${best.negotiation_id}/invoice`)
      .set('x-demo-token', token)
      .send({});
    expect(retried.status).toBe(200);
    expect(retried.body.payment.invoice.id).toMatch(/^INV2-TEST-/);
    expect(retried.body.payment.invoice_error).toBeNull();

    // Done once; retrying again does not raise a second invoice.
    await request(app).post(`/demo/negotiations/${best.negotiation_id}/invoice`).set('x-demo-token', token).send({});
    expect(paypal.calls.invoice).toHaveLength(2);
  });

  test('Retry invoice refuses an unpaid deal, and another run\'s deal', async () => {
    const { app, runDemo } = await demoApp();
    const first = (await runDemo()).body;
    const second = (await runDemo()).body;
    const mine = first.run.suppliers[0].negotiation_id;
    const theirs = second.run.suppliers[0].negotiation_id;

    const unpaid = await request(app).post(`/demo/negotiations/${mine}/invoice`).set('x-demo-token', first.token).send({});
    expect(unpaid.status).toBe(404);
    expect(unpaid.body.error.message).toMatch(/no payment/);

    const other = await request(app).post(`/demo/negotiations/${theirs}/invoice`).set('x-demo-token', first.token).send({});
    expect(other.status).toBe(404);
    expect(other.body.error.message).toMatch(/not part of this demo run/);
  });

  test('"why" needs the run\'s own token', async () => {
    const { app, runDemo } = await demoApp();
    const first = (await runDemo()).body;
    const second = (await runDemo()).body;
    const theirs = second.run.suppliers[0].negotiation_id;

    expect((await request(app).get(`/demo/negotiations/${theirs}/runs`).set('x-demo-token', first.token)).status).toBe(404);
    expect((await request(app).get(`/demo/negotiations/${theirs}/runs`)).status).toBe(403);
  });

  test('says why, instead of running, when the agent cannot send', async () => {
    const { runDemo } = await demoApp({ AGENT_DRY_RUN: 'true' });
    const response = await runDemo();
    expect(response.status).toBe(409);
    expect(response.body.error.message).toMatch(/dry-run/i);
  });

  test('is off in production unless DEMO_ENABLED is set', async () => {
    const off = await demoApp({ NODE_ENV: 'production' });
    expect((await off.runDemo()).status).toBe(404);
    expect((await request(off.app).get('/health')).body.demo.enabled).toBe(false);

    const on = await demoApp({ NODE_ENV: 'production', DEMO_ENABLED: 'true' });
    expect((await on.runDemo()).status).toBe(201);
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
