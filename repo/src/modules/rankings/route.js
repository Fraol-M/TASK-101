import Router from '@koa/router';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { aggregationService } from './aggregation.service.js';
import { z } from 'zod';

export const rankingsRouter = new Router({ prefix: '/rankings' });

const cycleIdParams = z.object({ cycleId: z.string().uuid() });

// POST /v1/rankings/cycles/:cycleId/aggregate — trigger aggregation
rankingsRouter.post(
  '/cycles/:cycleId/aggregate',
  requirePermission('rankings', 'compute'),
  validate({ params: cycleIdParams }),
  async (ctx) => {
    const result = await aggregationService.aggregateCycle(
      ctx.params.cycleId,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: result, meta: { requestId: ctx.state.requestId } };
  },
);

// POST /v1/rankings/cycles/:cycleId/rank — compute rankings
rankingsRouter.post(
  '/cycles/:cycleId/rank',
  requirePermission('rankings', 'compute'),
  validate({ params: cycleIdParams }),
  async (ctx) => {
    const result = await aggregationService.rankCycle(
      ctx.params.cycleId,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: result, meta: { requestId: ctx.state.requestId } };
  },
);

// GET /v1/rankings/cycles/:cycleId — get ranked list
rankingsRouter.get(
  '/cycles/:cycleId',
  requirePermission('rankings', 'read'),
  validate({ params: cycleIdParams }),
  async (ctx) => {
    const result = await aggregationService.getRankings(ctx.params.cycleId, ctx.query);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

// POST /v1/rankings/escalations — manual escalation
rankingsRouter.post(
  '/escalations',
  requirePermission('escalations', 'write'),
  validate({
    body: z.object({
      applicationId: z.string().uuid(),
      cycleId: z.string().uuid(),
      trigger: z.enum(['high_variance', 'missing_reviews', 'borderline_tie', 'manual']).default('manual'),
      notes: z.string().max(2000).optional(),
    }),
  }),
  async (ctx) => {
    const event = await aggregationService.escalate(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: event, meta: { requestId: ctx.state.requestId } };
  },
);
