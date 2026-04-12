import { rbacService } from './rbac.service.js';
import { AuthorizationError } from '../../common/errors/AppError.js';

/**
 * RBAC permission middleware factory.
 *
 * Usage:
 *   router.get('/path', requirePermission('resource', 'action'), handler)
 *
 * The capability is formed as 'resource:action' (e.g., 'university-data:publish').
 *
 * Authorization layers:
 *   1. This middleware performs route-level capability check
 *   2. Object-level checks are performed inside service methods
 *
 * @param {string} resource  e.g. 'university-data'
 * @param {string} action    e.g. 'publish'
 */
export function requirePermission(resource, action) {
  const capability = `${resource}:${action}`;

  return async function checkPermission(ctx, next) {
    const user = ctx.state.user;

    if (!user) {
      throw new AuthorizationError('Authentication required');
    }

    const allowed = await rbacService.can(user.id, capability);
    if (!allowed) {
      throw new AuthorizationError(`Missing permission: ${capability}`);
    }

    await next();
  };
}
