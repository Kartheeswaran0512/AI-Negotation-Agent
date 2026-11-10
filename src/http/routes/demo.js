import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { presentDemoRun, presentMessage, presentPayment, presentRunWhy } from '../presenters.js';

/**
 * The home page's "Run demo" button, without an API key.
 *
 *   POST /demo/run                     create a run, negotiate it, return it with its token
 *   GET  /demo/run                     the run again (x-demo-token) - e.g. back from PayPal
 *   POST /demo/accept                  accept one of the run's deals and open the PayPal order
 *   GET  /demo/negotiations/:id/runs   "why the agent did this": the rows behind
 *                                      GET /api/negotiations/:id/runs, explained,
 *                                      without the buyer's target or maximum
 *   POST /demo/negotiations/:id/invoice  retry the PayPal invoice for a paid deal
 *
 * The token from /demo/run is the only key these routes take, and it opens
 * that run alone (see demoService.js). Mounted only when config.demo.enabled.
 */

const acceptBody = z.object({
  negotiation_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
});

export function demoRoutes({ services }) {
  const router = Router();

  // A run writes a buyer, three suppliers and their negotiations, and runs
  // the agent - so it is the tightly limited one.
  router.post('/run', rateLimit({ windowMs: 60_000, max: 6 }), async (_req, res) => {
    const { token, run } = await services.demo.run();
    res.status(201).json({ ok: true, token, run: presentDemoRun(run) });
  });

  router.get('/run', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
    const run = await services.demo.view({ token: req.get('x-demo-token') });
    res.json({ ok: true, run: presentDemoRun(run) });
  });

  router.get('/negotiations/:id/runs', rateLimit({ windowMs: 60_000, max: 60 }), async (req, res) => {
    const { limits, runs } = await services.demo.runs({
      token: req.get('x-demo-token'),
      negotiationId: req.params.id,
    });
    res.json({ ok: true, runs: runs.map((run) => presentRunWhy(run, limits)) });
  });

  // Reaches PayPal, so limited like /paid.
  router.post('/negotiations/:id/invoice', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
    const payment = await services.demo.retryInvoice({
      token: req.get('x-demo-token'),
      negotiationId: req.params.id,
    });
    res.json({ ok: true, payment: presentPayment(payment) });
  });

  router.post(
    '/accept',
    rateLimit({ windowMs: 60_000, max: 20 }),
    validate(acceptBody),
    async (req, res) => {
      const result = await services.demo.accept({
        token: req.get('x-demo-token'),
        negotiationId: req.valid.body.negotiation_id,
      });
      const payment = presentPayment(result.payment);
      res.json({
        ok: true,
        accepted: true,
        message: presentMessage(result.message, result.currency),
        payment,
        approveUrl: payment?.approve_url ?? null,
      });
    },
  );

  return router;
}
