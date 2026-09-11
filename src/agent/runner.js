/**
 * The worker loop.
 *
 * Runs in its own process (`npm run worker`), not in the web server, because an
 * agent that only advances while somebody has a browser open is not an agent.
 *
 * It does very little: find the negotiations that have something to respond to,
 * tick each one, and never let a single failure stop the loop. All the
 * interesting behaviour is in the service and the domain; this is the clock.
 */

export function createRunner({ repositories, services, config, logger = null }) {
  let timer = null;
  let inFlight = false;
  let stopped = false;

  /**
   * One pass. Returns what it did, which is what the tests assert on rather
   * than waiting for wall-clock time to pass.
   */
  async function runOnce({ limit = 25, triggerSource = 'worker' } = {}) {
    if (!config.agent.enabled) {
      logger?.debug?.('agent disabled; skipping pass');
      return { picked: 0, results: [] };
    }

    const due = await repositories.negotiations.findDue(limit);
    const results = [];

    for (const negotiation of due) {
      try {
        const result = await services.negotiations.tick({
          negotiationId: negotiation.id,
          triggerSource,
          correlationId: `run-${Date.now()}-${negotiation.id}`,
        });
        results.push({ negotiationId: negotiation.id, action: result.action.kind, state: result.state });
      } catch (error) {
        // One bad negotiation must not stop the others. It is logged and left
        // for the next pass; a repeat offender shows up in agent_runs.
        logger?.error?.('tick failed', {
          negotiationId: negotiation.id,
          error: error?.message ?? String(error),
        });
        results.push({ negotiationId: negotiation.id, error: error?.message ?? String(error) });
      }
    }

    return { picked: due.length, results };
  }

  function start() {
    if (timer) return;
    stopped = false;
    logger?.info?.('agent runner started', {
      tickMs: config.agent.tickMs,
      dryRun: config.agent.dryRun,
      enabled: config.agent.enabled,
    });

    timer = setInterval(async () => {
      // Never overlap passes: a slow tick must not have a second copy of itself
      // deciding on the same negotiation.
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        await runOnce();
      } catch (error) {
        logger?.error?.('runner pass failed', { error: error?.message ?? String(error) });
      } finally {
        inFlight = false;
      }
    }, config.agent.tickMs);

    // Do not hold the process open on the timer alone.
    timer.unref?.();
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    logger?.info?.('agent runner stopped');
  }

  return { start, stop, runOnce };
}
