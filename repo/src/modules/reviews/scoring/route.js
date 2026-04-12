import Router from '@koa/router';
import { requirePermission } from '../../rbac/rbac.middleware.js';
import { validate } from '../../../common/middleware/validate.middleware.js';
import { scoringService } from './scoring.service.js';
import { z } from 'zod';

export const scoringRouter = new Router({ prefix: '/scores' });

const criterionScoreValue = z
  .number()
  .min(0)
  .max(10)
  .refine((n) => Math.round(n * 2) === n * 2, {
    message: 'Score must be a multiple of 0.5',
  });

const scoreBodySchema = z.object({
  assignmentId: z.string().uuid(),
  criterionScores: z.record(z.string(), criterionScoreValue),
  narrativeComments: z.string().max(5000).optional(),
  recommendation: z
    .enum(['strong_admit', 'admit', 'borderline', 'reject', 'strong_reject'])
    .optional(),
});

// PUT /v1/scores/draft — save or update a draft score
scoringRouter.put(
  '/draft',
  requirePermission('review', 'submit'),
  validate({ body: scoreBodySchema }),
  async (ctx) => {
    const score = await scoringService.saveDraft(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: score, meta: { requestId: ctx.state.requestId } };
  },
);

// POST /v1/scores/submit — finalise and submit a score
scoringRouter.post(
  '/submit',
  requirePermission('review', 'submit'),
  validate({
    body: scoreBodySchema.extend({
      recommendation: z.enum(['strong_admit', 'admit', 'borderline', 'reject', 'strong_reject']),
    }),
  }),
  async (ctx) => {
    const score = await scoringService.submit(
      ctx.request.body,
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.body = { data: score, meta: { requestId: ctx.state.requestId } };
  },
);

// GET /v1/scores/:assignmentId
scoringRouter.get(
  '/:assignmentId',
  requirePermission('review', 'read-assigned'),
  validate({ params: z.object({ assignmentId: z.string().uuid() }) }),
  async (ctx) => {
    const score = await scoringService.getByAssignment(
      ctx.params.assignmentId,
      ctx.state.user,
    );
    ctx.body = { data: score, meta: { requestId: ctx.state.requestId } };
  },
);
