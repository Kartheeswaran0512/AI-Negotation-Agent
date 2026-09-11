/**
 * One error shape for the whole API.
 *
 * Service errors carry their own `status`; anything else is a 500 and its
 * message is not echoed back, because an unexpected error message is the sort
 * of thing that leaks a query, a path or a driver internal.
 */

export function notFound(_req, _res, next) {
  next(Object.assign(new Error('route not found'), { status: 404 }));
}

export function errorHandler(logger = null) {
  // Express identifies error handlers by arity: all four parameters are needed.
  // eslint-disable-next-line no-unused-vars
  return function errorHandlerMiddleware(error, _req, res, _next) {
    const status = Number.isInteger(error?.status) ? error.status : 500;

    if (status >= 500) {
      logger?.error?.('unhandled request error', {
        error: error?.message ?? String(error),
        stack: error?.stack ?? null,
      });
    }

    res.status(status).json({
      ok: false,
      error: {
        message: status >= 500 ? 'internal server error' : (error?.message ?? 'request failed'),
        details: error?.details ?? null,
      },
    });
  };
}
