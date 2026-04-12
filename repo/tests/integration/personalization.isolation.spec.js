import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for personalizationService against a real PostgreSQL database.
 *
 * Covers:
 *   Bookmarks:
 *     - addBookmark persists the row for the owner
 *     - getBookmarks for another account returns 0 (isolation)
 *     - duplicate addBookmark throws 409 ConflictError
 *     - removeBookmark removes exactly the owner's row; throws 404 for non-existent
 *
 *   Preferences:
 *     - setPreference persists key/value
 *     - getPreferences returns flat map of key → value
 *     - setPreference on the same key is idempotent (upsert, not duplicate)
 *     - deletePreference removes the row; throws 404 for missing key
 *
 *   Tag subscriptions:
 *     - addTagSubscription persists
 *     - removeTagSubscription removes it
 *     - duplicate tag throws 409 ConflictError
 *
 *   View history retention filter:
 *     - recordView inserts a row
 *     - getHistory respects the retention window (old rows excluded)
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let personalizationService;
let accountAId;
let accountBId;

const cleanup = {
  accountIds: [],
  // Rows cleaned up via CASCADE on account deletion where possible; listed explicitly otherwise
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();

  const mod = await import('../../src/modules/personalization/personalization.service.js');
  personalizationService = mod.personalizationService;

  const [accA] = await knex('accounts')
    .insert({ username: `persona-a-${TS}`, password_hash: DUMMY_HASH })
    .returning('id');
  accountAId = accA.id;
  cleanup.accountIds.push(accountAId);

  const [accB] = await knex('accounts')
    .insert({ username: `persona-b-${TS}`, password_hash: DUMMY_HASH })
    .returning('id');
  accountBId = accB.id;
  cleanup.accountIds.push(accountBId);
});

afterAll(async () => {
  // entity_bookmarks, user_preferences, tag_subscriptions, entity_view_history
  // are foreign-keyed to accounts — delete them before deleting accounts
  await knex('entity_bookmarks').whereIn('account_id', cleanup.accountIds).delete().catch(() => {});
  await knex('user_preferences').whereIn('account_id', cleanup.accountIds).delete().catch(() => {});
  await knex('tag_subscriptions').whereIn('account_id', cleanup.accountIds).delete().catch(() => {});
  await knex('entity_view_history').whereIn('account_id', cleanup.accountIds).delete().catch(() => {});
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

// ── Bookmarks ──────────────────────────────────────────────────────────────────

describe('personalizationService — bookmarks', () => {
  const ENTITY_TYPE = 'university';
  const STABLE_ID = `stable-bk-${TS}`;

  it('addBookmark persists the row for the owner', async () => {
    const bookmark = await personalizationService.addBookmark({
      accountId: accountAId,
      entityType: ENTITY_TYPE,
      stableId: STABLE_ID,
    });

    expect(bookmark).toBeDefined();
    expect(bookmark.account_id).toBe(accountAId);
    expect(bookmark.entity_type).toBe(ENTITY_TYPE);
    expect(bookmark.stable_id).toBe(STABLE_ID);
  });

  it('getBookmarks for account B returns 0 (isolation from account A)', async () => {
    const { rows } = await personalizationService.getBookmarks(accountBId);
    // accountB has no bookmarks of its own
    const found = rows.find((b) => b.stable_id === STABLE_ID);
    expect(found).toBeUndefined();
  });

  it('duplicate addBookmark throws ConflictError (409)', async () => {
    const { ConflictError } = await import('../../src/common/errors/AppError.js');
    await expect(
      personalizationService.addBookmark({
        accountId: accountAId,
        entityType: ENTITY_TYPE,
        stableId: STABLE_ID,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('removeBookmark removes exactly the owner bookmark', async () => {
    await personalizationService.removeBookmark({
      accountId: accountAId,
      entityType: ENTITY_TYPE,
      stableId: STABLE_ID,
    });

    const { rows } = await personalizationService.getBookmarks(accountAId);
    const found = rows.find((b) => b.stable_id === STABLE_ID);
    expect(found).toBeUndefined();
  });

  it('removeBookmark on non-existent entry throws NotFoundError (404)', async () => {
    const { NotFoundError } = await import('../../src/common/errors/AppError.js');
    await expect(
      personalizationService.removeBookmark({
        accountId: accountAId,
        entityType: ENTITY_TYPE,
        stableId: 'does-not-exist',
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── Preferences ────────────────────────────────────────────────────────────────

describe('personalizationService — preferences', () => {
  it('setPreference persists and getPreferences returns the flat map', async () => {
    await personalizationService.setPreference(accountAId, 'theme', 'dark');

    const prefs = await personalizationService.getPreferences(accountAId);
    // pref_value is stored as JSON string; the service returns it as-is
    expect(JSON.parse(prefs.theme)).toBe('dark');
  });

  it('setPreference on the same key is an upsert — no duplicate row created', async () => {
    await personalizationService.setPreference(accountAId, 'theme', 'light');

    const prefs = await personalizationService.getPreferences(accountAId);
    expect(JSON.parse(prefs.theme)).toBe('light');

    // Exactly one row for this account+key
    const rows = await knex('user_preferences')
      .where({ account_id: accountAId, pref_key: 'theme' });
    expect(rows).toHaveLength(1);
  });

  it('deletePreference removes the key', async () => {
    await personalizationService.deletePreference(accountAId, 'theme');

    const prefs = await personalizationService.getPreferences(accountAId);
    expect(prefs.theme).toBeUndefined();
  });

  it('deletePreference on a missing key throws NotFoundError (404)', async () => {
    const { NotFoundError } = await import('../../src/common/errors/AppError.js');
    await expect(
      personalizationService.deletePreference(accountAId, 'nonexistent_key'),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── Tag subscriptions ──────────────────────────────────────────────────────────

describe('personalizationService — tag subscriptions', () => {
  const TAG = `ml-${TS}`;

  it('addTagSubscription persists the row', async () => {
    const sub = await personalizationService.addTagSubscription({
      accountId: accountAId,
      tag: TAG,
      tagType: 'topic',
    });

    expect(sub).toBeDefined();
    expect(sub.tag).toBe(TAG);
    expect(sub.tag_type).toBe('topic');
  });

  it('getTagSubscriptions returns the subscribed tag', async () => {
    const subs = await personalizationService.getTagSubscriptions(accountAId);
    const found = subs.find((s) => s.tag === TAG);
    expect(found).toBeDefined();
  });

  it('duplicate addTagSubscription throws ConflictError (409)', async () => {
    const { ConflictError } = await import('../../src/common/errors/AppError.js');
    await expect(
      personalizationService.addTagSubscription({
        accountId: accountAId,
        tag: TAG,
        tagType: 'topic',
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('removeTagSubscription removes the entry', async () => {
    await personalizationService.removeTagSubscription({ accountId: accountAId, tag: TAG });

    const subs = await personalizationService.getTagSubscriptions(accountAId);
    const found = subs.find((s) => s.tag === TAG);
    expect(found).toBeUndefined();
  });

  it('removeTagSubscription on non-existent tag throws NotFoundError (404)', async () => {
    const { NotFoundError } = await import('../../src/common/errors/AppError.js');
    await expect(
      personalizationService.removeTagSubscription({ accountId: accountAId, tag: 'never-subscribed' }),
    ).rejects.toThrow(NotFoundError);
  });
});

// ── View history retention filter ──────────────────────────────────────────────

describe('personalizationService — view history & retention filter', () => {
  it('recordView inserts a row that appears in getHistory', async () => {
    await personalizationService.recordView({
      accountId: accountAId,
      entityType: 'major',
      stableId: `major-${TS}`,
      versionId: null,
    });

    const { rows } = await personalizationService.getHistory(accountAId);
    const found = rows.find((r) => r.stable_id === `major-${TS}`);
    expect(found).toBeDefined();
    expect(found.entity_type).toBe('major');
  });

  it('getHistory excludes rows older than the retention window', async () => {
    // Insert a row with a viewed_at timestamp well outside the retention window
    const oldDate = new Date('2000-01-01').toISOString();
    await knex('entity_view_history').insert({
      account_id: accountAId,
      entity_type: 'school',
      stable_id: `old-school-${TS}`,
      viewed_at: oldDate,
    });

    const { rows } = await personalizationService.getHistory(accountAId);
    const found = rows.find((r) => r.stable_id === `old-school-${TS}`);
    // Row is beyond retention window → must not appear
    expect(found).toBeUndefined();
  });

  it('getHistory for account B excludes account A records (isolation)', async () => {
    const { rows } = await personalizationService.getHistory(accountBId);
    const leak = rows.find((r) => r.account_id === accountAId);
    expect(leak).toBeUndefined();
  });
});
