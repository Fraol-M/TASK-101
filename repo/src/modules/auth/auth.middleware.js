import { sessionService } from './session.service.js';
import { AuthenticationError } from '../../common/errors/AppError.js';

/**
 * Routes that do not require authentication.
 * Matched against ctx.path exactly.
 */
const PUBLIC_PATHS = new Set([
  '/health',
  '/v1/auth/login',
]);

/**
 * Authentication middleware.
 *
 * Runs on every request. For non-public routes:
 * 1. Extracts Bearer token from Authorization header
 * 2. Looks up session (SELECT FOR UPDATE SKIP LOCKED to prevent rotation races)
 * 3. Validates idle and absolute timeouts
 * 4. Rotates token if rotation interval has elapsed
 * 5. Sets ctx.state.user with { id, username, roles }
 *
 * Skips public routes (see PUBLIC_PATHS).
 */
export function authMiddleware() {
  return async function authenticate(ctx, next) {
    if (PUBLIC_PATHS.has(ctx.path)) {
      await next();
      return;
    }

    const authHeader = ctx.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing or malformed Authorization header');
    }

    const rawToken = authHeader.slice(7);
    const { user, newToken } = await sessionService.validateAndRotate(rawToken);

    ctx.state.user = user;

    // If token was rotated, include new token in response header
    if (newToken) {
      ctx.set('X-Session-Token', newToken);
    }

    await next();
  };
}
