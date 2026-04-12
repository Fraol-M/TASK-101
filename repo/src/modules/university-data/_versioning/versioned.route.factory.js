import Router from '@koa/router';
import { requirePermission } from '../../rbac/rbac.middleware.js';
import { validate } from '../../../common/middleware/validate.middleware.js';
import {
  publishVersionSchema,
  paginationSchema,
  versionParamsSchema,
} from './versioned.validator.js';
import { z } from 'zod';

/**
 * Creates a standard versioned entity router.
 * All 8 university-data entities use this factory.
 *
 * @param {string} prefix       Route prefix e.g. '/universities'
 * @param {object} service      Versioned service instance
 * @param {object} createSchema Zod schema for create body
 * @param {object} fkFields     Map of camelCase body key → snake_case stable-table column
 *                              e.g. { universityId: 'university_id' } for schools
 */
export function makeVersionedRouter(prefix, service, createSchema, fkFields = {}) {
  const router = new Router({ prefix });

  // POST /v1/{entity} — create entity + initial draft
  router.post(
    '/',
    requirePermission('university-data', 'write'),
    validate({ body: createSchema }),
    async (ctx) => {
      const { name } = ctx.request.body;
      const stableData = { name_normalized: name.toLowerCase().replace(/\s+/g, ' ').trim() };
      // Map entity-specific FK fields (camelCase from body → snake_case stable table column)
      for (const [camel, snake] of Object.entries(fkFields)) {
        if (ctx.request.body[camel] != null) stableData[snake] = ctx.request.body[camel];
      }
      const result = await service.create(stableData, ctx.request.body, ctx.state.user.id, ctx.state.requestId);
      ctx.status = 201;
      ctx.body = { data: result, meta: { requestId: ctx.state.requestId } };
    },
  );

  // GET /v1/{entity} — list current active versions
  router.get(
    '/',
    requirePermission('university-data', 'read'),
    validate({ query: paginationSchema }),
    async (ctx) => {
      const result = await service.listCurrent({}, ctx.query);
      ctx.body = {
        data: result.rows,
        meta: { requestId: ctx.state.requestId, total: result.total, ...ctx.query },
      };
    },
  );

  const stableIdParamsSchema = versionParamsSchema.pick({ stableId: true });

  // GET /v1/{entity}/:stableId — get current active version
  router.get(
    '/:stableId',
    requirePermission('university-data', 'read'),
    validate({ params: stableIdParamsSchema }),
    async (ctx) => {
      const version = await service.findCurrent(ctx.params.stableId);
      ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
    },
  );

  // GET /v1/{entity}/:stableId/current — alias
  router.get(
    '/:stableId/current',
    requirePermission('university-data', 'read'),
    validate({ params: stableIdParamsSchema }),
    async (ctx) => {
      const version = await service.findCurrent(ctx.params.stableId);
      ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
    },
  );

  // GET /v1/{entity}/:stableId/versions — list version history
  router.get(
    '/:stableId/versions',
    requirePermission('university-data', 'read'),
    validate({ params: stableIdParamsSchema }),
    async (ctx) => {
      const history = await service.findHistory(ctx.params.stableId);
      ctx.body = {
        data: history,
        meta: { requestId: ctx.state.requestId, total: history.length },
      };
    },
  );

  // GET /v1/{entity}/:stableId/versions/:versionId — specific version
  router.get(
    '/:stableId/versions/:versionId',
    requirePermission('university-data', 'read'),
    validate({ params: versionParamsSchema }),
    async (ctx) => {
      const version = await service.findVersionById(ctx.params.stableId, ctx.params.versionId);
      ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
    },
  );

  // POST /v1/{entity}/:stableId/versions — create new draft
  router.post(
    '/:stableId/versions',
    requirePermission('university-data', 'write'),
    validate({ params: stableIdParamsSchema, body: createSchema }),
    async (ctx) => {
      const version = await service.createNewDraft(
        ctx.params.stableId,
        ctx.request.body,
        ctx.state.user.id,
        ctx.state.requestId,
      );
      ctx.status = 201;
      ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
    },
  );

  // PATCH /v1/{entity}/:stableId/versions/:versionId — update draft
  router.patch(
    '/:stableId/versions/:versionId',
    requirePermission('university-data', 'write'),
    validate({ params: versionParamsSchema, body: createSchema.partial() }),
    async (ctx) => {
      const version = await service.updateDraft(
        ctx.params.stableId,
        ctx.params.versionId,
        ctx.request.body,
        ctx.state.user.id,
        ctx.state.requestId,
      );
      ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
    },
  );

  // POST /v1/{entity}/:stableId/versions/:versionId/publish — publish version
  router.post(
    '/:stableId/versions/:versionId/publish',
    requirePermission('university-data', 'publish'),
    validate({ params: versionParamsSchema, body: publishVersionSchema }),
    async (ctx) => {
      const version = await service.publish(
        ctx.params.stableId,
        ctx.params.versionId,
        ctx.state.user.id,
        ctx.state.requestId,
        ctx.request.body.effectiveFrom, // override stored effective_from if supplied
      );
      ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
    },
  );

  // POST /v1/{entity}/:stableId/versions/:versionId/activate
  // Manually promotes the named scheduled version to active.
  // Rejects with 422 if the version's effective_from is still in the future.
  router.post(
    '/:stableId/versions/:versionId/activate',
    requirePermission('university-data', 'publish'),
    validate({ params: versionParamsSchema }),
    async (ctx) => {
      let version;
      try {
        version = await service.promoteScheduled(
          ctx.params.stableId,
          ctx.state.user.id,
          ctx.state.requestId,
          ctx.params.versionId,
        );
      } catch (err) {
        if (err.code === 'NOT_DUE') {
          ctx.status = 422;
          ctx.body = {
            error: { code: 'VERSION_NOT_DUE', message: err.message },
            meta: { requestId: ctx.state.requestId },
          };
          return;
        }
        throw err;
      }
      if (!version) {
        ctx.status = 404;
        ctx.body = {
          error: { code: 'NOT_FOUND', message: 'Version not found or not in scheduled state' },
          meta: { requestId: ctx.state.requestId },
        };
      } else {
        ctx.body = { data: version, meta: { requestId: ctx.state.requestId } };
      }
    },
  );

  // POST /v1/{entity}/:stableId/archive — archive entity
  router.post(
    '/:stableId/archive',
    requirePermission('university-data', 'archive'),
    validate({ params: stableIdParamsSchema }),
    async (ctx) => {
      const count = await service.archive(ctx.params.stableId, ctx.state.user.id, ctx.state.requestId);
      if (!count) {
        ctx.status = 404;
        ctx.body = {
          error: { code: 'NOT_FOUND', message: 'Entity not found or already archived' },
          meta: { requestId: ctx.state.requestId },
        };
        return;
      }
      ctx.body = { data: { archived: true }, meta: { requestId: ctx.state.requestId } };
    },
  );

  return router;
}
