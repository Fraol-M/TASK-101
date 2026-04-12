import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * DB-backed integration tests for the idempotency reservation race condition.
 *
 * The unit tests in tests/unit/idempotency.dedup.spec.js mock the repository and
 * cannot verify the DB-level atomicity guarantee. These tests hit a real PostgreSQL
 * database and verify that:
 *
 *   1. Concurrent reserve() calls with the same (account_id, key) produce exactly
 *      one winning INSERT and one losing NO-OP — the UNIQUE constraint prevents
 *      double-reservation at the DB level.
 *
 *   2. A request that wins the reservation (response_status = 0) followed by
 *      complete() transitions the record to the real status, and a subsequent
 *      reserve() call for the same key returns false (not a new slot).
 *
 *   3. deletePending() only removes records still in pending state (response_status = 0),
 *      leaving completed records untouched.
 *
 *   4. Full deduplication cycle: win reservation → complete → second request sees
 *      completed record and replays it, handler side-effect occurs exactly once.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let idempotencyRepository;

let accountId;

const cleanup = { accountIds: [], idempotencyKeys: [] };

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();

  const mod = await import('../../src/common/idempotency/idempotency.repository.js');
  idempotencyRepository = mod.idempotencyRepository;

  const [acc] = await knex('accounts')
    .insert({ username: `idmp-race-${TS}`, password_hash: DUMMY_HASH })
    .returning('id');
  accountId = acc.id;
  cleanup.accountIds.push(accountId);
});

afterAll(async () => {
  if (cleanup.idempotencyKeys.length) {
    await knex('idempotency_keys')
      .where('account_id', accountId)
      .whereIn('key', cleanup.idempotencyKeys)
      .delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

function uniqueKey(label) {
  const k = `race-${TS}-${label}-${Math.random().toString(36).slice(2)}`;
  cleanup.idempotencyKeys.push(k);
  return k;
}

// ── Concurrent reservation ────────────────────────────────────────────────────

describe('idempotencyRepository.reserve — concurrent atomicity', () => {
  it('exactly one of two concurrent reserves wins for the same key', async () => {
    const key = uniqueKey('concurrent');
    const fp = 'test-fingerprint';

    // Fire two reserves simultaneously — one must win, one must lose
    const [r1, r2] = await Promise.all([
      idempotencyRepository.reserve(accountId, key, fp),
      idempotencyRepository.reserve(accountId, key, fp),
    ]);

    const wins = [r1, r2].filter(Boolean).length;
    expect(wins).toBe(1);

    // Exactly one DB row created
    const rows = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(rows).toHaveLength(1);
    expect(rows[0].response_status).toBe(0); // pending sentinel
  });

  it('a second reserve for the same key after the first returns false', async () => {
    const key = uniqueKey('sequential');
    const fp = 'test-fingerprint-2';

    const first = await idempotencyRepository.reserve(accountId, key, fp);
    expect(first).toBe(true);

    const second = await idempotencyRepository.reserve(accountId, key, fp);
    expect(second).toBe(false);

    // Still only one row
    const rows = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(rows).toHaveLength(1);
  });
});

// ── complete() ────────────────────────────────────────────────────────────────

describe('idempotencyRepository.complete', () => {
  it('transitions a pending slot to the real response', async () => {
    const key = uniqueKey('complete');
    const fp = 'fp-complete';

    await idempotencyRepository.reserve(accountId, key, fp);
    await idempotencyRepository.complete(accountId, key, 201, { data: { id: 'entity-1' } });

    const [row] = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(row.response_status).toBe(201);
    const body = typeof row.response_body === 'string'
      ? JSON.parse(row.response_body)
      : row.response_body;
    expect(body.data.id).toBe('entity-1');
  });

  it('does not overwrite a completed record', async () => {
    const key = uniqueKey('complete-guard');
    const fp = 'fp-cg';

    await idempotencyRepository.reserve(accountId, key, fp);
    await idempotencyRepository.complete(accountId, key, 200, { first: true });
    // Second complete() targets WHERE response_status = 0 — row is now 200, so no update
    await idempotencyRepository.complete(accountId, key, 500, { second: true });

    const [row] = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(row.response_status).toBe(200);
    const body = typeof row.response_body === 'string'
      ? JSON.parse(row.response_body)
      : row.response_body;
    expect(body.first).toBe(true);
  });
});

// ── deletePending() ───────────────────────────────────────────────────────────

describe('idempotencyRepository.deletePending', () => {
  it('removes a pending slot (response_status = 0)', async () => {
    const key = uniqueKey('delete-pending');
    await idempotencyRepository.reserve(accountId, key, 'fp-dp');

    await idempotencyRepository.deletePending(accountId, key);

    const rows = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(rows).toHaveLength(0);
  });

  it('does NOT remove a completed slot', async () => {
    const key = uniqueKey('delete-completed');
    await idempotencyRepository.reserve(accountId, key, 'fp-dc');
    await idempotencyRepository.complete(accountId, key, 200, {});

    // deletePending targets WHERE response_status = 0 — this row is 200, stays
    await idempotencyRepository.deletePending(accountId, key);

    const rows = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(rows).toHaveLength(1);
    expect(rows[0].response_status).toBe(200);
  });
});

// ── Full deduplication cycle ──────────────────────────────────────────────────

describe('idempotency deduplication cycle — reserve → complete → replay', () => {
  it('findByAccountAndKey returns the completed record after complete()', async () => {
    const key = uniqueKey('full-cycle');
    const fp = 'fp-fc';
    const responseBody = { data: { id: 'created-resource', name: 'Test' } };

    // Step 1: reserve
    const reserved = await idempotencyRepository.reserve(accountId, key, fp);
    expect(reserved).toBe(true);

    // Step 2: handler executes and completes the slot
    await idempotencyRepository.complete(accountId, key, 201, responseBody);

    // Step 3: second request calls findByAccountAndKey (after reserve returns false)
    const existing = await idempotencyRepository.findByAccountAndKey(accountId, key);
    expect(existing).toBeDefined();
    expect(existing.response_status).toBe(201);
    expect(existing.request_fingerprint).toBe(fp);

    const cached = typeof existing.response_body === 'string'
      ? JSON.parse(existing.response_body)
      : existing.response_body;
    expect(cached.data.id).toBe('created-resource');
  });

  it('concurrent reserves produce exactly one record and one 200 vs one false', async () => {
    const key = uniqueKey('concurrent-full');
    const fp = 'fp-cf';

    // Simulate two concurrent requests
    const results = await Promise.all([
      idempotencyRepository.reserve(accountId, key, fp),
      idempotencyRepository.reserve(accountId, key, fp),
    ]);

    const winner = results.filter(Boolean).length;
    expect(winner).toBe(1);

    // Winner completes the handler
    await idempotencyRepository.complete(accountId, key, 200, { ok: true });

    // Loser looks up the record — sees completed, not pending
    const existing = await idempotencyRepository.findByAccountAndKey(accountId, key);
    expect(existing.response_status).toBe(200);

    // Only one record ever created
    const rows = await knex('idempotency_keys').where({ account_id: accountId, key });
    expect(rows).toHaveLength(1);
  });
});
