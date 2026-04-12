#!/usr/bin/env node
/**
 * Promote scheduled entity versions whose effective_from date has arrived.
 *
 * Run daily (e.g., 00:05 UTC) via cron or a container restart policy:
 *   node scripts/promote-scheduled-versions.js
 *
 * For each entity type, finds all scheduled versions with effective_from <= today
 * and promotes the earliest-effective-date candidate to 'active', superseding the
 * current active version inside a single transaction per entity.
 *
 * Exit 0 on success, 1 on error.
 */

import knex from '../src/common/db/knex.js';
import { makeVersionedService } from '../src/modules/university-data/_versioning/versioned.service.factory.js';

// System actor: null is used because the audit_events.actor_account_id column is
// uuid NULLABLE (FK to accounts with ON DELETE SET NULL). There is no human actor
// for scheduled promotions; consumers can filter WHERE actor_account_id IS NULL
// AND action_type LIKE '%.scheduled_promoted' to identify cron-sourced events.
const SYSTEM_ACTOR = null;

const ENTITY_CONFIGS = [
  { stableTable: 'universities',              versionsTable: 'university_versions',               stableIdColumn: 'university_id',               entityType: 'university' },
  { stableTable: 'schools',                   versionsTable: 'school_versions',                   stableIdColumn: 'school_id',                   entityType: 'school' },
  { stableTable: 'majors',                    versionsTable: 'major_versions',                    stableIdColumn: 'major_id',                    entityType: 'major' },
  { stableTable: 'research_tracks',           versionsTable: 'research_track_versions',           stableIdColumn: 'research_track_id',           entityType: 'research_track' },
  { stableTable: 'enrollment_plans',          versionsTable: 'enrollment_plan_versions',          stableIdColumn: 'enrollment_plan_id',          entityType: 'enrollment_plan' },
  { stableTable: 'transfer_quotas',           versionsTable: 'transfer_quota_versions',           stableIdColumn: 'transfer_quota_id',           entityType: 'transfer_quota' },
  { stableTable: 'application_requirements', versionsTable: 'application_requirement_versions',  stableIdColumn: 'application_requirement_id',  entityType: 'application_requirement' },
  { stableTable: 'retest_rules',             versionsTable: 'retest_rule_versions',              stableIdColumn: 'retest_rule_id',              entityType: 'retest_rule' },
];

async function run() {
  const today = new Date().toISOString().split('T')[0];
  let totalPromoted = 0;

  for (const cfg of ENTITY_CONFIGS) {
    // Use the service layer so that each promotion emits a *.scheduled_promoted audit event.
    const service = makeVersionedService(cfg);

    // Find all stable IDs that have at least one due scheduled version
    const dueEntities = await knex(cfg.versionsTable)
      .where({ lifecycle_status: 'scheduled' })
      .where('effective_from', '<=', today)
      .distinct(cfg.stableIdColumn)
      .pluck(cfg.stableIdColumn);

    for (const stableId of dueEntities) {
      const requestId = `cron-promote-${today}-${stableId}`;
      const promoted = await service.promoteScheduled(stableId, SYSTEM_ACTOR, requestId);
      if (promoted) {
        console.log(`[promote] ${cfg.stableTable} ${stableId} → v${promoted.version_number} active (effective ${promoted.effective_from})`);
        totalPromoted++;
      }
    }
  }

  console.log(`[promote] Done. ${totalPromoted} version(s) promoted.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[promote] Error:', err.message); process.exit(1); })
  .finally(() => knex.destroy());
