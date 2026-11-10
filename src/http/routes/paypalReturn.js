import { Router } from 'express';

import { rateLimit } from '../middleware/rateLimit.js';

/**
 * Where PayPal sends the buyer's browser back to.
 *
 * These sit outside /api on purpose: a browser redirect from PayPal cannot
 * carry an x-api-key. That is safe because neither route can be made to do
 * anything harmful. /paid only captures orders this server created (it looks
 * the order up in `payments` first), and PayPal refuses to capture an order the
 * buyer has not approved. Both answer with a redirect to the UI, which reads
 * the outcome from the query string.
 */

/** PayPal order ids are short and alphanumeric. Anything else is not one. */
const ORDER_ID = /^[A-Za-z0-9-]{1,64}$/;

export function paypalReturnRoutes({ services, logger = null }) {
  const router = Router();

  // Each hit can reach PayPal's API, so keep a lid on it.
  router.get('/paid', rateLimit({ windowMs: 60_000, max: 30 }), async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!ORDER_ID.test(token)) {
      return res.redirect(303, toUi({ payment: 'error', message: 'Missing or malformed PayPal token.' }));
    }

    try {
      const payment = await services.payments.confirm({ orderId: token });
      return res.redirect(
        303,
        toUi({ payment: payment.status, negotiation: String(payment.negotiationId) }),
      );
    } catch (error) {
      const expose = Number.isInteger(error?.status) && (error.status < 500 || error.expose);
      if (!expose) logger?.error?.('paypal return failed', { error: error?.message, stack: error?.stack });
      return res.redirect(
        303,
        toUi({
          payment: 'error',
          message: expose ? error.message : 'Something went wrong confirming the payment.',
        }),
      );
    }
  });

  // The buyer backed out on PayPal. The order stays open, so accepting again
  // resumes it.
  router.get('/cancelled', (_req, res) => {
    res.redirect(303, toUi({ payment: 'cancelled' }));
  });

  return router;
}

function toUi(params) {
  return `/?${new URLSearchParams(params).toString()}`;
}
