import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { requireUser } from '../middleware/auth.js';
import { toMinor } from '../../domain/money.js';
import {
  presentNegotiation,
  presentMessage,
  presentRun,
  presentRecommendation,
  presentPayment,
} from '../presenters.js';

const sellerMessageBody = z.object({
  body: z.string().min(1).max(4000),
  // Optional. When present the price is taken as given - it came through a
  // structured channel, not out of prose - which is what lets the whole system
  // run with the LLM switched off.
  price: z.union([z.number().positive(), z.string().min(1)]).optional(),
  quantity: z.number().int().positive().optional(),
});

export function negotiationRoutes({ services, repositories }) {
  const router = Router();

  async function loadContext(id) {
    const negotiation = await repositories.negotiations.findById(id);
    if (!negotiation) throw Object.assign(new Error('negotiation not found'), { status: 404 });
    const requirement = await repositories.requirements.findById(negotiation.requirementId);
    return { negotiation, currency: requirement?.currency ?? 'INR', requirement };
  }

  router.get('/:id', async (req, res) => {
    const { negotiation, currency } = await loadContext(req.params.id);
    res.json({ ok: true, negotiation: presentNegotiation(negotiation, currency) });
  });

  router.get('/:id/messages', async (req, res) => {
    const { negotiation, currency } = await loadContext(req.params.id);
    const messages = await repositories.messages.listByNegotiation(negotiation.id);
    res.json({ ok: true, messages: messages.map((m) => presentMessage(m, currency)) });
  });

  /** The supplier's side of the wire. */
  router.post('/:id/seller-messages', validate(sellerMessageBody), async (req, res) => {
    const { currency } = await loadContext(req.params.id);
    const body = req.valid.body;

    const message = await services.negotiations.recordSellerMessage({
      negotiationId: req.params.id,
      body: body.body,
      priceMinor: body.price === undefined ? null : toMinor(body.price),
      quantity: body.quantity ?? null,
    });

    res.status(201).json({ ok: true, message: presentMessage(message, currency) });
  });

  /** Run one agent step now, instead of waiting for the worker. */
  router.post('/:id/tick', async (req, res) => {
    const { currency } = await loadContext(req.params.id);
    const result = await services.negotiations.tick({
      negotiationId: req.params.id,
      triggerSource: 'api',
    });

    res.json({
      ok: true,
      action: result.action.kind,
      reason: result.action.reason,
      state: result.state,
      message: result.message ? presentMessage(result.message, currency) : null,
      generated_by: result.generatedBy,
      recommendation: presentRecommendation(result.recommendation, currency),
    });
  });

  /** The audit trail. */
  router.get('/:id/runs', async (req, res) => {
    const { negotiation, currency } = await loadContext(req.params.id);
    const runs = await repositories.agentRuns.listByNegotiation(negotiation.id);
    res.json({ ok: true, runs: runs.map((run) => presentRun(run, currency)) });
  });

  /**
   * Acceptance. A BUYER action: it requires an identity, checks it against the
   * requirement's owner, and has no counterpart anywhere in the agent - there
   * is no tool, no action kind and no decision branch that can reach it.
   *
   * With PayPal configured it also opens the order, and `approveUrl` is where
   * to send the buyer to pay. Calling it again before they have paid returns
   * the same order. Without PayPal, `payment` and `approveUrl` are null.
   */
  router.post('/:id/accept', requireUser, async (req, res) => {
    const { currency } = await loadContext(req.params.id);
    const result = await services.payments.checkout({
      negotiationId: req.params.id,
      buyerId: req.userId,
    });
    const payment = presentPayment(result.payment);
    res.json({
      ok: true,
      accepted: true,
      message: presentMessage(result.message, currency),
      payment,
      approveUrl: payment?.approve_url ?? null,
    });
  });

  router.get('/:id/payment', async (req, res) => {
    const { negotiation } = await loadContext(req.params.id);
    const payment = await services.payments.forNegotiation(negotiation.id);
    res.json({ ok: true, payment: presentPayment(payment) });
  });

  return router;
}
