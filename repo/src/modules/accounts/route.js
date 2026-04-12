import Router from '@koa/router';
import { accountService } from './account.service.js';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { z } from 'zod';

export const accountsRouter = new Router({ prefix: '/accounts' });

const createAccountSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(12),
  email: z.string().email().optional(),
  displayName: z.string().max(200).optional(),
});

const accountIdParamsSchema = z.object({ id: z.string().uuid() });

// GET /v1/accounts/me — authenticated user's own profile
accountsRouter.get('/me', requirePermission('accounts', 'self:read'), async (ctx) => {
  const account = await accountService.getById(ctx.state.user.id);
  ctx.body = { data: account, meta: { requestId: ctx.state.requestId } };
});

// GET /v1/accounts/:id — admin only
accountsRouter.get(
  '/:id',
  requirePermission('accounts', 'admin:manage'),
  validate({ params: accountIdParamsSchema }),
  async (ctx) => {
    const account = await accountService.getById(ctx.params.id);
    ctx.body = { data: account, meta: { requestId: ctx.state.requestId } };
  },
);

// POST /v1/accounts — admin only
accountsRouter.post(
  '/',
  requirePermission('accounts', 'admin:manage'),
  validate({ body: createAccountSchema }),
  async (ctx) => {
    const account = await accountService.create(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: account, meta: { requestId: ctx.state.requestId } };
  },
);

// PATCH /v1/accounts/:id/status — admin only
accountsRouter.patch(
  '/:id/status',
  requirePermission('accounts', 'admin:manage'),
  validate({
    params: accountIdParamsSchema,
    body: z.object({ status: z.enum(['active', 'inactive', 'suspended']) }),
  }),
  async (ctx) => {
    const account = await accountService.updateStatus(
      ctx.params.id,
      ctx.request.body.status,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: account, meta: { requestId: ctx.state.requestId } };
  },
);
