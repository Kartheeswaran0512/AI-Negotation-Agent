/**
 * A small fixed-window rate limiter, in memory.
 *
 * Enough for a single-process personal project. It exists mainly to protect the
 * routes that can reach a paid model behind an authenticated caller; move it to
 * Redis the day a second process appears.
 */

export function rateLimit({ windowMs = 60_000, max = 60, key = defaultKey } = {}) {
  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const bucketKey = key(req);
    const bucket = hits.get(bucketKey);

    if (!bucket || now >= bucket.resetAt) {
      hits.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.set('retry-after', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(Object.assign(new Error('too many requests'), { status: 429 }));
    }

    // Opportunistic cleanup so the map cannot grow without bound.
    if (hits.size > 5000) {
      for (const [existingKey, existing] of hits) {
        if (now >= existing.resetAt) hits.delete(existingKey);
      }
    }
    return next();
  };
}

function defaultKey(req) {
  return `${req.get('x-user-id') ?? 'anon'}:${req.ip ?? 'noip'}`;
}
