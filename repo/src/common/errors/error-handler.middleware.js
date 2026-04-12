import { AppError } from './AppError.js';

/**
 * Koa error-handling middleware.
 * Must be the outermost middleware (registered before the router) so it catches
 * all errors thrown during request processing.
 *
 * Distinguishes AppError (expected, client-facing) from unexpected errors and
 * logs at the appropriate level.
 */
export function errorHandlerMiddleware(logger) {
  return async function errorHandler(ctx, next) {
    try {
      await next();
    } catch (err) {
      const requestId = ctx.state.requestId || 'unknown';

      if (err instanceof AppError) {
        ctx.status = err.statusCode;
        ctx.body = {
          error: {
            code: err.code,
            message: err.message,
            ...(err.details?.length ? { details: err.details } : {}),
          },
          meta: { requestId },
        };

        // Log 4xx at warn, 5xx at error
        if (err.statusCode >= 500) {
          logger.error({ err, requestId }, err.message);
        } else {
          logger.warn({ code: err.code, statusCode: err.statusCode, requestId }, err.message);
        }
      } else {
        // Unexpected error — do not leak internals to the client
        ctx.status = 500;
        ctx.body = {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
          },
          meta: { requestId },
        };
        logger.error({ err, requestId }, 'Unhandled error');
      }

      // Emit the error on the Koa app so koa can handle it in its own error handler
      ctx.app.emit('error', err, ctx);
    }
  };
}
