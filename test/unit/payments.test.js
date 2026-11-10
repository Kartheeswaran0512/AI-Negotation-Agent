import { inrToUsdMinor, quoteDeal } from '../../src/payments/convert.js';
import { createPayPalClient, PayPalError, invoiceIdFromHref } from '../../src/payments/paypal.js';
import { describeInvoice } from '../../src/payments/invoice.js';

describe('deal conversion, in minor units', () => {
  test('100 x Rs 570 at 85 INR/USD is Rs 57000.00 and $670.59', () => {
    expect(
      quoteDeal({ unitPriceMinor: 57000, quantity: 100, currency: 'INR', inrPerUsd: '85' }),
    ).toEqual({ dealMinor: 5_700_000, dealCurrency: 'INR', chargeMinor: 67059, chargeCurrency: 'USD' });
  });

  test('rounds half a cent up, and anything less down', () => {
    expect(inrToUsdMinor(40, '80')).toBe(1); // exactly 0.5 cents
    expect(inrToUsdMinor(39, '80')).toBe(0);
  });

  test('takes a fractional rate without floating point', () => {
    expect(inrToUsdMinor(8325, '83.25')).toBe(100);
  });

  test('a USD deal is charged as it stands', () => {
    expect(
      quoteDeal({ unitPriceMinor: 1999, quantity: 3, currency: 'USD', inrPerUsd: '85' }).chargeMinor,
    ).toBe(5997);
  });

  test('refuses a currency it does not know how to charge', () => {
    expect(() =>
      quoteDeal({ unitPriceMinor: 100, quantity: 1, currency: 'JPY', inrPerUsd: '85' }),
    ).toThrow(/JPY/);
  });
});

describe('invoice wording', () => {
  const deal = {
    payment: {
      providerOrderId: 'ORDER123',
      captureId: 'CAP9',
      amountMinor: 67059,
      currency: 'USD',
      dealAmountMinor: 5_700_000,
      dealCurrency: 'INR',
    },
    requirement: { product: 'wireless earbuds', quantity: 100, unit: 'pieces' },
    negotiation: { id: 7, round: 5 },
    seller: { company: 'Northline Electronics', name: 'gradual' },
    unitPriceMinor: 57000,
  };

  test('names the product, quantity, unit price, total, supplier and rounds used', () => {
    const text = describeInvoice(deal);
    expect(text.invoiceNumber).toBe('NEG-ORDER123');
    expect(text.itemName).toBe('Wireless earbuds x 100 pieces');
    expect(text.itemDescription).toBe(
      '100 pieces of wireless earbuds at ₹570.00 per piece, ₹57000.00 in total. ' +
        'Agreed with Northline Electronics after 5 negotiation rounds. ' +
        'Charged as $670.59 at a fixed demo exchange rate.',
    );
    expect(text.note).toBe('Paid through PayPal: order ORDER123, capture CAP9.');
  });

  test('says "round" for one, and nothing about exchange for a USD deal', () => {
    const text = describeInvoice({
      ...deal,
      payment: { ...deal.payment, currency: 'USD', dealCurrency: 'USD', dealAmountMinor: 67059 },
      negotiation: { id: 7, round: 1 },
    });
    expect(text.itemDescription).toMatch(/after 1 negotiation round\./);
    expect(text.itemDescription).not.toMatch(/exchange rate/);
  });
});

/** A stand-in for PayPal's REST API that records every request. */
function fakePayPalApi(handlers) {
  const requests = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: init.method, headers: init.headers, body: init.body });
    const handler = handlers[`${init.method} ${path}`];
    if (!handler) return new Response('{"name":"RESOURCE_NOT_FOUND"}', { status: 404 });
    const { status = 200, body } = handler(init);
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, requests };
}

const TOKEN = { body: { access_token: 'token-1', expires_in: 32400 } };

const ORDER = {
  body: {
    id: 'ORDER123',
    status: 'PAYER_ACTION_REQUIRED',
    links: [
      { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER123' },
      { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123' },
    ],
  },
};

function client(api, overrides = {}) {
  return createPayPalClient({
    clientId: 'id',
    clientSecret: 'secret',
    baseUrl: 'https://api-m.sandbox.paypal.com',
    fetch: api.fetch,
    ...overrides,
  });
}

const orderInput = {
  amountMinor: 67059,
  currency: 'USD',
  description: 'wireless earbuds',
  referenceId: 'negotiation-7',
  requestId: 'negotiation-7-order',
  returnUrl: 'http://localhost:3000/paid',
  cancelUrl: 'http://localhost:3000/cancelled',
};

describe('PayPal client', () => {
  test('creates an order from minor units and returns the approval link', async () => {
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => TOKEN,
      'POST /v2/checkout/orders': () => ORDER,
    });

    const order = await client(api).createOrder(orderInput);

    expect(order).toEqual({
      orderId: 'ORDER123',
      status: 'PAYER_ACTION_REQUIRED',
      approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123',
    });

    const create = api.requests.find((r) => r.path === '/v2/checkout/orders');
    expect(create.headers['paypal-request-id']).toBe('negotiation-7-order');
    expect(create.headers.authorization).toBe('Bearer token-1');

    const body = JSON.parse(create.body);
    expect(body.purchase_units[0].amount).toEqual({ currency_code: 'USD', value: '670.59' });
    expect(body.purchase_units[0].reference_id).toBe('negotiation-7');
    expect(body.payment_source.paypal.experience_context.return_url).toBe('http://localhost:3000/paid');
  });

  test('reuses its access token until it is about to expire', async () => {
    let clock = 0;
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => ({ body: { access_token: 'token', expires_in: 120 } }),
      'POST /v2/checkout/orders': () => ORDER,
    });
    const paypal = client(api, { now: () => clock });

    await paypal.createOrder(orderInput);
    await paypal.createOrder(orderInput);
    expect(api.requests.filter((r) => r.path === '/v1/oauth2/token')).toHaveLength(1);

    clock = 61_000; // past expires_in minus the one-minute margin
    await paypal.createOrder(orderInput);
    expect(api.requests.filter((r) => r.path === '/v1/oauth2/token')).toHaveLength(2);
  });

  test('capture reads the capture id and status, and asks for the full representation', async () => {
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => TOKEN,
      'POST /v2/checkout/orders/ORDER123/capture': () => ({
        status: 201,
        body: {
          id: 'ORDER123',
          status: 'COMPLETED',
          purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED' }] } }],
        },
      }),
    });

    const result = await client(api).captureOrder('ORDER123', { requestId: 'payment-1-capture' });

    expect(result).toEqual({
      orderId: 'ORDER123',
      status: 'COMPLETED',
      captureId: 'CAP1',
      captureStatus: 'COMPLETED',
    });
    const capture = api.requests.find((r) => r.path.endsWith('/capture'));
    expect(capture.headers['paypal-request-id']).toBe('payment-1-capture');
    expect(capture.headers.prefer).toBe('return=representation');
  });

  test("an error carries PayPal's issue code and debug id", async () => {
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => TOKEN,
      'POST /v2/checkout/orders/ORDER123/capture': () => ({
        status: 422,
        body: {
          name: 'UNPROCESSABLE_ENTITY',
          details: [{ issue: 'ORDER_NOT_APPROVED' }],
          debug_id: 'dbg-42',
        },
      }),
    });

    const error = await client(api).captureOrder('ORDER123').catch((e) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error.issue).toBe('ORDER_NOT_APPROVED');
    expect(error.debugId).toBe('dbg-42');
    expect(error.httpStatus).toBe(422);
  });

  test('creates a one-line draft invoice and returns its id', async () => {
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => TOKEN,
      'POST /v2/invoicing/invoices': () => ({ status: 201, body: { id: 'INV2-AAAA-BBBB-CCCC-DDDD', status: 'DRAFT' } }),
    });

    const invoice = await client(api).createInvoice({
      invoiceNumber: 'NEG-ORDER123',
      reference: 'Negotiation 7',
      currency: 'USD',
      amountMinor: 67059,
      itemName: 'Wireless earbuds x 100 pieces',
      itemDescription: '100 pieces of wireless earbuds at ₹570.00 per piece',
      note: 'Paid through PayPal: order ORDER123.',
      requestId: 'invoice-ORDER123',
    });

    expect(invoice).toEqual({ invoiceId: 'INV2-AAAA-BBBB-CCCC-DDDD', status: 'DRAFT' });
    const request = api.requests.find((r) => r.path === '/v2/invoicing/invoices');
    expect(request.headers.prefer).toBe('return=representation');
    expect(request.headers['paypal-request-id']).toBe('invoice-ORDER123');
    const body = JSON.parse(request.body);
    expect(body.detail).toEqual({
      currency_code: 'USD',
      invoice_number: 'NEG-ORDER123',
      reference: 'Negotiation 7',
      note: 'Paid through PayPal: order ORDER123.',
    });
    expect(body.items).toEqual([
      {
        name: 'Wireless earbuds x 100 pieces',
        description: '100 pieces of wireless earbuds at ₹570.00 per piece',
        quantity: '1',
        unit_amount: { currency_code: 'USD', value: '670.59' },
      },
    ]);
    expect(body.primary_recipients).toBeUndefined();
  });

  test('A 403 FROM INVOICING, WITH A TOKEN THAT LACKS THE SCOPE, SAYS SO AND SAYS UNTIL WHEN', async () => {
    const issuedAt = Date.parse('2026-11-10T07:19:40Z');
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => ({
        body: {
          access_token: 'stale',
          expires_in: 32400,
          scope: 'https://uri.paypal.com/services/payments/realtimepayment https://uri.paypal.com/services/checkout/one-click-with-merchant-issued-token',
        },
      }),
      'POST /v2/invoicing/invoices': () => ({
        status: 403,
        body: { name: 'NOT_AUTHORIZED', message: 'Authorization failed due to insufficient permissions.', debug_id: 'dbg-403' },
      }),
    });

    const error = await client(api, { now: () => issuedAt })
      .createInvoice({ invoiceNumber: 'NEG-X', currency: 'USD', amountMinor: 100, itemName: 'x' })
      .catch((e) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error.issue).toBe('INVOICING_PERMISSION_MISSING');
    expect(error.debugId).toBe('dbg-403');
    expect(error.message).toMatch(/no Invoicing permission/);
    // PayPal's own expiry: issue time + expires_in.
    expect(error.message).toContain('2026-11-10T16:19:40.000Z');
  });

  test('a 403 with the invoicing scope present is passed through as PayPal said it', async () => {
    const api = fakePayPalApi({
      'POST /v1/oauth2/token': () => ({
        body: { access_token: 't', expires_in: 32400, scope: 'https://uri.paypal.com/services/invoicing' },
      }),
      'POST /v2/invoicing/invoices': () => ({ status: 403, body: { name: 'NOT_AUTHORIZED' } }),
    });

    const error = await client(api)
      .createInvoice({ invoiceNumber: 'NEG-X', currency: 'USD', amountMinor: 100, itemName: 'x' })
      .catch((e) => e);
    expect(error.issue).toBe('NOT_AUTHORIZED');
    expect(error.message).not.toMatch(/no Invoicing permission/);
  });

  test('reads an invoice id from the link Invoicing returns without a representation', () => {
    expect(invoiceIdFromHref('https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-Z9Z9-Y8Y8-X7X7-W6W6')).toBe(
      'INV2-Z9Z9-Y8Y8-X7X7-W6W6',
    );
    expect(invoiceIdFromHref('https://example.com/other')).toBeNull();
    expect(invoiceIdFromHref(undefined)).toBeNull();
  });

  test('a network failure is a PayPalError, not a crash', async () => {
    const paypal = client({
      fetch: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    await expect(paypal.createOrder(orderInput)).rejects.toThrow(PayPalError);
  });
});
