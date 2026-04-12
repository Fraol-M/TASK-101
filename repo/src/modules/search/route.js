import Router from '@koa/router';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { searchService } from './search.service.js';
import { savedQueriesService } from './saved-queries.service.js';
import { z } from 'zod';

export const searchRouter = new Router({ prefix: '/search' });

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  entityTypes: z.string().optional().transform((v) => v?.split(',').filter(Boolean)),
  lifecycleStatus: z.string().optional().transform((v) => v?.split(',').filter(Boolean)),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nameContains: z.string().min(1).max(200).optional(),
  descriptionContains: z.string().min(1).max(200).optional(),
  tags: z.string().optional().transform((v) => v?.split(',').map((t) => t.trim()).filter(Boolean)),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const savedQueryIdParamsSchema = z.object({ id: z.string().uuid() });

// Filters object shared by saved-query create and patch
const filtersSchema = z.object({
  entityTypes: z.array(z.string()).optional(),
  lifecycleStatus: z.array(z.string()).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nameContains: z.string().min(1).max(200).optional(),
  descriptionContains: z.string().min(1).max(200).optional(),
  tags: z.array(z.string()).optional(),
}).optional();

const savedQuerySchema = z.object({
  name: z.string().min(1).max(200),
  queryText: z.string().min(1).max(500),
  filters: filtersSchema,
  subscribed: z.boolean().default(false),
});

const savedQueryPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  queryText: z.string().min(1).max(500).optional(),
  filters: filtersSchema,
  subscribed: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

// GET /v1/search?q=<query>
searchRouter.get(
  '/',
  requirePermission('search', 'query'),
  validate({ query: searchQuerySchema }),
  async (ctx) => {
    const { q, entityTypes, lifecycleStatus, effectiveFrom, effectiveTo,
            nameContains, descriptionContains, tags, page, pageSize } = ctx.query;
    const result = await searchService.search(q, {
      entityTypes,
      lifecycleStatus,
      effectiveFrom,
      effectiveTo,
      nameContains,
      descriptionContains,
      tags,
      page,
      pageSize,
      accountId: ctx.state.user?.id,
      requestId: ctx.state.requestId,
    });
    ctx.body = {
      data: result.rows,
      meta: {
        requestId: ctx.state.requestId,
        total: result.total,
        query: result.queryText,
        durationMs: result.durationMs,
        page,
        pageSize,
      },
    };
  },
);

// GET /v1/search/suggest?q=<prefix>
searchRouter.get(
  '/suggest',
  requirePermission('search', 'query'),
  async (ctx) => {
    const prefix = String(ctx.query.q || '');
    const suggestions = await searchService.suggest(prefix);
    ctx.body = { data: suggestions, meta: { requestId: ctx.state.requestId } };
  },
);

// ── Saved queries ─────────────────────────────────────────────────────────────

// GET /v1/search/saved-queries
searchRouter.get(
  '/saved-queries',
  requirePermission('search', 'saved-query:manage'),
  async (ctx) => {
    const result = await savedQueriesService.list(ctx.state.user.id, ctx.query);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

// POST /v1/search/saved-queries
searchRouter.post(
  '/saved-queries',
  requirePermission('search', 'saved-query:manage'),
  validate({ body: savedQuerySchema }),
  async (ctx) => {
    const sq = await savedQueriesService.create({
      accountId: ctx.state.user.id,
      ...ctx.request.body,
    });
    ctx.status = 201;
    ctx.body = { data: sq, meta: { requestId: ctx.state.requestId } };
  },
);

// PATCH /v1/search/saved-queries/:id
searchRouter.patch(
  '/saved-queries/:id',
  requirePermission('search', 'saved-query:manage'),
  validate({ params: savedQueryIdParamsSchema, body: savedQueryPatchSchema }),
  async (ctx) => {
    const sq = await savedQueriesService.update(ctx.params.id, ctx.state.user.id, ctx.request.body);
    ctx.body = { data: sq, meta: { requestId: ctx.state.requestId } };
  },
);

// DELETE /v1/search/saved-queries/:id
searchRouter.delete(
  '/saved-queries/:id',
  requirePermission('search', 'saved-query:manage'),
  validate({ params: savedQueryIdParamsSchema }),
  async (ctx) => {
    await savedQueriesService.delete(ctx.params.id, ctx.state.user.id);
    ctx.status = 204;
  },
);

// POST /v1/search/saved-queries/:id/run — execute a saved query
searchRouter.post(
  '/saved-queries/:id/run',
  requirePermission('search', 'saved-query:manage'),
  validate({ params: savedQueryIdParamsSchema }),
  async (ctx) => {
    const result = await savedQueriesService.run(ctx.params.id, ctx.state.user.id);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total, query: result.queryText },
    };
  },
);
