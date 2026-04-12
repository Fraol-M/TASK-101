import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for savedQueriesService against a real PostgreSQL database.
 *
 * Covers:
 *   Ownership:
 *     - create() persists the query under the owning account
 *     - list() for another account returns 0 results (isolation)
 *     - update() by a different account throws AuthorizationError (403)
 *     - delete() by a different account throws AuthorizationError (403)
 *
 *   CRUD lifecycle:
 *     - create → list → update → delete
 *     - duplicate name for the same account throws ConflictError (409)
 *
 *   Subscription workflow:
 *     - create with subscribed = false, update to subscribed = true
 *     - list with subscribed filter returns only subscribed queries
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let savedQueriesService;
let ownerAccountId;
let otherAccountId;

const cleanup = {
  accountIds: [],
  queryIds: [],
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();

  const mod = await import('../../src/modules/search/saved-queries.service.js');
  savedQueriesService = mod.savedQueriesService;

  const [owner] = await knex('accounts')
    .insert({ username: `sq-owner-${TS}`, password_hash: DUMMY_HASH })
    .returning('id');
  ownerAccountId = owner.id;
  cleanup.accountIds.push(ownerAccountId);

  const [other] = await knex('accounts')
    .insert({ username: `sq-other-${TS}`, password_hash: DUMMY_HASH })
    .returning('id');
  otherAccountId = other.id;
  cleanup.accountIds.push(otherAccountId);
});

afterAll(async () => {
  if (cleanup.queryIds.length) {
    await knex('search_saved_queries').whereIn('id', cleanup.queryIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

// ── CRUD lifecycle ─────────────────────────────────────────────────────────────

describe('savedQueriesService — CRUD lifecycle', () => {
  let queryId;

  it('create() persists the query and returns it', async () => {
    const sq = await savedQueriesService.create({
      accountId: ownerAccountId,
      name: `My Query ${TS}`,
      queryText: 'computer science',
      filters: { lifecycleStatus: 'active' },
      subscribed: false,
    });

    expect(sq).toBeDefined();
    expect(sq.account_id).toBe(ownerAccountId);
    expect(sq.name).toBe(`My Query ${TS}`);
    expect(sq.subscribed).toBe(false);

    queryId = sq.id;
    cleanup.queryIds.push(queryId);
  });

  it('list() for the owner returns the created query', async () => {
    const { rows, total } = await savedQueriesService.list(ownerAccountId);

    const found = rows.find((r) => r.id === queryId);
    expect(found).toBeDefined();
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('list() for the other account returns 0 (isolation)', async () => {
    const { rows } = await savedQueriesService.list(otherAccountId);
    const found = rows.find((r) => r.id === queryId);
    expect(found).toBeUndefined();
  });

  it('update() by the owner mutates the query', async () => {
    const updated = await savedQueriesService.update(queryId, ownerAccountId, {
      name: `My Query ${TS} — renamed`,
      queryText: 'machine learning',
    });

    expect(updated.name).toBe(`My Query ${TS} — renamed`);
    expect(updated.query_text).toBe('machine learning');
  });

  it('duplicate name for the same account throws ConflictError (409)', async () => {
    // Create a second query with the same name as the renamed one
    const { ConflictError } = await import('../../src/common/errors/AppError.js');
    const sq2 = await savedQueriesService.create({
      accountId: ownerAccountId,
      name: `Duplicate Query ${TS}`,
      queryText: 'duplicate',
    });
    cleanup.queryIds.push(sq2.id);

    // Try to update sq2 to have the same name as the already-renamed query
    await expect(
      savedQueriesService.update(sq2.id, ownerAccountId, {
        name: `My Query ${TS} — renamed`,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('delete() by the owner removes the query', async () => {
    await savedQueriesService.delete(queryId, ownerAccountId);

    const row = await knex('search_saved_queries').where({ id: queryId }).first();
    expect(row).toBeUndefined();

    // Remove from cleanup since it's already gone
    const idx = cleanup.queryIds.indexOf(queryId);
    if (idx !== -1) cleanup.queryIds.splice(idx, 1);
  });
});

// ── Ownership enforcement ──────────────────────────────────────────────────────

describe('savedQueriesService — ownership enforcement', () => {
  let ownerQueryId;

  beforeAll(async () => {
    const sq = await savedQueriesService.create({
      accountId: ownerAccountId,
      name: `Owner Only Query ${TS}`,
      queryText: 'restricted',
    });
    ownerQueryId = sq.id;
    cleanup.queryIds.push(ownerQueryId);
  });

  it('update() by a different account throws AuthorizationError (403)', async () => {
    const { AuthorizationError } = await import('../../src/common/errors/AppError.js');
    await expect(
      savedQueriesService.update(ownerQueryId, otherAccountId, { name: 'Hijacked name' }),
    ).rejects.toThrow(AuthorizationError);
  });

  it('delete() by a different account throws AuthorizationError (403)', async () => {
    const { AuthorizationError } = await import('../../src/common/errors/AppError.js');
    await expect(
      savedQueriesService.delete(ownerQueryId, otherAccountId),
    ).rejects.toThrow(AuthorizationError);
  });

  it('the original query is unmodified after rejected write attempts', async () => {
    const row = await knex('search_saved_queries').where({ id: ownerQueryId }).first();
    expect(row).toBeDefined();
    expect(row.name).toBe(`Owner Only Query ${TS}`);
  });
});

// ── Subscription workflow ──────────────────────────────────────────────────────

describe('savedQueriesService — subscription workflow', () => {
  let unsubQueryId;
  let subQueryId;

  beforeAll(async () => {
    const sq1 = await savedQueriesService.create({
      accountId: ownerAccountId,
      name: `Unsubscribed Query ${TS}`,
      queryText: 'unsubscribed',
      subscribed: false,
    });
    unsubQueryId = sq1.id;
    cleanup.queryIds.push(unsubQueryId);

    const sq2 = await savedQueriesService.create({
      accountId: ownerAccountId,
      name: `Subscribed Query ${TS}`,
      queryText: 'subscribed',
      subscribed: true,
    });
    subQueryId = sq2.id;
    cleanup.queryIds.push(subQueryId);
  });

  it('list with subscribed=true returns only subscribed queries', async () => {
    const { rows } = await savedQueriesService.list(ownerAccountId, { subscribed: 'true' });
    const foundUnsub = rows.find((r) => r.id === unsubQueryId);
    const foundSub = rows.find((r) => r.id === subQueryId);
    expect(foundUnsub).toBeUndefined();
    expect(foundSub).toBeDefined();
  });

  it('update() can flip subscribed from false to true', async () => {
    const updated = await savedQueriesService.update(unsubQueryId, ownerAccountId, {
      subscribed: true,
    });
    expect(updated.subscribed).toBe(true);
  });

  it('after subscription toggle, list with subscribed=true returns both queries', async () => {
    const { rows } = await savedQueriesService.list(ownerAccountId, { subscribed: 'true' });
    const foundNowSub = rows.find((r) => r.id === unsubQueryId);
    expect(foundNowSub).toBeDefined();
  });
});
