import Router from '@koa/router';
import { authService } from './auth.service.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { loginSchema, rotatePasswordSchema } from './validator.js';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { auditService } from '../admin/audit/audit.service.js';

export const authRouter = new Router({ prefix: '/auth' });

// POST /v1/auth/login — public
authRouter.post('/login', validate({ body: loginSchema }), async (ctx) => {
  const { username, password } = ctx.request.body;
  const meta = {
    ipAddress: ctx.ip,
    userAgent: ctx.get('User-Agent'),
  };
  const { token, accountId } = await authService.login(username, password, meta);

  await auditService.record({
    actorAccountId: accountId,
    actionType: 'auth.login',
    entityType: 'session',
    entityId: accountId,
    requestId: ctx.state.requestId,
  });

  ctx.status = 200;
  ctx.body = {
    data: { token },
    meta: { requestId: ctx.state.requestId },
  };
});

// POST /v1/auth/logout
authRouter.post(
  '/logout',
  requirePermission('auth', 'logout'),
  async (ctx) => {
    const rawToken = ctx.get('Authorization').slice(7);
    await authService.logout(rawToken);

    await auditService.record({
      actorAccountId: ctx.state.user.id,
      actionType: 'auth.logout',
      entityType: 'session',
      entityId: ctx.state.user.id,
      requestId: ctx.state.requestId,
    });

    ctx.status = 200;
    ctx.body = { data: { message: 'Logged out' }, meta: { requestId: ctx.state.requestId } };
  },
);

// POST /v1/auth/password/rotate
authRouter.post(
  '/password/rotate',
  requirePermission('accounts', 'self:update-password'),
  validate({ body: rotatePasswordSchema }),
  async (ctx) => {
    const { currentPassword, newPassword } = ctx.request.body;
    await authService.rotatePassword(ctx.state.user.id, currentPassword, newPassword);

    await auditService.record({
      actorAccountId: ctx.state.user.id,
      actionType: 'auth.password_rotated',
      entityType: 'account',
      entityId: ctx.state.user.id,
      requestId: ctx.state.requestId,
    });

    ctx.status = 200;
    ctx.body = {
      data: { message: 'Password changed. Please log in again.' },
      meta: { requestId: ctx.state.requestId },
    };
  },
);
