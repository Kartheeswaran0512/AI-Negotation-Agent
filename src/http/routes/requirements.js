import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { toMinor } from '../../domain/money.js';
import { presentRequirement, presentNegotiation, presentRecommendation } from '../presenters.js';

const moneyInput = z.union([z.number().positive(), z.string().min(1)]);

const createRequirementBody = z.object({
  buyer_id: z.union([z.number().int().positive(), z.string().min(1)]),
  product: z.string().min(2).max(191),
  quantity: z.number().int().nonnegative().optional(),
  unit: z.string().max(32).optional(),
  currency: z.string().length(3).optional(),
  target_price: moneyInput,
  max_price: moneyInput,
  // Required, never defaulted: the two readings of a budget can differ by the
  // whole order quantity.
  price_basis: z.enum(['per_unit', 'total']),
  source_text: z.string().max(2000).optional(),
});

const readTextBody = z.object({ text: z.string().min(1).max(2000) });

const openNegotiationBody = z.object({
  seller_id: z.union([z.number().int().positive(), z.string().min(1)]),
  max_rounds: z.number().int().min(1).max(20).optional(),
});

/**
 * @param {object} deps
 */
export function requirementRoutes({ services, repositories, config }) {
  const router = Router();

  router.post('/', validate(createRequirementBody), async (req, res) => {
    const body = req.valid.body;

    let targetPriceMinor;
    let maxPriceMinor;
    try {
      targetPriceMinor = toMinor(body.target_price);
      maxPriceMinor = toMinor(body.max_price);
    } catch (error) {
      throw Object.assign(new Error(error.message), { status: 422 });
    }

    const { requirement } = await services.intake.createRequirement({
      buyerId: body.buyer_id,
      product: body.product,
      quantity: body.quantity ?? 0,
      unit: body.unit ?? null,
      currency: body.currency ?? 'INR',
      targetPriceMinor,
      maxPriceMinor,
      priceBasis: body.price_basis,
      sourceText: body.source_text ?? null,
    });

    res.status(201).json({ ok: true, requirement: presentRequirement(requirement) });
  });

  /**
   * Read free text into a PROPOSED requirement. Creates nothing: the buyer
   * confirms by posting the result to POST /api/requirements.
   */
  router.post(
    '/read',
    rateLimit({ windowMs: 60_000, max: 20 }),
    validate(readTextBody),
    async (req, res) => {
      const result = await services.intake.readRequirementText({ text: req.valid.body.text });
      res.json({
        ok: true,
        reading: result.reading,
        unverified: result.unverified,
        ready: result.ready,
        question: result.question,
        source: result.source,
        note: 'Nothing has been created. Confirm these details and post them to /api/requirements.',
      });
    },
  );

  router.get('/:id', async (req, res) => {
    const requirement = await repositories.requirements.findById(req.params.id);
    if (!requirement) throw Object.assign(new Error('requirement not found'), { status: 404 });
    res.json({ ok: true, requirement: presentRequirement(requirement) });
  });

  router.get('/:id/negotiations', async (req, res) => {
    const requirement = await repositories.requirements.findById(req.params.id);
    if (!requirement) throw Object.assign(new Error('requirement not found'), { status: 404 });
    const negotiations = await repositories.negotiations.listByRequirement(requirement.id);
    res.json({
      ok: true,
      negotiations: negotiations.map((n) => presentNegotiation(n, requirement.currency)),
    });
  });

  router.post('/:id/negotiations', validate(openNegotiationBody), async (req, res) => {
    const negotiation = await services.negotiations.open({
      requirementId: req.params.id,
      sellerId: req.valid.body.seller_id,
      maxRounds: req.valid.body.max_rounds ?? config.agent.maxRounds,
    });
    res.status(201).json({ ok: true, negotiation: presentNegotiation(negotiation) });
  });

  router.get('/:id/recommendation', async (req, res) => {
    const requirement = await repositories.requirements.findById(req.params.id);
    if (!requirement) throw Object.assign(new Error('requirement not found'), { status: 404 });
    const recommendation = await services.recommendations.latest(requirement.id);
    res.json({
      ok: true,
      recommendation: presentRecommendation(recommendation, requirement.currency),
    });
  });

  router.post('/:id/recommendation', async (req, res) => {
    const requirement = await repositories.requirements.findById(req.params.id);
    if (!requirement) throw Object.assign(new Error('requirement not found'), { status: 404 });
    const recommendation = await services.recommendations.refresh(requirement.id);
    res.json({
      ok: true,
      recommendation: presentRecommendation(recommendation, requirement.currency),
    });
  });

  return router;
}
