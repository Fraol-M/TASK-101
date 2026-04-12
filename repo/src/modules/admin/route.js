import Router from '@koa/router';
import { registry } from '../../common/metrics/metrics.js';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { auditService } from './audit/audit.service.js';
import { reviewerPoolService } from './reviewer-pool/reviewer-pool.service.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { z } from 'zod';

export const adminRouter = new Router({ prefix: '/admin' });

// ── Metrics endpoint (admin only) ─────────────────────────────────────────────
adminRouter.get('/metrics', requirePermission('metrics', 'read'), async (ctx) => {
  ctx.set('Content-Type', registry.contentType);
  ctx.body = await registry.metrics();
});

// ── Audit events ──────────────────────────────────────────────────────────────
const auditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  actionType: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

adminRouter.get(
  '/audit-events',
  requirePermission('audit', 'read'),
  validate({ query: auditQuerySchema }),
  async (ctx) => {
    const result = await auditService.query(ctx.query, ctx.state.user);
    ctx.body = {
      data: result.events,
      meta: {
        requestId: ctx.state.requestId,
        page: ctx.query.page,
        pageSize: ctx.query.pageSize,
        total: result.total,
      },
    };
  },
);

// ── Reviewer pool management ──────────────────────────────────────────────────

adminRouter.get(
  '/reviewer-pool',
  requirePermission('reviewers', 'manage'),
  async (ctx) => {
    const result = await reviewerPoolService.list(ctx.query, ctx.query);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

const reviewerPoolIdParams = z.object({ id: z.string().uuid() });

adminRouter.get(
  '/reviewer-pool/:id',
  requirePermission('reviewers', 'manage'),
  validate({ params: reviewerPoolIdParams }),
  async (ctx) => {
    const profile = await reviewerPoolService.getById(ctx.params.id);
    ctx.body = { data: profile, meta: { requestId: ctx.state.requestId } };
  },
);

adminRouter.post(
  '/reviewer-pool',
  requirePermission('reviewers', 'manage'),
  validate({
    body: z.object({
      accountId: z.string().uuid(),
      maxLoad: z.number().int().min(1).max(50).optional(),
      expertiseTags: z.array(z.string()).optional(),
    }),
  }),
  async (ctx) => {
    const profile = await reviewerPoolService.create(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: profile, meta: { requestId: ctx.state.requestId } };
  },
);

adminRouter.patch(
  '/reviewer-pool/:id',
  requirePermission('reviewers', 'manage'),
  validate({
    params: reviewerPoolIdParams,
    body: z.object({
      available: z.boolean().optional(),
      active: z.boolean().optional(),
      maxLoad: z.number().int().min(1).max(50).optional(),
      expertiseTags: z.array(z.string()).optional(),
    }).strip(),
  }),
  async (ctx) => {
    const profile = await reviewerPoolService.update(
      ctx.params.id,
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: profile, meta: { requestId: ctx.state.requestId } };
  },
);

adminRouter.post(
  '/reviewer-pool/:id/institution-history',
  requirePermission('reviewers', 'manage'),
  validate({
    params: reviewerPoolIdParams,
    body: z.object({
      universityId: z.string().uuid(),
      role: z.enum(['employed', 'enrolled', 'visiting', 'adjunct', 'other']),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    }),
  }),
  async (ctx) => {
    const entry = await reviewerPoolService.addInstitutionHistory(
      { reviewerId: ctx.params.id, ...ctx.request.body },
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: entry, meta: { requestId: ctx.state.requestId } };
  },
);
