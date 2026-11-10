/**
 * PayPal's Agent Toolkit (@paypal/agent-toolkit), used as a library.
 *
 * The toolkit exists to hand PayPal's API to a language model as tools. This
 * project deliberately does not: no model is ever given these tools. Only the
 * payment service calls them, and only at two points a person has already
 * cleared - after the buyer accepts a deal (POST .../accept, the human
 * approval) and after PayPal confirms the buyer paid (GET /paid). The
 * negotiating agent has no route here: src/agent, src/llm and src/domain import
 * nothing from src/payments or the toolkit, and a test keeps it that way.
 *
 * What the code below relies on, read from the toolkit's 1.11.0 source (the
 * version package.json pins):
 *   - getTools() returns AI SDK tools; a tool's execute() runs the PayPal call
 *     directly and resolves to a JSON STRING. It never throws: a failure is
 *     {ok:false, code, status, message} or {error:{message, type}}.
 *   - PayPal-Request-Id is taken from context.request_id, fixed per instance,
 *     and the access token is cached per instance with no refresh. So a fresh
 *     instance is made for every call, carrying that call's request id.
 *   - create_order takes USD only and has no reference_id field.
 *   - create_invoice answers with a link to the invoice, not the invoice.
 */

import { fromMinor } from '../domain/money.js';
import { PayPalError, invoiceDraft, invoiceIdFromHref } from './paypal.js';

const defaultLoad = () => import('@paypal/agent-toolkit/ai-sdk');

/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {boolean} [options.sandbox]
 * @param {() => Promise<object>} [options.loadToolkit]  for tests: returns the module
 */
export function createToolkitClient({ clientId, clientSecret, sandbox = true, loadToolkit = defaultLoad }) {
  async function run(method, actions, params, requestId) {
    let PayPalAgentToolkit;
    try {
      const mod = await loadToolkit();
      PayPalAgentToolkit = mod.PayPalAgentToolkit ?? mod.default?.PayPalAgentToolkit;
    } catch (error) {
      throw new PayPalError(`the PayPal Agent Toolkit could not be loaded: ${error.message}`);
    }
    if (typeof PayPalAgentToolkit !== 'function') {
      throw new PayPalError('the PayPal Agent Toolkit could not be loaded');
    }

    const toolkit = new PayPalAgentToolkit({
      clientId,
      clientSecret,
      configuration: {
        actions,
        context: { sandbox, ...(requestId ? { request_id: requestId } : {}) },
      },
    });

    const tool = toolkit.getTools()?.[method];
    if (typeof tool?.execute !== 'function') {
      throw new PayPalError(`the PayPal Agent Toolkit has no ${method} tool`);
    }

    let raw;
    try {
      raw = await tool.execute(params, { toolCallId: requestId ?? method, messages: [] });
    } catch (error) {
      throw new PayPalError(`Agent Toolkit ${method} failed: ${error.message}`);
    }

    let data = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch {
        throw new PayPalError(`Agent Toolkit ${method} did not return JSON`);
      }
    }
    if (!data || typeof data !== 'object' || data.ok === false || data.error) {
      const message = data?.message ?? data?.error?.message ?? 'no result';
      throw new PayPalError(`Agent Toolkit ${method} failed: ${String(message).slice(0, 200)}`, {
        status: data?.status ?? null,
        issue: data?.code ?? data?.error?.type ?? null,
      });
    }
    return data;
  }

  /** Same arguments and result as the REST client's createOrder. */
  async function createOrder({ amountMinor, currency, description, requestId, returnUrl, cancelUrl }) {
    if (currency !== 'USD') throw new PayPalError('the Agent Toolkit creates USD orders only');
    // One line at the whole charge. The toolkit multiplies and rounds in
    // floating point; quantity 1 with a two-decimal figure is exact.
    const amount = Number(fromMinor(amountMinor));
    const data = await run(
      'create_order',
      { orders: { create: true } },
      {
        currencyCode: 'USD',
        items: [
          { name: String(description).slice(0, 127), quantity: 1, itemCost: amount, taxPercent: 0, itemTotal: amount },
        ],
        returnUrl,
        cancelUrl,
      },
      requestId,
    );

    const link = (data.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    if (!data.id || !link?.href) {
      throw new PayPalError('the Agent Toolkit created an order without an approval link');
    }
    return { orderId: data.id, status: data.status, approveUrl: link.href };
  }

  /** Same arguments and result as the REST client's createInvoice. */
  async function createInvoice({ requestId, ...invoice }) {
    const draft = invoiceDraft(invoice);
    const [item] = draft.items;
    const data = await run(
      'create_invoice',
      { invoices: { create: true } },
      {
        currency_code: draft.detail.currency_code,
        invoice_number: draft.detail.invoice_number,
        reference: draft.detail.reference,
        note: draft.detail.note,
        primary_recipients: [],
        items: [item],
      },
      requestId,
    );

    const invoiceId = data.id ?? invoiceIdFromHref(data.href);
    if (!invoiceId) throw new PayPalError('the Agent Toolkit created an invoice but returned no id');
    return { invoiceId, status: data.status ?? 'DRAFT' };
  }

  return { createOrder, createInvoice };
}

/**
 * Orders and invoices through the toolkit, falling back to the REST client
 * when the toolkit fails. Both paths get the same PayPal-Request-Id, so if the
 * toolkit's request did reach PayPal, the REST retry gets that same order back
 * rather than opening a second one. Capture always uses REST.
 *
 * Results carry `via: 'toolkit' | 'rest'`, which is stored on the payment.
 */
export function withToolkit({ rest, toolkit, logger = null }) {
  async function attempt(operation, input) {
    try {
      return { ...(await toolkit[operation](input)), via: 'toolkit' };
    } catch (error) {
      logger?.warn?.('PayPal Agent Toolkit failed; using the REST API instead', {
        operation,
        error: error?.message,
        issue: error?.issue ?? null,
      });
      return { ...(await rest[operation](input)), via: 'rest' };
    }
  }

  return {
    createOrder: (input) => attempt('createOrder', input),
    createInvoice: (input) => attempt('createInvoice', input),
    captureOrder: (orderId, options) => rest.captureOrder(orderId, options),
  };
}
