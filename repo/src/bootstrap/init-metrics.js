import { registry } from '../common/metrics/metrics.js';
import knex from '../common/db/knex.js';
import { dbQueryDurationSeconds } from '../common/metrics/metrics.js';

/**
 * Initialise metrics collection.
 * Hooks into Knex query events to record DB query durations.
 */
export function initMetrics() {
  // Record DB query duration for every Knex query
  knex.on('query', (queryData) => {
    queryData.__startTime = Date.now();
  });

  knex.on('query-response', (response, queryData) => {
    if (queryData.__startTime) {
      const durationSecs = (Date.now() - queryData.__startTime) / 1000;
      // Extract table name from SQL (best-effort)
      const tableMatch = queryData.sql?.match(/\b(?:from|into|update)\s+"?(\w+)"?/i);
      const table = tableMatch ? tableMatch[1] : 'unknown';
      const opMatch = queryData.sql?.match(/^\s*(\w+)/);
      const operation = opMatch ? opMatch[1].toLowerCase() : 'unknown';
      dbQueryDurationSeconds.observe({ table, operation }, durationSecs);
    }
  });

  return registry;
}
