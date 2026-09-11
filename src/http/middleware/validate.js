/**
 * Request validation with Zod.
 *
 * Every route body is parsed into a known shape before it reaches a service, so
 * services can assume their inputs and spend their code on business rules.
 */

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
export function validate(schema, source = 'body') {
  return function validateMiddleware(req, _res, next) {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const error = new Error('request validation failed');
      error.status = 422;
      error.details = parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
      }));
      return next(error);
    }
    req.valid = { ...(req.valid ?? {}), [source]: parsed.data };
    return next();
  };
}
