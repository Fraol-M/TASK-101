import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for batchAssign reservedCounts capacity enforcement.
 *
 * Regression test for the bug where active_assignments was read from the DB
 * before any batch writes, so all reviewers appeared eligible for every
 * application regardless of how many they had already been planned for in
 * the same batch run.
 *
 * Fix: reservedCounts Map tracks in-batch planned assignments so that
 * `active_assignments + reserved < max_load` is evaluated correctly before
 * the DB transaction is opened.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let assignmentService;

const cleanup = {
  assignmentIds: [],
  reviewerProfileIds: [],
  applicationIds: [],
  cycleIds: [],
  accountIds: [],
};

async function createAccount(suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `batch-cap-${TS}-${suffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/reviews/assignments/assignment.service.js');
  assignmentService = mod.assignmentService;
});

afterAll(async () => {
  // Delete in reverse FK order
  if (cleanup.assignmentIds.length) {
    await knex('review_assignments').whereIn('id', cleanup.assignmentIds).delete();
  }
  if (cleanup.reviewerProfileIds.length) {
    await knex('reviewer_profiles').whereIn('id', cleanup.reviewerProfileIds).delete();
  }
  if (cleanup.applicationIds.length) {
    await knex('applications').whereIn('id', cleanup.applicationIds).delete();
  }
  if (cleanup.cycleIds.length) {
    await knex('application_cycles').whereIn('id', cleanup.cycleIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

describe('batchAssign — reservedCounts capacity enforcement', () => {
  it('prevents over-allocation when a reviewer reaches max_load mid-batch', async () => {
    const actor = await createAccount('actor');

    const [cycle] = await knex('application_cycles')
      .insert({ name: `Batch Cap Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    // Two reviewers each with max_load = 1.
    // Without reservedCounts, DB active_assignments = 0 for both throughout the
    // planning loop, so both appear eligible for all three applications.
    // With reservedCounts, after reviewer A is planned for app1 their reserved
    // count becomes 1, making 0 + 1 < 1 false — they are excluded from app2+.
    const reviewerProfileIds = [];
    for (let i = 0; i < 2; i++) {
      const acc = await createAccount(`reviewer-${i}`);
      const [profile] = await knex('reviewer_profiles')
        .insert({ account_id: acc.id, max_load: 1, active_assignments: 0 })
        .returning('id');
      reviewerProfileIds.push(profile.id);
      cleanup.reviewerProfileIds.push(profile.id);
    }

    // Three applications — the third cannot be served once the two-reviewer pool
    // is exhausted by the first two.
    const appIds = [];
    for (let i = 0; i < 3; i++) {
      const applicant = await createAccount(`applicant-${i}`);
      const [app] = await knex('applications')
        .insert({ cycle_id: cycle.id, account_id: applicant.id, status: 'submitted' })
        .returning('id');
      appIds.push(app.id);
      cleanup.applicationIds.push(app.id);
    }

    const result = await assignmentService.batchAssign(
      {
        applicationIds: appIds,
        cycleId: cycle.id,
        mode: 'random',
        blindMode: 'blind',
        reviewersPerApplication: 1,
        reviewerIds: reviewerProfileIds,
        assignedBy: actor.id,
      },
      `req-batch-cap-${TS}`,
    );

    for (const a of result.created) cleanup.assignmentIds.push(a.id);

    // Exactly 2 of 3 applications could be assigned — one reviewer each
    expect(result.created).toHaveLength(2);

    // Third application must have an error — pool exhausted
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].applicationId).toBe(appIds[2]);
    expect(result.errors[0].issue).toMatch(/Insufficient eligible reviewers/);

    // Verify DB state: each reviewer has at most 1 active_assignment (their max_load)
    const profiles = await knex('reviewer_profiles')
      .whereIn('id', reviewerProfileIds)
      .select('id', 'active_assignments');

    for (const p of profiles) {
      expect(Number(p.active_assignments)).toBeLessThanOrEqual(1);
    }

    // Total assignments in DB must equal 2, not 3
    const totalActive = profiles.reduce((s, p) => s + Number(p.active_assignments), 0);
    expect(totalActive).toBe(2);
  });

  it('honours max_load = 2 correctly across a batch of 5 applications', async () => {
    // Each of 2 reviewers can take 2 applications → 4 succeed, 1 errors
    const actor = await createAccount('actor2');

    const [cycle] = await knex('application_cycles')
      .insert({ name: `Batch Cap2 Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const reviewerProfileIds = [];
    for (let i = 0; i < 2; i++) {
      const acc = await createAccount(`reviewer2-${i}`);
      const [profile] = await knex('reviewer_profiles')
        .insert({ account_id: acc.id, max_load: 2, active_assignments: 0 })
        .returning('id');
      reviewerProfileIds.push(profile.id);
      cleanup.reviewerProfileIds.push(profile.id);
    }

    const appIds = [];
    for (let i = 0; i < 5; i++) {
      const applicant = await createAccount(`applicant2-${i}`);
      const [app] = await knex('applications')
        .insert({ cycle_id: cycle.id, account_id: applicant.id, status: 'submitted' })
        .returning('id');
      appIds.push(app.id);
      cleanup.applicationIds.push(app.id);
    }

    const result = await assignmentService.batchAssign(
      {
        applicationIds: appIds,
        cycleId: cycle.id,
        mode: 'random',
        blindMode: 'blind',
        reviewersPerApplication: 1,
        reviewerIds: reviewerProfileIds,
        assignedBy: actor.id,
      },
      `req-batch-cap2-${TS}`,
    );

    for (const a of result.created) cleanup.assignmentIds.push(a.id);

    expect(result.created).toHaveLength(4);
    expect(result.errors).toHaveLength(1);

    const profiles = await knex('reviewer_profiles')
      .whereIn('id', reviewerProfileIds)
      .select('id', 'active_assignments');

    for (const p of profiles) {
      expect(Number(p.active_assignments)).toBeLessThanOrEqual(2);
    }

    const totalActive = profiles.reduce((s, p) => s + Number(p.active_assignments), 0);
    expect(totalActive).toBe(4);
  });
});
