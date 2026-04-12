import Router from '@koa/router';
import { requirePermission } from '../rbac/rbac.middleware.js';
import { validate } from '../../common/middleware/validate.middleware.js';
import { personalizationService } from './personalization.service.js';
import { z } from 'zod';

export const personalizationRouter = new Router({ prefix: '/personalization' });

const bookmarkSchema = z.object({
  entityType: z.string().min(1).max(50),
  stableId: z.string().uuid(),
});

const recordViewSchema = z.object({
  entityType: z.string().min(1).max(50),
  stableId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
});

const prefValueSchema = z.object({
  value: z.unknown(),
});

const tagSubscriptionSchema = z.object({
  tag: z.string().min(1).max(200),
  tagType: z.enum(['topic', 'field', 'entity_type', 'custom']).default('topic'),
});

// POST /v1/personalization/views — record a view event
personalizationRouter.post(
  '/views',
  requirePermission('personalization', 'self:write'),
  validate({ body: recordViewSchema }),
  async (ctx) => {
    await personalizationService.recordView({
      accountId: ctx.state.user.id,
      ...ctx.request.body,
    });
    ctx.status = 204;
  },
);

// GET /v1/personalization/history
personalizationRouter.get(
  '/history',
  requirePermission('personalization', 'self:read'),
  async (ctx) => {
    const result = await personalizationService.getHistory(ctx.state.user.id, ctx.query);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

// GET /v1/personalization/bookmarks
personalizationRouter.get(
  '/bookmarks',
  requirePermission('personalization', 'self:read'),
  async (ctx) => {
    const result = await personalizationService.getBookmarks(ctx.state.user.id, ctx.query);
    ctx.body = {
      data: result.rows,
      meta: { requestId: ctx.state.requestId, total: result.total },
    };
  },
);

// POST /v1/personalization/bookmarks
personalizationRouter.post(
  '/bookmarks',
  requirePermission('personalization', 'self:write'),
  validate({ body: bookmarkSchema }),
  async (ctx) => {
    const bookmark = await personalizationService.addBookmark({
      accountId: ctx.state.user.id,
      ...ctx.request.body,
    });
    ctx.status = 201;
    ctx.body = { data: bookmark, meta: { requestId: ctx.state.requestId } };
  },
);

// DELETE /v1/personalization/bookmarks
personalizationRouter.delete(
  '/bookmarks',
  requirePermission('personalization', 'self:write'),
  validate({ body: bookmarkSchema }),
  async (ctx) => {
    await personalizationService.removeBookmark({
      accountId: ctx.state.user.id,
      ...ctx.request.body,
    });
    ctx.status = 204;
  },
);

// GET /v1/personalization/recommendations
personalizationRouter.get(
  '/recommendations',
  requirePermission('personalization', 'self:read'),
  async (ctx) => {
    const recs = await personalizationService.getRecommendations(ctx.state.user.id);
    ctx.body = {
      data: recs,
      meta: { requestId: ctx.state.requestId, total: recs.length },
    };
  },
);

// ── Preferences ──────────────────────────────────────────────────────────────

// GET /v1/personalization/preferences
personalizationRouter.get(
  '/preferences',
  requirePermission('personalization', 'self:read'),
  async (ctx) => {
    const prefs = await personalizationService.getPreferences(ctx.state.user.id);
    ctx.body = { data: prefs, meta: { requestId: ctx.state.requestId } };
  },
);

// PUT /v1/personalization/preferences/:key
personalizationRouter.put(
  '/preferences/:key',
  requirePermission('personalization', 'self:write'),
  validate({ body: prefValueSchema }),
  async (ctx) => {
    const pref = await personalizationService.setPreference(
      ctx.state.user.id,
      ctx.params.key,
      ctx.request.body.value,
    );
    ctx.body = { data: pref, meta: { requestId: ctx.state.requestId } };
  },
);

// DELETE /v1/personalization/preferences/:key
personalizationRouter.delete(
  '/preferences/:key',
  requirePermission('personalization', 'self:write'),
  async (ctx) => {
    await personalizationService.deletePreference(ctx.state.user.id, ctx.params.key);
    ctx.status = 204;
  },
);

// ── Tag subscriptions ─────────────────────────────────────────────────────────

// GET /v1/personalization/subscriptions
personalizationRouter.get(
  '/subscriptions',
  requirePermission('personalization', 'self:read'),
  async (ctx) => {
    const subs = await personalizationService.getTagSubscriptions(ctx.state.user.id);
    ctx.body = {
      data: subs,
      meta: { requestId: ctx.state.requestId, total: subs.length },
    };
  },
);

// POST /v1/personalization/subscriptions
personalizationRouter.post(
  '/subscriptions',
  requirePermission('personalization', 'self:write'),
  validate({ body: tagSubscriptionSchema }),
  async (ctx) => {
    const sub = await personalizationService.addTagSubscription({
      accountId: ctx.state.user.id,
      tag: ctx.request.body.tag,
      tagType: ctx.request.body.tagType,
    });
    ctx.status = 201;
    ctx.body = { data: sub, meta: { requestId: ctx.state.requestId } };
  },
);

// DELETE /v1/personalization/subscriptions/:tag
personalizationRouter.delete(
  '/subscriptions/:tag',
  requirePermission('personalization', 'self:write'),
  async (ctx) => {
    await personalizationService.removeTagSubscription({
      accountId: ctx.state.user.id,
      tag: decodeURIComponent(ctx.params.tag),
    });
    ctx.status = 204;
  },
);
