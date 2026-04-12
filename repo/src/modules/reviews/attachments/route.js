import Router from '@koa/router';
import { requirePermission } from '../../rbac/rbac.middleware.js';
import { validate } from '../../../common/middleware/validate.middleware.js';
import { attachmentService } from './attachment.service.js';
import { UnprocessableError } from '../../../common/errors/AppError.js';
import { z } from 'zod';

export const attachmentsRouter = new Router({ prefix: '/attachments' });

// POST /v1/attachments — upload file for an assignment
attachmentsRouter.post(
  '/',
  requirePermission('review', 'submit'),
  async (ctx) => {
    const { assignmentId } = ctx.request.body;
    if (!assignmentId) {
      throw new UnprocessableError('assignmentId is required');
    }

    const files = ctx.request.files;
    const file = files?.file;
    if (!file || Array.isArray(file)) {
      throw new UnprocessableError('A single file field named "file" is required');
    }

    const attachment = await attachmentService.upload(
      { assignmentId, file },
      ctx.state.user.id,
      ctx.state.requestId,
    );
    ctx.status = 201;
    ctx.body = { data: attachment, meta: { requestId: ctx.state.requestId } };
  },
);

// GET /v1/attachments?assignmentId=<uuid>
attachmentsRouter.get(
  '/',
  requirePermission('review', 'read-assigned'),
  validate({ query: z.object({ assignmentId: z.string().uuid() }) }),
  async (ctx) => {
    const attachments = await attachmentService.listByAssignment(
      ctx.query.assignmentId,
      ctx.state.user,
    );
    ctx.body = {
      data: attachments,
      meta: { requestId: ctx.state.requestId, total: attachments.length },
    };
  },
);

// DELETE /v1/attachments/:id
attachmentsRouter.delete(
  '/:id',
  requirePermission('review', 'submit'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (ctx) => {
    await attachmentService.delete(ctx.params.id, ctx.state.user, ctx.state.requestId);
    ctx.status = 204;
  },
);
