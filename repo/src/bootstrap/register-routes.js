import Router from '@koa/router';

// Module routers — imported as they are implemented
import { authRouter } from '../modules/auth/route.js';
import { accountsRouter } from '../modules/accounts/route.js';
import { rbacRouter } from '../modules/rbac/route.js';
import { universityDataRouter } from '../modules/university-data/index.js';
import { applicationsRouter } from '../modules/applications/route.js';
import { reviewsRouter } from '../modules/reviews/index.js';
import { rankingsRouter } from '../modules/rankings/route.js';
import { searchRouter } from '../modules/search/route.js';
import { personalizationRouter } from '../modules/personalization/route.js';
import { adminRouter } from '../modules/admin/route.js';

/**
 * Assembles all module routers under /v1 and returns the root router.
 *
 * Route registration is explicit and centralised here.
 * A static reviewer can trace every available endpoint by reading this file.
 */
export function registerRoutes() {
  const root = new Router();

  // Health check — public, no auth required
  root.get('/health', (ctx) => {
    ctx.body = { status: 'ok', timestamp: new Date().toISOString() };
  });

  // API v1 routes
  const v1 = new Router({ prefix: '/v1' });

  v1.use(authRouter.routes(), authRouter.allowedMethods());
  v1.use(accountsRouter.routes(), accountsRouter.allowedMethods());
  v1.use(rbacRouter.routes(), rbacRouter.allowedMethods());
  v1.use(universityDataRouter.routes(), universityDataRouter.allowedMethods());
  v1.use(applicationsRouter.routes(), applicationsRouter.allowedMethods());
  v1.use(reviewsRouter.routes(), reviewsRouter.allowedMethods());
  v1.use(rankingsRouter.routes(), rankingsRouter.allowedMethods());
  v1.use(searchRouter.routes(), searchRouter.allowedMethods());
  v1.use(personalizationRouter.routes(), personalizationRouter.allowedMethods());
  v1.use(adminRouter.routes(), adminRouter.allowedMethods());

  root.use(v1.routes(), v1.allowedMethods());

  return root;
}
