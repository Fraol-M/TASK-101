#!/usr/bin/env node
/**
 * Maintenance script — purge expired rows from time-bounded tables.
 *
 * Run on a schedule (e.g., daily via cron):
 *   node scripts/purge-expired-data.js
 *
 * Tables purged:
 *   - idempotency_keys:   rows past their expires_at
 *   - sessions:           rows past their absolute_expires_at
 *   - search_query_log:   rows older than RETENTION_DAYS
 *   - entity_view_history: rows older than HISTORY_RETENTION_DAYS
 *
 * Each purge is logged; the script exits 0 on success, 1 on error.
 */

import knex from '../src/common/db/knex.js';
import config from '../src/config/env.js';

const SEARCH_LOG_RETENTION_DAYS = 90;
const HISTORY_RETENTION_DAYS = config.personalization?.historyRetentionDays ?? 180;

async function purge() {
  const results = {};

  // ── Idempotency keys ──────────────────────────────────────────────────────
  results.idempotencyKeys = await knex('idempotency_keys')
    .where('expires_at', '<', knex.fn.now())
    .delete();

  // ── Sessions ──────────────────────────────────────────────────────────────
  results.sessions = await knex('sessions')
    .where('absolute_expires_at', '<', knex.fn.now())
    .delete();

  // ── Search query log ──────────────────────────────────────────────────────
  results.searchQueryLog = await knex('search_query_log')
    .whereRaw('created_at < NOW() - (? * INTERVAL \'1 day\')', [SEARCH_LOG_RETENTION_DAYS])
    .delete();

  // ── Entity view history ───────────────────────────────────────────────────
  results.entityViewHistory = await knex('entity_view_history')
    .whereRaw('viewed_at < NOW() - (? * INTERVAL \'1 day\')', [HISTORY_RETENTION_DAYS])
    .delete();

  return results;
}

purge()
  .then((results) => {
    console.log('[purge] Completed:', JSON.stringify(results));
    process.exit(0);
  })
  .catch((err) => {
    console.error('[purge] Error:', err.message);
    process.exit(1);
  })
  .finally(() => knex.destroy());
