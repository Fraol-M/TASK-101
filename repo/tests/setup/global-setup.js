/**
 * Vitest global setup — runs once in the main process before any test workers start.
 *
 * Responsibility:
 *   - Ensure required env vars are set for both local runs and Docker runs.
 *   - Local: falls back to localhost test DB.
 *   - Docker: DATABASE_URL / DATABASE_URL_TEST are injected by docker-compose.
 *
 * NOTE: This file runs in the Vitest *main* process, not in test workers.
 * Use tests/setup/test-setup.js for per-worker setup.
 */
export async function setup() {
  // Always force test mode
  process.env.NODE_ENV = 'test';

  // Database URL — Docker sets DATABASE_URL_TEST; local dev falls back
  process.env.DATABASE_URL =
    process.env.DATABASE_URL_TEST ||
    process.env.DATABASE_URL ||
    'postgresql://graduser:gradpass@localhost:5432/graddb_test';

  // Encryption key — deterministic all-zeros for tests (never used in prod)
  process.env.LOCAL_ENCRYPTION_KEY =
    process.env.LOCAL_ENCRYPTION_KEY ||
    '0000000000000000000000000000000000000000000000000000000000000000';

  // Suppress info/debug logs during test runs
  process.env.LOG_LEVEL = 'error';

  // Ensure all other config vars required by env.js have values
  process.env.SESSION_IDLE_TIMEOUT_MINUTES   ??= '30';
  process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS ??= '12';
  process.env.ATTACHMENT_STORAGE_ROOT        ??= '/tmp/test-attachments';
  process.env.ATTACHMENT_MAX_FILE_BYTES      ??= '10485760';
  process.env.ATTACHMENT_MAX_FILES_PER_REVIEW ??= '5';
  process.env.SEARCH_DEFAULT_LANGUAGE        ??= 'english';
  process.env.HISTORY_RETENTION_DAYS         ??= '180';
  process.env.REVIEW_TRIM_ENABLED            ??= 'true';
  process.env.REVIEW_TRIM_PERCENT            ??= '10';
  process.env.REVIEW_TRIM_MIN_COUNT          ??= '7';
  process.env.REVIEW_VARIANCE_THRESHOLD      ??= '1.8';
}

export async function teardown() {
  // Nothing needed — each integration test file destroys its own knex instance
}
