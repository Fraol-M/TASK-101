import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for the versioned university-data lifecycle.
 *
 * Uses the 'universities' entity (no FK dependencies) to exercise the full
 * state machine against a real PostgreSQL database:
 *
 *   create → (draft)
 *   updateDraft → (draft, updated payload)
 *   publish → (active, version_number = 1)
 *   createNewDraft → (second draft)
 *   publish (second draft) → (second active, first superseded)
 *   archive → (archived)
 *   findHistory → returns all versions in reverse order
 *
 * Also verifies:
 *   - Immutability guard: updateDraft on a published version throws 422
 *   - listCurrent only returns active versions (archived entities are excluded)
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let universityService;

const cleanup = {
  accountIds: [],
  universityIds: [],    // stable table IDs
  versionIds: [],       // university_versions IDs
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();

  // Import a concrete service instance via the factory
  const { makeVersionedService } = await import('../../src/modules/university-data/_versioning/versioned.service.factory.js');
  universityService = makeVersionedService({
    stableTable: 'universities',
    versionsTable: 'university_versions',
    stableIdColumn: 'university_id',
    entityType: 'university',
  });

  // Actor account
  const [actor] = await knex('accounts')
    .insert({ username: `udlc-actor-${TS}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(actor.id);
  cleanup._actorId = actor.id;
});

afterAll(async () => {
  if (cleanup.versionIds.length) {
    await knex('university_versions').whereIn('id', cleanup.versionIds).delete();
  }
  if (cleanup.universityIds.length) {
    await knex('universities').whereIn('id', cleanup.universityIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

describe('university lifecycle — create → update → publish → supersede → archive', () => {
  let stableId;
  let firstVersionId;
  let secondVersionId;

  it('create() produces a stable row + draft version with version_number 1', async () => {
    const actorId = cleanup._actorId;
    const result = await universityService.create(
      { name_normalized: `lifecycle university ${TS}` },
      { name: `Lifecycle University ${TS}`, country: 'EG' },
      actorId,
      `req-create-${TS}`,
    );

    expect(result.stable).toBeDefined();
    expect(result.version).toBeDefined();
    expect(result.version.lifecycle_status).toBe('draft');
    expect(Number(result.version.version_number)).toBe(1);

    stableId = result.stable.id;
    firstVersionId = result.version.id;

    cleanup.universityIds.push(stableId);
    cleanup.versionIds.push(firstVersionId);
  });

  it('updateDraft() mutates the payload of the existing draft', async () => {
    const actorId = cleanup._actorId;
    const updated = await universityService.updateDraft(
      stableId,
      firstVersionId,
      { name: `Lifecycle University ${TS} — edited`, country: 'EG' },
      actorId,
      `req-update-${TS}`,
    );

    expect(updated.id).toBe(firstVersionId);
    expect(updated.lifecycle_status).toBe('draft');
    const payload = typeof updated.payload_json === 'string'
      ? JSON.parse(updated.payload_json)
      : updated.payload_json;
    expect(payload.name).toContain('edited');
  });

  it('publish() transitions draft → active with version_number 1', async () => {
    const actorId = cleanup._actorId;
    // Use a past date to force immediate activation
    const published = await universityService.publish(
      stableId,
      firstVersionId,
      actorId,
      `req-publish-${TS}`,
      '2020-01-01',
    );

    expect(published.id).toBe(firstVersionId);
    expect(published.lifecycle_status).toBe('active');
    expect(Number(published.version_number)).toBe(1);
  });

  it('updateDraft() on an active (published) version throws 422 (immutability guard)', async () => {
    const actorId = cleanup._actorId;
    await expect(
      universityService.updateDraft(
        stableId,
        firstVersionId,
        { name: 'Attempt to mutate published version' },
        actorId,
        `req-update-published-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('createNewDraft() creates a second draft without disturbing the active version', async () => {
    const actorId = cleanup._actorId;
    const draft2 = await universityService.createNewDraft(
      stableId,
      { name: `Lifecycle University ${TS} v2`, country: 'EG' },
      actorId,
      `req-draft2-${TS}`,
    );

    expect(draft2.lifecycle_status).toBe('draft');
    secondVersionId = draft2.id;
    cleanup.versionIds.push(secondVersionId);

    // First version must still be active
    const v1 = await knex('university_versions').where({ id: firstVersionId }).first('lifecycle_status');
    expect(v1.lifecycle_status).toBe('active');
  });

  it('publishing the second draft supersedes the first active version', async () => {
    const actorId = cleanup._actorId;
    const published2 = await universityService.publish(
      stableId,
      secondVersionId,
      actorId,
      `req-publish2-${TS}`,
      '2021-01-01',
    );

    expect(published2.lifecycle_status).toBe('active');
    expect(Number(published2.version_number)).toBe(2);

    // First version must now be 'superseded'
    const v1 = await knex('university_versions').where({ id: firstVersionId }).first('lifecycle_status');
    expect(v1.lifecycle_status).toBe('superseded');
  });

  it('archive() marks the active version as archived and entity is excluded from listCurrent', async () => {
    const actorId = cleanup._actorId;
    await universityService.archive(stableId, actorId, `req-archive-${TS}`);

    const v2 = await knex('university_versions').where({ id: secondVersionId }).first('lifecycle_status');
    expect(v2.lifecycle_status).toBe('archived');

    // listCurrent must not return this entity (no active version)
    const { rows } = await universityService.listCurrent({}, {});
    const found = rows.find((r) => r.stable_id === stableId || r.id === stableId);
    expect(found).toBeUndefined();
  });

  it('findHistory() returns all versions in descending version_number order', async () => {
    const history = await universityService.findHistory(stableId);

    // We created 2 versions
    expect(history.length).toBeGreaterThanOrEqual(2);

    // Verify descending order
    for (let i = 1; i < history.length; i++) {
      expect(Number(history[i - 1].version_number)).toBeGreaterThanOrEqual(Number(history[i].version_number));
    }

    const statuses = history.map((v) => v.lifecycle_status);
    expect(statuses).toContain('archived');
    expect(statuses).toContain('superseded');
  });
});
