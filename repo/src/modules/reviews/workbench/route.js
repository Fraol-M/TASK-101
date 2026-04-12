import Router from '@koa/router';
import { requirePermission } from '../../rbac/rbac.middleware.js';
import { validate } from '../../../common/middleware/validate.middleware.js';
import { workbenchService } from './workbench.service.js';
import { z } from 'zod';

export const workbenchRouter = new Router({ prefix: '/workbench' });

// GET /v1/workbench — reviewer's own pending assignments
workbenchRouter.get(
  '/',
  requirePermission('review', 'read-assigned'),
  async (ctx) => {
    const result = await workbenchService.listMyAssignments(ctx.state.user, ctx.query);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

// GET /v1/workbench/:assignmentId — blind-projected view of an assignment
workbenchRouter.get(
  '/:assignmentId',
  requirePermission('review', 'read-assigned'),
  validate({ params: z.object({ assignmentId: z.string().uuid() }) }),
  async (ctx) => {
    const data = await workbenchService.getWorkbench(
      ctx.params.assignmentId,
      ctx.state.user,
    );
    ctx.body = { data, meta: { requestId: ctx.state.requestId } };
  },
);
