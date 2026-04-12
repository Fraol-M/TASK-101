import Router from '@koa/router';
import { requirePermission } from '../../rbac/rbac.middleware.js';
import { validate } from '../../../common/middleware/validate.middleware.js';
import { assignmentService } from './assignment.service.js';
import { z } from 'zod';

export const assignmentsRouter = new Router({ prefix: '/assignments' });

const createAssignmentSchema = z.object({
  applicationId: z.string().uuid(),
  reviewerId: z.string().uuid(),
  // cycleId is optional — the server derives it from the application record.
  // If supplied, it must match; mismatches are rejected as 422.
  cycleId: z.string().uuid().optional(),
  mode: z.enum(['random', 'rule_based', 'manual']).default('manual'),
  blindMode: z.enum(['blind', 'semi_blind', 'full']).default('blind'),
  dueAt: z.string().datetime().optional().nullable(),
});

const batchAssignSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(500),
  // cycleId is optional — the server derives it from the application records.
  // If supplied, all applications must belong to that cycle; mismatches are rejected as 422.
  cycleId: z.string().uuid().optional(),
  mode: z.enum(['random', 'rule_based']).default('random'),
  blindMode: z.enum(['blind', 'semi_blind', 'full']).default('blind'),
  reviewersPerApplication: z.number().int().min(1).max(10).optional(),
});

// POST /v1/assignments — manual single assignment
assignmentsRouter.post(
  '/',
  requirePermission('review-assignments', 'manage'),
  validate({ body: createAssignmentSchema }),
  async (ctx) => {
    const assignment = await assignmentService.create(
      { ...ctx.request.body, assignedBy: ctx.state.user.id },
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: assignment, meta: { requestId: ctx.state.requestId } };
  },
);

// POST /v1/assignments/batch — batch random/rule-based assignment
assignmentsRouter.post(
  '/batch',
  requirePermission('review-assignments', 'manage'),
  validate({ body: batchAssignSchema }),
  async (ctx) => {
    const result = await assignmentService.batchAssign(
      { ...ctx.request.body, assignedBy: ctx.state.user.id },
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = {
      data: result.created,
      meta: {
        requestId: ctx.state.requestId,
        total: result.created.length,
        errors: result.errors,
      },
    };
  },
);

// GET /v1/assignments — list (filtered by reviewer for non-admins)
assignmentsRouter.get(
  '/',
  requirePermission('review', 'read-assigned'),
  validate({
    query: z.object({
      cycleId: z.string().uuid().optional(),
      status: z.enum(['assigned', 'submitted', 'skipped']).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  }),
  async (ctx) => {
    const result = await assignmentService.list(ctx.query, ctx.state.user);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

// GET /v1/assignments/:id
assignmentsRouter.get(
  '/:id',
  requirePermission('review', 'read-assigned'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (ctx) => {
    const assignment = await assignmentService.getById(ctx.params.id, ctx.state.user);
    ctx.body = { data: assignment, meta: { requestId: ctx.state.requestId } };
  },
);
