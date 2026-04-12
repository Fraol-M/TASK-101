import { ulid } from 'ulid';

/**
 * Assigns a unique request ID to every incoming request.
 * Must be the first middleware in the stack so all subsequent logs include it.
 *
 * Sets ctx.state.requestId and adds X-Request-Id response header.
 */
export function requestIdMiddleware() {
  return async function requestId(ctx, next) {
    ctx.state.requestId = ulid();
    ctx.set('X-Request-Id', ctx.state.requestId);
    await next();
  };
}
