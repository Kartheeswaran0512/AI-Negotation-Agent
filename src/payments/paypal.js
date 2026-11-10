/**
 * A small PayPal Orders v2 client: create an order, capture it.
 *
 * Credentials and `fetch` are injected, so nothing here reads process.env and
 * the tests run against a fake. Errors come back as PayPalError carrying
 * PayPal's own issue code (ORDER_NOT_APPROVED, ...) and debug id, which is what
 * PayPal support asks for.
 *
 * Both calls send a PayPal-Request-Id. PayPal answers a repeated id with the
 * original result instead of doing the work twice, which is what makes a
 * retried accept or a refreshed return page safe.
 */

import { fromMinor } from '../domain/money.js';

export class PayPalError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number|null, issue?: string|null, debugId?: string|null}} [details]
   */
  constructor(message, { status = null, issue = null, debugId = null } = {}) {
    super(message);
    this.name = 'PayPalError';
    this.httpStatus = status;
    this.issue = issue;
    this.debugId = debugId;
  }
}

/** PayPal's limit on purchase_unit.description. */
const DESCRIPTION_MAX = 127;

/**
 * The body of a one-line draft invoice, in the Invoicing v2 shape. Lengths are
 * PayPal's own limits. No recipient: a draft does not need one, and the deal
 * is already paid - the invoice is the paperwork, not a request for money.
 *
 * @param {object} invoice
 */
export function invoiceDraft({ invoiceNumber, reference, currency, amountMinor, itemName, itemDescription, note }) {
  return {
    detail: {
      currency_code: currency,
      invoice_number: String(invoiceNumber).slice(0, 127),
      reference: reference ? String(reference).slice(0, 120) : undefined,
      note: note ? String(note).slice(0, 4000) : undefined,
    },
    items: [
      {
        name: String(itemName).slice(0, 200),
        description: itemDescription ? String(itemDescription).slice(0, 1000) : undefined,
        quantity: '1',
        unit_amount: { currency_code: currency, value: fromMinor(amountMinor) },
      },
    ],
  };
}

/** Invoicing v2 answers a create with a link; the id is its last path segment. */
export function invoiceIdFromHref(href) {
  if (typeof href !== 'string') return null;
  const match = href.match(/\/v2\/invoicing\/invoices\/([A-Za-z0-9-]+)\/?$/);
  return match ? match[1] : null;
}

/**
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.clientSecret
 * @param {string} options.baseUrl       https://api-m.sandbox.paypal.com or the live one
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {() => number} [options.now]
 */
export function createPayPalClient({
  clientId,
  clientSecret,
  baseUrl,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
  now = () => Date.now(),
}) {
  let cachedToken = null;

  async function call(method, path, { headers = {}, body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new PayPalError(`PayPal ${method} ${path} did not complete: ${error.message}`);
    }

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      if (response.status === 401) cachedToken = null;
      const issue = data?.details?.[0]?.issue ?? data?.name ?? data?.error ?? null;
      throw new PayPalError(
        `PayPal ${method} ${path} returned ${response.status}${issue ? ` (${issue})` : ''}`,
        { status: response.status, issue, debugId: data?.debug_id ?? null },
      );
    }
    return data ?? {};
  }

  async function accessToken() {
    if (cachedToken && now() < cachedToken.expiresAt) return cachedToken.value;

    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const data = await call('POST', '/v1/oauth2/token', {
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!data.access_token) throw new PayPalError('PayPal returned no access token');

    // Refresh a minute early so a token never expires between check and use.
    const lifetimeSeconds = Math.max(0, (Number(data.expires_in) || 0) - 60);
    cachedToken = {
      value: data.access_token,
      expiresAt: now() + lifetimeSeconds * 1000,
      // PayPal's own expiry, and what the token may do. PayPal hands back the
      // same token until it expires, so a permission enabled on the app after
      // the token was issued is missing from it until then.
      paypalExpiresAt: now() + (Number(data.expires_in) || 0) * 1000,
      scopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : null,
    };
    return cachedToken.value;
  }

  /**
   * A 403 from Invoicing, with a token that lacks the invoicing scope, is a
   * missing permission - say so, and say when PayPal will issue a new token.
   * Anything else passes through unchanged.
   */
  function explainInvoicingRefusal(error) {
    if (!(error instanceof PayPalError) || error.httpStatus !== 403) return error;
    const scopes = cachedToken?.scopes;
    if (!Array.isArray(scopes) || scopes.some((scope) => scope.includes('/services/invoicing'))) return error;

    const until = cachedToken.paypalExpiresAt ? new Date(cachedToken.paypalExpiresAt).toISOString() : null;
    return new PayPalError(
      'PayPal refused the invoice (403 NOT_AUTHORIZED): the access token PayPal issued to this app ' +
        'has no Invoicing permission. Check that Invoicing is enabled on the app. PayPal returns the ' +
        `same token ${until ? `until ${until}` : 'until it expires'}, so a permission enabled after it ` +
        'was issued may not apply before then. Retry the invoice after that.',
      { status: 403, issue: 'INVOICING_PERMISSION_MISSING', debugId: error.debugId },
    );
  }

  /**
   * @param {object} order
   * @param {number} order.amountMinor
   * @param {string} order.currency
   * @param {string} order.description
   * @param {string} order.referenceId   ties the order back to our negotiation
   * @param {string} order.requestId     PayPal-Request-Id: same id, same order
   * @param {string} order.returnUrl
   * @param {string} order.cancelUrl
   * @returns {Promise<{orderId: string, status: string, approveUrl: string}>}
   */
  async function createOrder({
    amountMinor,
    currency,
    description,
    referenceId,
    requestId,
    returnUrl,
    cancelUrl,
  }) {
    const token = await accessToken();
    const data = await call('POST', '/v2/checkout/orders', {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'paypal-request-id': requestId,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: referenceId,
            description: String(description).slice(0, DESCRIPTION_MAX),
            amount: { currency_code: currency, value: fromMinor(amountMinor) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: returnUrl,
              cancel_url: cancelUrl,
              user_action: 'PAY_NOW',
            },
          },
        },
      }),
    });

    const link = (data.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
    if (!data.id || !link?.href) {
      throw new PayPalError('PayPal created an order without an approval link', {
        debugId: data.debug_id ?? null,
      });
    }
    return { orderId: data.id, status: data.status, approveUrl: link.href };
  }

  /**
   * @param {string} orderId
   * @param {{requestId?: string}} [options]
   * @returns {Promise<{orderId: string, status: string, captureId: string|null, captureStatus: string|null}>}
   */
  async function captureOrder(orderId, { requestId } = {}) {
    const token = await accessToken();
    const data = await call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        // The full representation is what carries the capture itself.
        prefer: 'return=representation',
        ...(requestId ? { 'paypal-request-id': requestId } : {}),
      },
    });

    const capture = data.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
    return {
      orderId: data.id,
      status: data.status,
      captureId: capture?.id ?? null,
      captureStatus: capture?.status ?? null,
    };
  }

  /**
   * Create a draft invoice (see invoiceDraft for the fields).
   * @returns {Promise<{invoiceId: string, status: string}>}
   */
  async function createInvoice({ requestId, ...invoice }) {
    const token = await accessToken();
    let data;
    try {
      data = await call('POST', '/v2/invoicing/invoices', {
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          prefer: 'return=representation',
          ...(requestId ? { 'paypal-request-id': requestId } : {}),
        },
        body: JSON.stringify(invoiceDraft(invoice)),
      });
    } catch (error) {
      throw explainInvoicingRefusal(error);
    }

    const invoiceId = data.id ?? invoiceIdFromHref(data.href);
    if (!invoiceId) throw new PayPalError('PayPal created an invoice but returned no id');
    return { invoiceId, status: data.status ?? 'DRAFT' };
  }

  return { createOrder, captureOrder, createInvoice };
}
