import Router from '@koa/router';
import { rbacService } from './rbac.service.js';
import { requirePermission } from './rbac.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { z } from 'zod';

export const rbacRouter = new Router({ prefix: '/admin' });

const createRoleSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[A-Z_]+$/, 'Role names must be uppercase with underscores'),
  description: z.string().max(500).optional(),
});

const assignRoleSchema = z.object({
  roleName: z.string().min(1),
});

const idParamsSchema = z.object({ id: z.string().uuid() });

rbacRouter.get('/roles', requirePermission('rbac', 'read'), async (ctx) => {
  const roles = await rbacService.listRoles();
  ctx.body = { data: roles, meta: { requestId: ctx.state.requestId } };
});

rbacRouter.post(
  '/roles',
  requirePermission('rbac', 'write'),
  validate({ body: createRoleSchema }),
  async (ctx) => {
    const role = await rbacService.createRole(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: role, meta: { requestId: ctx.state.requestId } };
  },
);

rbacRouter.patch(
  '/roles/:id',
  requirePermission('rbac', 'write'),
  validate({ params: idParamsSchema }),
  async (ctx) => {
    const role = await rbacService.updateRole(
      ctx.params.id,
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: role, meta: { requestId: ctx.state.requestId } };
  },
);

rbacRouter.post(
  '/accounts/:id/roles',
  requirePermission('rbac', 'write'),
  validate({ params: idParamsSchema, body: assignRoleSchema }),
  async (ctx) => {
    await rbacService.assignRole(
      ctx.params.id,
      ctx.request.body.roleName,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 200;
    ctx.body = { data: { assigned: true }, meta: { requestId: ctx.state.requestId } };
  },
);

rbacRouter.get('/permissions', requirePermission('rbac', 'read'), async (ctx) => {
  const permissions = await rbacService.listPermissions();
  ctx.body = { data: permissions, meta: { requestId: ctx.state.requestId } };
});
