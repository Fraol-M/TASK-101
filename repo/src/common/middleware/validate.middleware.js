import { ValidationError } from '../errors/AppError.js';

/**
 * Validation middleware factory using Zod schemas.
 *
 * Usage:
 *   router.post('/route', validate({ body: MyBodySchema, query: MyQuerySchema }), handler)
 *
 * On success, replaces ctx.request.body / ctx.query / ctx.params with the parsed,
 * type-coerced values from Zod.
 *
 * On failure, throws ValidationError with field-level details.
 *
 * @param {{ body?: ZodSchema, query?: ZodSchema, params?: ZodSchema }} schemas
 */
export function validate(schemas = {}) {
  return async function validateMiddleware(ctx, next) {
    const errors = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(ctx.request.body);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ field: issue.path.join('.'), issue: issue.message });
        }
      } else {
        ctx.request.body = result.data;
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(ctx.query);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ field: `query.${issue.path.join('.')}`, issue: issue.message });
        }
      } else {
        ctx.query = result.data;
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(ctx.params);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({ field: `params.${issue.path.join('.')}`, issue: issue.message });
        }
      } else {
        ctx.params = result.data;
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Request validation failed', errors);
    }

    await next();
  };
}
