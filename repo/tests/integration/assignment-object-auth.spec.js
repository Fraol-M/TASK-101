import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for object-level authorization in assignmentService.getById.
 *
 * The route requires the review:read-assigned permission, but the service adds a
 * second check: a non-admin viewer can only fetch an assignment if their reviewer
 * profile is the one on the assignment row. Without this check, any authenticated
 * reviewer could enumerate assignments belonging to other reviewers.
 *
 * Verified paths:
 * - Reviewer requesting another reviewer's assignment → 404 (information-safe)
 * - Account with no reviewer profile → 404
 * - Assigned reviewer requesting their own assignment → 200
 * - SYSTEM_ADMIN bypasses the object check → 200
 * - PROGRAM_ADMIN bypasses the object check → 200
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let assignmentService;

// IDs set up in beforeAll and shared across all tests in this file
let cycleId;
let applicationId;
let assignmentId;
let reviewerAAccountId;
let reviewerBAccountId;
let adminAccountId;
let reviewerAProfileId;

const cleanup = {
  assignmentIds: [],
  reviewerProfileIds: [],
  applicationIds: [],
  cycleIds: [],
  accountIds: [],
};

async function createAccount(suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `obj-auth-${TS}-${suffix}`, password_hash: DUMMY_HASH })
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

  // Admin (no reviewer profile — used as assignedBy and for admin-bypass tests)
  const adminAcc = await createAccount('admin');
  adminAccountId = adminAcc.id;

  // Cycle
  const [cycle] = await knex('application_cycles')
    .insert({ name: `Object Auth Test ${TS}`, year: 2099, status: 'open' })
    .returning('id');
  cycleId = cycle.id;
  cleanup.cycleIds.push(cycleId);

  // Applicant + application
  const applicantAcc = await createAccount('applicant');
  const [app] = await knex('applications')
    .insert({ cycle_id: cycleId, account_id: applicantAcc.id, status: 'submitted' })
    .returning('id');
  applicationId = app.id;
  cleanup.applicationIds.push(applicationId);

  // Reviewer A — will own the assignment
  const reviewerAAcc = await createAccount('reviewer-a');
  reviewerAAccountId = reviewerAAcc.id;
  const [profileA] = await knex('reviewer_profiles')
    .insert({ account_id: reviewerAAccountId })
    .returning('id');
  reviewerAProfileId = profileA.id;
  cleanup.reviewerProfileIds.push(reviewerAProfileId);

  // Reviewer B — a different reviewer with no connection to the assignment
  const reviewerBAcc = await createAccount('reviewer-b');
  reviewerBAccountId = reviewerBAcc.id;
  const [profileB] = await knex('reviewer_profiles')
    .insert({ account_id: reviewerBAccountId })
    .returning('id');
  cleanup.reviewerProfileIds.push(profileB.id);

  // Insert the assignment directly — bypasses batchAssign to keep the test focused
  const [assignment] = await knex('review_assignments')
    .insert({
      application_id: applicationId,
      reviewer_id: reviewerAProfileId,
      cycle_id: cycleId,
      assignment_mode: 'manual',
      blind_mode: 'blind',
      assigned_by: adminAccountId,
    })
    .returning('id');
  assignmentId = assignment.id;
  cleanup.assignmentIds.push(assignmentId);
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

describe('assignmentService.getById — object-level authorization', () => {
  it('returns 404 when a reviewer requests an assignment owned by a different reviewer', async () => {
    // Information-safe: returns 404 rather than 403 to avoid revealing that the
    // assignment exists at all.
    await expect(
      assignmentService.getById(assignmentId, { id: reviewerBAccountId, roles: [] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 when the requester has no reviewer_profile row', async () => {
    // Admin account was never linked to a reviewer_profile.
    // Without an admin role, it should be treated the same as an unknown reviewer.
    const noProfileAcc = await createAccount('no-profile');
    await expect(
      assignmentService.getById(assignmentId, { id: noProfileAcc.id, roles: [] }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('allows the assigned reviewer to access their own assignment', async () => {
    const result = await assignmentService.getById(assignmentId, {
      id: reviewerAAccountId,
      roles: [],
    });
    expect(result.id).toBe(assignmentId);
    expect(result.reviewer_id).toBe(reviewerAProfileId);
    expect(result.application_id).toBe(applicationId);
  });

  it('allows SYSTEM_ADMIN to access any assignment without being the assigned reviewer', async () => {
    // adminAccountId has no reviewer_profile, proving the bypass is role-based
    const result = await assignmentService.getById(assignmentId, {
      id: adminAccountId,
      roles: ['SYSTEM_ADMIN'],
    });
    expect(result.id).toBe(assignmentId);
  });

  it('allows PROGRAM_ADMIN to access any assignment without being the assigned reviewer', async () => {
    const result = await assignmentService.getById(assignmentId, {
      id: adminAccountId,
      roles: ['PROGRAM_ADMIN'],
    });
    expect(result.id).toBe(assignmentId);
  });
});
