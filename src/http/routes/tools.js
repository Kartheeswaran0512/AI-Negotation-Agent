import { Router } from 'express';

/**
 * The tool surface, over HTTP.
 *
 * Useful for exploring what the agent can do, and the obvious seam for a future
 * model-driven tool-calling loop: the same registry, the same validation, the
 * same guards. Note what listing it makes obvious - there is no acceptance tool.
 */
export function toolRoutes({ tools }) {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      tools: tools.definitions(),
      note: 'There is deliberately no accept_deal tool. The agent cannot close a deal.',
    });
  });

  router.post('/:name', async (req, res) => {
    const result = await tools.run(req.params.name, req.body ?? {}, { triggerSource: 'tool' });
    res.json({ ok: true, tool: req.params.name, result });
  });

  return router;
}
