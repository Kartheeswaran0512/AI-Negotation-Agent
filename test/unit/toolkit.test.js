import { createToolkitClient, withToolkit } from '../../src/payments/toolkit.js';
import { PayPalError } from '../../src/payments/paypal.js';

/**
 * A stand-in for @paypal/agent-toolkit/ai-sdk, shaped like 1.11.0: a class
 * whose getTools() returns AI SDK tools, each execute() resolving to a JSON
 * string - including on failure.
 */
function fakeToolkitModule(results = {}) {
  const made = [];
  const executed = [];
  class PayPalAgentToolkit {
    constructor(options) {
      made.push(options);
      this.options = options;
    }
    getTools() {
      const tool = (method) => ({
        execute: async (params) => {
          executed.push({ method, params, context: this.options.configuration.context });
          const result = results[method];
          return typeof result === 'function' ? result(params) : JSON.stringify(result);
        },
      });
      const enabled = {};
      if (this.options.configuration.actions.orders?.create) enabled.create_order = tool('create_order');
      if (this.options.configuration.actions.invoices?.create) enabled.create_invoice = tool('create_invoice');
      return enabled;
    }
  }
  return { module: { PayPalAgentToolkit }, made, executed };
}

const ORDER = {
  id: 'ORDERTK1',
  status: 'PAYER_ACTION_REQUIRED',
  links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDERTK1' }],
};

const orderInput = {
  amountMinor: 67059,
  currency: 'USD',
  description: 'wireless earbuds: 100 x ₹570.00',
  referenceId: 'negotiation-7',
  requestId: 'neg-7-123-67059USD',
  returnUrl: 'http://localhost:3000/paid',
  cancelUrl: 'http://localhost:3000/cancelled',
};

const invoiceInput = {
  invoiceNumber: 'NEG-ORDERTK1',
  reference: 'Negotiation 7',
  currency: 'USD',
  amountMinor: 67059,
  itemName: 'Wireless earbuds x 100 pieces',
  itemDescription: '100 pieces of wireless earbuds at ₹570.00 per piece',
  note: 'Paid through PayPal: order ORDERTK1.',
  requestId: 'invoice-ORDERTK1',
};

const client = (fake) =>
  createToolkitClient({ clientId: 'id', clientSecret: 'secret', sandbox: true, loadToolkit: async () => fake.module });

describe('PayPal Agent Toolkit client', () => {
  test('creates the order through the create_order tool, one line at the whole charge', async () => {
    const fake = fakeToolkitModule({ create_order: ORDER });
    const order = await client(fake).createOrder(orderInput);

    expect(order).toEqual({
      orderId: 'ORDERTK1',
      status: 'PAYER_ACTION_REQUIRED',
      approveUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDERTK1',
    });

    const [call] = fake.executed;
    expect(call.method).toBe('create_order');
    expect(call.params).toMatchObject({
      currencyCode: 'USD',
      returnUrl: 'http://localhost:3000/paid',
      cancelUrl: 'http://localhost:3000/cancelled',
    });
    expect(call.params.items).toEqual([
      { name: orderInput.description, quantity: 1, itemCost: 670.59, taxPercent: 0, itemTotal: 670.59 },
    ]);
    // The request id rides on the instance's context, so it is made per call.
    expect(call.context).toEqual({ sandbox: true, request_id: 'neg-7-123-67059USD' });
    expect(fake.made[0].configuration.actions).toEqual({ orders: { create: true } });
  });

  test('creates a draft invoice through create_invoice and reads its id from the link', async () => {
    const fake = fakeToolkitModule({
      create_invoice: {
        rel: 'self',
        href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/INV2-ABCD-EFGH-IJKL-MNOP',
        method: 'GET',
      },
    });
    const invoice = await client(fake).createInvoice(invoiceInput);

    expect(invoice).toEqual({ invoiceId: 'INV2-ABCD-EFGH-IJKL-MNOP', status: 'DRAFT' });
    const [call] = fake.executed;
    expect(call.params).toMatchObject({
      currency_code: 'USD',
      invoice_number: 'NEG-ORDERTK1',
      reference: 'Negotiation 7',
      primary_recipients: [],
    });
    expect(call.params.items[0]).toEqual({
      name: 'Wireless earbuds x 100 pieces',
      description: '100 pieces of wireless earbuds at ₹570.00 per piece',
      quantity: '1',
      unit_amount: { currency_code: 'USD', value: '670.59' },
    });
  });

  test("a failure the toolkit returns as JSON (it never throws) becomes a PayPalError", async () => {
    const fake = fakeToolkitModule({
      create_order: { ok: false, status: 422, code: 'PAYPAL_API_HTTP_ERROR', message: 'UNPROCESSABLE_ENTITY' },
    });
    const error = await client(fake).createOrder(orderInput).catch((e) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error.message).toMatch(/UNPROCESSABLE_ENTITY/);
    expect(error.issue).toBe('PAYPAL_API_HTTP_ERROR');
  });

  test('a toolkit that cannot be loaded is a PayPalError too', async () => {
    const broken = createToolkitClient({
      clientId: 'id',
      clientSecret: 'secret',
      loadToolkit: async () => {
        throw new Error("Cannot find package '@paypal/agent-toolkit'");
      },
    });
    await expect(broken.createOrder(orderInput)).rejects.toThrow(PayPalError);
  });

  test('refuses a currency the toolkit cannot charge, before calling it', async () => {
    const fake = fakeToolkitModule({ create_order: ORDER });
    await expect(client(fake).createOrder({ ...orderInput, currency: 'INR' })).rejects.toThrow(/USD/);
    expect(fake.executed).toHaveLength(0);
  });
});

describe('toolkit with REST fallback', () => {
  function fakeRest() {
    const calls = [];
    return {
      calls,
      createOrder: async (input) => (calls.push(['createOrder', input]), { orderId: 'ORDERREST', status: 'PAYER_ACTION_REQUIRED', approveUrl: 'https://rest' }),
      createInvoice: async (input) => (calls.push(['createInvoice', input]), { invoiceId: 'INV2-REST', status: 'DRAFT' }),
      captureOrder: async (orderId, options) => (calls.push(['captureOrder', orderId, options]), { orderId, status: 'COMPLETED' }),
    };
  }

  test('uses the toolkit when it works, and says so', async () => {
    const rest = fakeRest();
    const paypal = withToolkit({ rest, toolkit: client(fakeToolkitModule({ create_order: ORDER })) });

    const order = await paypal.createOrder(orderInput);
    expect(order.via).toBe('toolkit');
    expect(order.orderId).toBe('ORDERTK1');
    expect(rest.calls).toHaveLength(0);
  });

  test('falls back to REST with the SAME request id, so a half-finished toolkit call cannot double the order', async () => {
    const rest = fakeRest();
    const failing = fakeToolkitModule({ create_order: { error: { message: 'boom', type: 'paypal_error' } } });
    const paypal = withToolkit({ rest, toolkit: client(failing) });

    const order = await paypal.createOrder(orderInput);
    expect(order.via).toBe('rest');
    expect(rest.calls[0]).toEqual(['createOrder', orderInput]);
    expect(rest.calls[0][1].requestId).toBe(failing.executed[0].context.request_id);
  });

  test('invoices fall back the same way; capture always uses REST', async () => {
    const rest = fakeRest();
    const paypal = withToolkit({ rest, toolkit: client(fakeToolkitModule({})) });

    expect((await paypal.createInvoice(invoiceInput)).via).toBe('rest');
    await paypal.captureOrder('ORDER1', { requestId: 'capture-ORDER1' });
    expect(rest.calls.map((c) => c[0])).toEqual(['createInvoice', 'captureOrder']);
  });
});
