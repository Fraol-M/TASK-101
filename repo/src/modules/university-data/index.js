import Router from '@koa/router';
import { makeVersionedService } from './_versioning/versioned.service.factory.js';
import { makeVersionedRouter } from './_versioning/versioned.route.factory.js';
import { makeCreateEntitySchema } from './_versioning/versioned.validator.js';
import { z } from 'zod';

// ── Entity configurations ─────────────────────────────────────────────────────

const ENTITIES = [
  {
    prefix: '/universities',
    stableTable: 'universities',
    versionsTable: 'university_versions',
    stableIdColumn: 'university_id',
    entityType: 'university',
    extraSchema: {},
  },
  {
    prefix: '/schools',
    stableTable: 'schools',
    versionsTable: 'school_versions',
    stableIdColumn: 'school_id',
    entityType: 'school',
    extraSchema: {
      universityId: z.string().uuid(),
    },
  },
  {
    prefix: '/majors',
    stableTable: 'majors',
    versionsTable: 'major_versions',
    stableIdColumn: 'major_id',
    entityType: 'major',
    extraSchema: {
      schoolId: z.string().uuid(),
    },
  },
  {
    prefix: '/research-tracks',
    stableTable: 'research_tracks',
    versionsTable: 'research_track_versions',
    stableIdColumn: 'research_track_id',
    entityType: 'research_track',
    extraSchema: {
      majorId: z.string().uuid(),
    },
  },
  {
    prefix: '/enrollment-plans',
    stableTable: 'enrollment_plans',
    versionsTable: 'enrollment_plan_versions',
    stableIdColumn: 'enrollment_plan_id',
    entityType: 'enrollment_plan',
    extraSchema: {
      majorId: z.string().uuid(),
    },
  },
  {
    prefix: '/transfer-quotas',
    stableTable: 'transfer_quotas',
    versionsTable: 'transfer_quota_versions',
    stableIdColumn: 'transfer_quota_id',
    entityType: 'transfer_quota',
    extraSchema: {
      majorId: z.string().uuid(),
    },
  },
  {
    prefix: '/application-requirements',
    stableTable: 'application_requirements',
    versionsTable: 'application_requirement_versions',
    stableIdColumn: 'application_requirement_id',
    entityType: 'application_requirement',
    extraSchema: {
      majorId: z.string().uuid(),
    },
  },
  {
    prefix: '/retest-rules',
    stableTable: 'retest_rules',
    versionsTable: 'retest_rule_versions',
    stableIdColumn: 'retest_rule_id',
    entityType: 'retest_rule',
    extraSchema: {
      majorId: z.string().uuid(),
    },
  },
];

// ── Build and wire all entity routers ─────────────────────────────────────────

/** Convert a camelCase key to snake_case (e.g. universityId → university_id). */
function camelToSnake(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export const universityDataRouter = new Router();

for (const entity of ENTITIES) {
  const service = makeVersionedService({
    stableTable: entity.stableTable,
    versionsTable: entity.versionsTable,
    stableIdColumn: entity.stableIdColumn,
    entityType: entity.entityType,
  });

  // Build camelCase → snake_case FK field mapping for the stable table insert
  const fkFields = Object.fromEntries(
    Object.keys(entity.extraSchema).map((k) => [k, camelToSnake(k)]),
  );

  const createSchema = makeCreateEntitySchema(entity.extraSchema);
  const entityRouter = makeVersionedRouter(entity.prefix, service, createSchema, fkFields);

  universityDataRouter.use(entityRouter.routes(), entityRouter.allowedMethods());
}
