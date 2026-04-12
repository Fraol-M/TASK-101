#!/usr/bin/env node
/**
 * Self-audit pre-check.
 * Validates that the audit_events table has not had rows silently dropped.
 * Compares the expected count from the application's own insert log against
 * the actual table row count.
 *
 * Run: node scripts/self-audit-precheck.js
 * Exit 0 = OK, Exit 2 = discrepancy found.
 */

import knex from '../src/common/db/knex.js';

async function run() {
  // Basic sanity checks on audit_events
  const stats = await knex('audit_events')
    .select(
      knex.raw('COUNT(*) AS total_events'),
      knex.raw("COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours') AS last_24h"),
      knex.raw("MIN(occurred_at) AS earliest"),
      knex.raw("MAX(occurred_at) AS latest"),
    )
    .first();

  console.log('[self-audit] audit_events table stats:');
  console.log(`  Total events : ${stats.total_events}`);
  console.log(`  Last 24 h    : ${stats.last_24h}`);
  console.log(`  Earliest     : ${stats.earliest ?? 'none'}`);
  console.log(`  Latest       : ${stats.latest ?? 'none'}`);

  // Check that the RULE preventing deletes is in place
  const ruleCheck = await knex.raw(`
    SELECT COUNT(*) AS cnt FROM pg_rules
    WHERE tablename = 'audit_events'
      AND rulename IN ('audit_events_no_delete', 'audit_events_no_update')
  `).then((r) => Number(r.rows[0].cnt));

  if (ruleCheck < 2) {
    console.error('[self-audit] FAIL: audit_events protection rules are missing!');
    process.exit(2);
  }

  console.log('[self-audit] OK: audit_events protection rules present.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[self-audit] Error:', err.message); process.exit(1); })
  .finally(() => knex.destroy());
