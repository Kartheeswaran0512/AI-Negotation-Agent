/**
 * Demo-grade authentication.
 *
 * A shared `x-api-key` for the application and an `x-user-id` header for
 * identity. That is enough for a single-user personal project and is
 * deliberately simple - but the ownership checks it feeds are not: the accept
 * route compares the caller against the requirement's owner, so "who may close
 * this deal" is a real check even though "who are you" is a placeholder.
 *
 * Replace with real sessions or JWTs before this faces anyone but you.
 */

export function apiKeyAuth(config) {
  return function apiKeyAuthMiddleware(req, res, next) {
    // An empty API_KEY disables the check, which is what makes a fresh clone
    // runnable. It is refused outright in production.
    if (!config.apiKey) {
      if (config.isProduction) {
        return next(Object.assign(new Error('API_KEY must be set in production'), { status: 500 }));
      }
      return next();
    }

    const provided = req.get('x-api-key');
    if (provided !== config.apiKey) {
      return next(Object.assign(new Error('invalid or missing x-api-key'), { status: 401 }));
    }
    return next();
  };
}

/** Puts the caller's user id on the request, when they sent one. */
export function identity() {
  return function identityMiddleware(req, _res, next) {
    const raw = req.get('x-user-id');
    req.userId = raw && /^\d+$/.test(raw) ? Number(raw) : (raw ?? null);
    next();
  };
}

/** For routes that need to know who is calling. */
export function requireUser(req, _res, next) {
  if (req.userId === null || req.userId === undefined || req.userId === '') {
    return next(Object.assign(new Error('this route requires an x-user-id header'), { status: 401 }));
  }
  return next();
}
