#!/usr/bin/env node
/**
 * Reindex search — forces a REINDEX on all GIN search vector indexes.
 * Use after bulk data imports or pg_catalog changes.
 *
 * Run: node scripts/reindex-search.js
 */

import knex from '../src/common/db/knex.js';

const INDEXES = [
  'idx_univ_ver_search',
  'idx_school_versions_search',
  'idx_major_versions_search',
  'idx_research_track_versions_search',
  'idx_enrollment_plan_versions_search',
  'idx_transfer_quota_versions_search',
  'idx_application_requirement_versions_search',
  'idx_retest_rule_versions_search',
];

async function run() {
  for (const idx of INDEXES) {
    console.log(`[reindex] REINDEX INDEX CONCURRENTLY ${idx}`);
    await knex.raw(`REINDEX INDEX CONCURRENTLY ${idx}`).catch((err) => {
      console.warn(`[reindex] Skipping ${idx}: ${err.message}`);
    });
  }
  console.log('[reindex] Done.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => knex.destroy());
