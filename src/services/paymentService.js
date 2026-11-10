/**
 * Paying for an accepted deal, through PayPal.
 *
 *   POST /api/negotiations/:id/accept  ->  checkout()  accept, then open a PayPal order
 *   GET  /paid?token=<order id>         ->  confirm()   capture it and mark it PAID
 *
 * Acceptance is still the buyer's act: checkout() goes through the same
 * negotiationService.accept, with the same ownership check, and nothing the
 * agent can call reaches either function. What this layer adds is the money,
 * and three rules for it:
 *
 *   - Nothing is accepted that cannot then be charged. The quote (quantity,
 *     currency, a non-zero total) is checked BEFORE accept() runs.
 *   - One payment per negotiation. Calling accept again while the buyer has not
 *     paid hands back the same approval link; PayPal-Request-Id and a UNIQUE key
 *     keep that true under a race too.
 *   - Capture happens once. A refreshed return page finds the payment already
 *     settled and stops.
 *
 * Once a payment is PAID, confirm() raises a PayPal invoice for the agreed
 * deal and stores its id. An invoice failure never un-pays a deal: it is
 * logged, and the next visit to /paid tries again.
 *
 * The PayPal client may be the REST client or the Agent Toolkit in front of it
 * (PAYPAL_USE_TOOLKIT); either way it is called only from here, after the
 * buyer's acceptance - never by the negotiating agent.
 *
 * With no PayPal client configured, checkout() is plain acceptance.
 */

import { ConflictError, NotFoundError } from './negotiationService.js';
import { quoteDeal, SUPPORTED_DEAL_CURRENCIES } from '../payments/convert.js';
import { describeInvoice } from '../payments/invoice.js';
import { formatMoney, isPositiveMinor } from '../domain/money.js';

export const PAYMENT_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PAID: 'PAID',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
});

const ACCEPTED_OUTCOME = 'accepted_by_buyer';

/**
 * PayPal failed or could not be reached. A 502 whose message is safe to show:
 * it says what state the deal was left in, which is what the buyer needs.
 */
export class PaymentProviderError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'PaymentProviderError';
    this.status = 502;
    this.expose = true;
    this.cause = cause;
  }
}

/**
 * @param {object} deps
 * @param {import('../repositories/types.js').Repositories} deps.repositories
 * @param {object} deps.negotiations   the negotiation service, for accept()
 * @param {object|null} [deps.paypal]  from createPayPalClient(), or null when off
 * @param {object} deps.config
 * @param {object} [deps.logger]
 * @param {() => Date} [deps.clock]
 */
export function createPaymentService({
  repositories,
  negotiations,
  paypal = null,
  config,
  logger = null,
  clock = () => new Date(),
}) {
  /**
   * Accept the supplier's current price and open (or resume) the PayPal order.
   *
   * @returns {Promise<{message: object, payment: object|null}>}
   */
  async function checkout({ negotiationId, buyerId }) {
    if (!paypal) {
      const { message } = await negotiations.accept({ negotiationId, buyerId });
      return { message, payment: null };
    }

    const negotiation = await repositories.negotiations.findById(negotiationId);
    if (!negotiation) throw new NotFoundError('negotiation not found');
    const requirement = await repositories.requirements.findById(negotiation.requirementId);
    if (!requirement) throw new NotFoundError('requirement not found');
    if (String(requirement.buyerId) !== String(buyerId)) {
      throw new ConflictError('only the buyer who owns this requirement can accept');
    }

    const existing = await repositories.payments.findByNegotiation(negotiation.id);
    if (existing && existing.status !== PAYMENT_STATUS.CREATED) {
      throw new ConflictError(settledReason(existing));
    }

    let message;
    if (negotiation.outcome === ACCEPTED_OUTCOME) {
      // Accepted earlier and not paid yet: resume, do not accept twice.
      message = await acceptanceOf(negotiation.id);
    } else {
      // Refuse an uncollectable deal while nothing has been accepted yet. A
      // missing price is left for accept() to refuse in its own words.
      if (negotiation.currentSellerPriceMinor !== null) {
        quoteFor(requirement, negotiation.currentSellerPriceMinor);
      }
      ({ message } = await negotiations.accept({ negotiationId: negotiation.id, buyerId }));
    }

    if (existing) return { message, payment: existing };

    const quote = quoteFor(requirement, message.priceMinor);

    let order;
    try {
      order = await paypal.createOrder({
        amountMinor: quote.chargeMinor,
        currency: quote.chargeCurrency,
        description: `${requirement.product}: ${requirement.quantity} x ${formatMoney(
          message.priceMinor,
          requirement.currency,
        )}`,
        referenceId: `negotiation-${negotiation.id}`,
        requestId: orderRequestId(negotiation, quote),
        returnUrl: config.paypal.returnUrl,
        cancelUrl: config.paypal.cancelUrl,
      });
    } catch (error) {
      logger?.error?.('paypal order failed', {
        negotiationId: negotiation.id,
        error: error?.message,
        issue: error?.issue ?? null,
        debugId: error?.debugId ?? null,
      });
      throw new PaymentProviderError(
        'The offer is accepted, but PayPal did not create the order. Nothing was charged - accept again to retry the payment.',
        error,
      );
    }

    const { payment } = await repositories.payments.create({
      negotiationId: negotiation.id,
      provider: 'paypal',
      providerOrderId: order.orderId,
      createdVia: order.via ?? 'rest',
      status: PAYMENT_STATUS.CREATED,
      amountMinor: quote.chargeMinor,
      currency: quote.chargeCurrency,
      dealAmountMinor: quote.dealMinor,
      dealCurrency: quote.dealCurrency,
      approveUrl: order.approveUrl,
    });

    logger?.info?.('paypal order created', {
      negotiationId: negotiation.id,
      orderId: payment.providerOrderId,
      amount: formatMoney(payment.amountMinor, payment.currency),
      via: payment.createdVia,
    });

    return { message, payment };
  }

  /**
   * The buyer is back from PayPal: capture the order and record the result.
   * Safe to call again - a settled payment is returned as it is.
   *
   * @param {{orderId: string}} params
   */
  async function confirm({ orderId }) {
    const payment = await repositories.payments.findByOrderId(orderId);
    if (!payment) throw new NotFoundError('no payment matches that PayPal order');
    if (payment.status !== PAYMENT_STATUS.CREATED) return invoiceIfPaid(payment);
    if (!paypal) throw new ConflictError('PayPal is not configured on this server');

    let capture;
    try {
      // Keyed on PayPal's own order id, which is globally unique - our payment
      // id is not, once a database is reset or shared credentials are reused.
      capture = await paypal.captureOrder(orderId, { requestId: `capture-${orderId}` });
    } catch (error) {
      logger?.warn?.('paypal capture failed', {
        paymentId: payment.id,
        orderId,
        error: error?.message,
        issue: error?.issue ?? null,
        debugId: error?.debugId ?? null,
      });
      if (error?.issue === 'ORDER_NOT_APPROVED') {
        throw new ConflictError('PayPal has not approved this payment yet. Approve it on PayPal first.');
      }
      throw new PaymentProviderError(
        'PayPal did not capture the payment, and nothing was marked paid. Try again.',
        error,
      );
    }

    const status = statusForCapture(capture);
    const settled = await repositories.payments.recordCapture(payment.id, {
      status,
      captureId: capture.captureId,
      paidAt: status === PAYMENT_STATUS.PAID ? clock() : null,
    });

    logger?.info?.('paypal capture recorded', {
      paymentId: payment.id,
      orderId,
      status: settled.status,
      captureId: settled.captureId,
    });
    return invoiceIfPaid(settled);
  }

  /**
   * One invoice per PAID payment. On failure the payment is returned as it
   * is - still PAID - and the next confirm() for this order tries again.
   */
  async function invoiceIfPaid(payment) {
    if (payment.status !== PAYMENT_STATUS.PAID || payment.invoiceId || !paypal?.createInvoice) {
      return payment;
    }
    try {
      const negotiation = await repositories.negotiations.findById(payment.negotiationId);
      const requirement = await repositories.requirements.findById(negotiation.requirementId);
      const seller = await repositories.users.findById(negotiation.sellerId);
      const thread = await repositories.messages.listByNegotiation(negotiation.id);
      const acceptance = thread.filter((m) => m.author === 'buyer' && m.kind === 'accept').pop();

      const invoice = await paypal.createInvoice({
        ...describeInvoice({
          payment,
          requirement,
          negotiation,
          seller,
          unitPriceMinor: acceptance?.priceMinor ?? negotiation.currentSellerPriceMinor,
        }),
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        requestId: `invoice-${payment.providerOrderId}`,
      });

      const recorded = await repositories.payments.recordInvoice(payment.id, {
        invoiceId: invoice.invoiceId,
        invoiceStatus: invoice.status ?? 'DRAFT',
        invoiceVia: invoice.via ?? 'rest',
      });
      logger?.info?.('paypal invoice created', {
        paymentId: payment.id,
        invoiceId: recorded.invoiceId,
        via: recorded.invoiceVia,
      });
      return recorded;
    } catch (error) {
      logger?.warn?.('paypal invoice failed; the payment stays PAID and can be retried', {
        paymentId: payment.id,
        error: error?.message,
        issue: error?.issue ?? null,
        debugId: error?.debugId ?? null,
      });
      // Keep the reason with the payment, so it can be seen without the logs.
      try {
        return await repositories.payments.recordInvoiceError(payment.id, {
          message: error?.message ?? 'the invoice could not be created',
          at: clock(),
        });
      } catch {
        return payment;
      }
    }
  }

  /**
   * Try the invoice again for a paid deal that has none. Returns the payment,
   * with either the invoice or the reason it still failed.
   */
  async function retryInvoice({ negotiationId }) {
    const payment = await repositories.payments.findByNegotiation(negotiationId);
    if (!payment) throw new NotFoundError('this deal has no payment');
    if (payment.status !== PAYMENT_STATUS.PAID) {
      throw new ConflictError('only a paid deal gets an invoice');
    }
    if (!paypal?.createInvoice) throw new ConflictError('PayPal is not configured on this server');
    return invoiceIfPaid(payment);
  }

  /** @param {number|string} negotiationId */
  async function forNegotiation(negotiationId) {
    return repositories.payments.findByNegotiation(negotiationId);
  }

  function quoteFor(requirement, unitPriceMinor) {
    if (!SUPPORTED_DEAL_CURRENCIES.includes(requirement.currency)) {
      throw new ConflictError(
        `PayPal checkout supports ${SUPPORTED_DEAL_CURRENCIES.join(' and ')} deals, not ${requirement.currency}`,
      );
    }
    if (!(requirement.quantity > 0)) {
      throw new ConflictError('this requirement has no quantity, so there is no order total to charge');
    }

    const quote = quoteDeal({
      unitPriceMinor,
      quantity: requirement.quantity,
      currency: requirement.currency,
      inrPerUsd: config.paypal.inrPerUsd,
    });
    if (!isPositiveMinor(quote.dealMinor) || !isPositiveMinor(quote.chargeMinor)) {
      throw new ConflictError('the order total is outside what can be charged through PayPal');
    }
    return quote;
  }

  async function acceptanceOf(negotiationId) {
    const thread = await repositories.messages.listByNegotiation(negotiationId);
    const accepted = thread.filter((m) => m.author === 'buyer' && m.kind === 'accept').pop();
    if (!accepted) throw new ConflictError('this negotiation is accepted but has no acceptance record');
    return accepted;
  }

  return { checkout, confirm, forNegotiation, retryInvoice };
}

/**
 * PayPal-Request-Id for an order. PayPal answers a repeated id with the order
 * it made the first time, so the id must be stable across retries of THIS deal
 * and never shared with another one. A negotiation id alone is not enough:
 * after a database reset, or with sandbox credentials shared between machines,
 * "negotiation 1" names a different deal and PayPal would hand back an old order
 * for an old amount. Creation time and amount pin it to this deal.
 */
function orderRequestId(negotiation, quote) {
  const created = new Date(negotiation.createdAt ?? 0).getTime() || 0;
  return `neg-${negotiation.id}-${created}-${quote.chargeMinor}${quote.chargeCurrency}`;
}

function statusForCapture(capture) {
  // Without a capture in the body, a COMPLETED order is the capture result.
  const result = capture.captureStatus ?? (capture.status === 'COMPLETED' ? 'COMPLETED' : null);
  if (result === 'COMPLETED') return PAYMENT_STATUS.PAID;
  if (result === 'PENDING') return PAYMENT_STATUS.PENDING;
  return PAYMENT_STATUS.FAILED;
}

function settledReason(payment) {
  if (payment.status === PAYMENT_STATUS.PAID) return 'this deal has already been paid';
  if (payment.status === PAYMENT_STATUS.PENDING) {
    return 'this deal is paid and PayPal is still clearing the funds';
  }
  return 'the PayPal payment for this deal failed; a person needs to look at it before retrying';
}
