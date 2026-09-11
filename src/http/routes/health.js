import { Router } from 'express';

export function healthRoutes({ config, interpreter }) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'ai-negotiation-agent',
      env: config.env,
      llm: {
        provider: interpreter.provider,
        model: interpreter.model,
        // True only when a model is actually configured. The rules engine is a
        // complete fallback, not a degraded mode - but you should be able to
        // tell which one answered.
        model_backed: interpreter.provider === 'claude',
      },
      agent: {
        enabled: config.agent.enabled,
        dry_run: config.agent.dryRun,
        max_rounds: config.agent.maxRounds,
      },
    });
  });

  return router;
}
