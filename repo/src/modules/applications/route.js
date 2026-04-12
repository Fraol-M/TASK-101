import Router from '@koa/router';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { applicationService } from './application.service.js';
import { z } from 'zod';

export const applicationsRouter = new Router({ prefix: '/applications' });

const createApplicationSchema = z.object({
  cycleId: z.string().uuid(),
  programChoices: z.array(z.object({
    majorId: z.string().uuid(),
    preferenceOrder: z.number().int().min(1).max(10),
  })).min(1),
  institutionHistory: z.array(z.object({
    universityId: z.string().uuid(),
    role: z.enum(['enrolled', 'employed', 'visiting', 'other']),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  })).optional(),
});

applicationsRouter.post(
  '/',
  requirePermission('applications', 'write'),
  validate({ body: createApplicationSchema }),
  async (ctx) => {
    const app = await applicationService.create(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: app, meta: { requestId: ctx.state.requestId } };
  },
);

applicationsRouter.get(
  '/',
  requirePermission('applications', 'read'),
  validate({
    query: z.object({
      cycleId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  async (ctx) => {
    const apps = await applicationService.list(ctx.state.user, ctx.query);
    ctx.body = {
      data: apps.rows,
      meta: { requestId: ctx.state.requestId, total: apps.total },
    };
  },
);

applicationsRouter.get(
  '/:id',
  requirePermission('applications', 'read'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (ctx) => {
    const app = await applicationService.getById(ctx.params.id, ctx.state.user);
    ctx.body = { data: app, meta: { requestId: ctx.state.requestId } };
  },
);
