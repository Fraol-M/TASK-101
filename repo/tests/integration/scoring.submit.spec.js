import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for scoringService against a real PostgreSQL database.
 *
 * tests/unit/scoring.composite.spec.js is formula-focused and mocks knex entirely,
 * so it cannot catch regressions in the multi-table write path.  These tests
 * cover the paths that require a real DB:
 *
 * submit (happy path):
 *   - review_scores persisted with is_draft = false and computed composite_score
 *   - review_assignments status transitions to 'submitted'
 *   - reviewer_profiles.active_assignments decremented
 *
 * submit (error paths):
 *   - missing required criterion → 422 with per-field details
 *   - wrong reviewer → 403
 *   - assignment not in submittable state → 422
 *   - missing recommendation → 422
 *
 * saveDraft (upsert behaviour):
 *   - first call creates the score row with is_draft = true
 *   - second call updates the same row (onConflict merge), no duplicate created
 *   - wrong reviewer → 403
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let scoringService;

// Shared fixtures created in beforeAll
let cycleId;
let templateId;
let applicationId;
let reviewerAccountId;
let reviewerProfileId;
let otherReviewerAccountId;
let assignmentId;

// Used by submit tests that transition assignment to 'submitted' —
// these tests each need a fresh assignment so they don't interfere with each other.
async function createFreshAssignment(suffix) {
  const applicantAcc = await createAccount(`app-${suffix}`);
  const [app] = await knex('applications')
    .insert({ cycle_id: cycleId, account_id: applicantAcc.id, status: 'submitted' })
    .returning('id');
  cleanup.applicationIds.push(app.id);

  const [a] = await knex('review_assignments')
    .insert({
      application_id: app.id,
      reviewer_id: reviewerProfileId,
      cycle_id: cycleId,
      assignment_mode: 'manual',
      blind_mode: 'blind',
      assigned_by: reviewerAccountId,
      status: 'assigned',
    })
    .returning('id');
  cleanup.assignmentIds.push(a.id);
  return a;
}

const cleanup = {
  reviewScoreIds: [],
  assignmentIds: [],
  reviewerProfileIds: [],
  applicationIds: [],
  cycleIds: [],
  templateIds: [],
  accountIds: [],
};

async function createAccount(suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `scoring-int-${TS}-${suffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/reviews/scoring/scoring.service.js');
  scoringService = mod.scoringService;

  // Cycle
  const [cycle] = await knex('application_cycles')
    .insert({ name: `Scoring Integration ${TS}`, year: 2099, status: 'open' })
    .returning('id');
  cycleId = cycle.id;
  cleanup.cycleIds.push(cycleId);

  // Scoring template with two criteria (weights sum to 100)
  const [template] = await knex('scoring_form_templates')
    .insert({
      cycle_id: cycleId,
      name: `Template ${TS}`,
      active: true,
      criteria_schema: JSON.stringify({
        criteria: [
          { id: 'research', weight: 60, maxScore: 10 },
          { id: 'statement', weight: 40, maxScore: 10 },
        ],
      }),
    })
    .returning('id');
  templateId = template.id;
  cleanup.templateIds.push(templateId);

  // Reviewer account + profile
  const revAcc = await createAccount('reviewer');
  reviewerAccountId = revAcc.id;
  const [revProfile] = await knex('reviewer_profiles')
    .insert({ account_id: reviewerAccountId, active_assignments: 1 })
    .returning('id');
  reviewerProfileId = revProfile.id;
  cleanup.reviewerProfileIds.push(reviewerProfileId);

  // Other reviewer (used to test ownership rejection)
  const otherAcc = await createAccount('other-reviewer');
  otherReviewerAccountId = otherAcc.id;
  const [otherProfile] = await knex('reviewer_profiles')
    .insert({ account_id: otherReviewerAccountId })
    .returning('id');
  cleanup.reviewerProfileIds.push(otherProfile.id);

  // Applicant + application + assignment for the shared assignment fixture
  const applicantAcc = await createAccount('applicant');
  const [app] = await knex('applications')
    .insert({ cycle_id: cycleId, account_id: applicantAcc.id, status: 'submitted' })
    .returning('id');
  applicationId = app.id;
  cleanup.applicationIds.push(applicationId);

  const [a] = await knex('review_assignments')
    .insert({
      application_id: applicationId,
      reviewer_id: reviewerProfileId,
      cycle_id: cycleId,
      assignment_mode: 'manual',
      blind_mode: 'blind',
      assigned_by: reviewerAccountId,
      status: 'assigned',
    })
    .returning('id');
  assignmentId = a.id;
  cleanup.assignmentIds.push(assignmentId);
});

afterAll(async () => {
  if (cleanup.reviewScoreIds.length) {
    await knex('review_scores').whereIn('id', cleanup.reviewScoreIds).delete();
  }
  // Delete all assignments for this cycle (includes ones created by createFreshAssignment)
  if (cleanup.assignmentIds.length) {
    await knex('review_assignments').whereIn('id', cleanup.assignmentIds).delete();
  }
  if (cleanup.reviewerProfileIds.length) {
    await knex('reviewer_profiles').whereIn('id', cleanup.reviewerProfileIds).delete();
  }
  if (cleanup.applicationIds.length) {
    await knex('applications').whereIn('id', cleanup.applicationIds).delete();
  }
  if (cleanup.templateIds.length) {
    await knex('scoring_form_templates').whereIn('id', cleanup.templateIds).delete();
  }
  if (cleanup.cycleIds.length) {
    await knex('application_cycles').whereIn('id', cleanup.cycleIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

// ── submit — happy path ───────────────────────────────────────────────────────

describe('scoringService.submit — happy path', () => {
  it('persists score, transitions assignment to submitted, decrements active_assignments', async () => {
    const assignment = await createFreshAssignment('submit-happy');

    const score = await scoringService.submit(
      {
        assignmentId: assignment.id,
        criterionScores: { research: 8, statement: 7 },
        recommendation: 'admit',
      },
      reviewerAccountId,
      `req-submit-happy-${TS}`,
    );

    cleanup.reviewScoreIds.push(score.id);

    // Score persisted correctly
    expect(score.is_draft).toBe(false);
    expect(score.recommendation).toBe('admit');
    // composite = (8/10*10*60 + 7/10*10*40) / 100 = (48 + 28) / 100 = 7.6
    expect(Number(score.composite_score)).toBeCloseTo(7.6, 2);

    // Assignment status must be 'submitted'
    const updatedAssignment = await knex('review_assignments')
      .where({ id: assignment.id })
      .first('status');
    expect(updatedAssignment.status).toBe('submitted');

    // reviewer_profiles.active_assignments must have decremented
    const profile = await knex('reviewer_profiles')
      .where({ id: reviewerProfileId })
      .first('active_assignments');
    // The profile was seeded with 1 and submit decrements by 1 → expect 0
    expect(Number(profile.active_assignments)).toBe(0);
  });

  it('overwrites a prior draft when submit is called after saveDraft', async () => {
    const assignment = await createFreshAssignment('submit-after-draft');

    // Save draft first
    const draft = await scoringService.saveDraft(
      { assignmentId: assignment.id, criterionScores: { research: 5, statement: 5 }, recommendation: 'borderline' },
      reviewerAccountId,
      `req-draft-before-submit-${TS}`,
    );
    cleanup.reviewScoreIds.push(draft.id);
    expect(draft.is_draft).toBe(true);

    // Submit with updated scores — must overwrite the draft row
    const submitted = await scoringService.submit(
      { assignmentId: assignment.id, criterionScores: { research: 9, statement: 9 }, recommendation: 'strong_admit' },
      reviewerAccountId,
      `req-submit-over-draft-${TS}`,
    );
    // Same row — onConflict merge, so id should be identical
    expect(submitted.id).toBe(draft.id);
    expect(submitted.is_draft).toBe(false);
    expect(submitted.recommendation).toBe('strong_admit');

    // Only one review_scores row for this assignment
    const all = await knex('review_scores').where({ assignment_id: assignment.id });
    expect(all).toHaveLength(1);
  });
});

// ── submit — error paths ──────────────────────────────────────────────────────

describe('scoringService.submit — error paths', () => {
  it('throws UnprocessableError (422) when a required criterion is missing', async () => {
    const assignment = await createFreshAssignment('submit-missing-criterion');

    await expect(
      scoringService.submit(
        {
          assignmentId: assignment.id,
          criterionScores: { research: 8 }, // 'statement' missing
          recommendation: 'admit',
        },
        reviewerAccountId,
        `req-submit-missing-${TS}`,
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'statement', issue: 'required' }),
      ]),
    });
  });

  it('throws UnprocessableError (422) when recommendation is absent', async () => {
    const assignment = await createFreshAssignment('submit-no-rec');

    await expect(
      scoringService.submit(
        { assignmentId: assignment.id, criterionScores: { research: 8, statement: 7 } },
        reviewerAccountId,
        `req-submit-no-rec-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('throws AuthorizationError (403) when the reviewer does not own the assignment', async () => {
    await expect(
      scoringService.submit(
        { assignmentId, criterionScores: { research: 8, statement: 7 }, recommendation: 'admit' },
        otherReviewerAccountId,
        `req-submit-wrong-rev-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws UnprocessableError (422) when the assignment is already submitted', async () => {
    // Create an assignment pre-set to 'submitted' status (not a valid state for re-submission)
    const applicantAcc = await createAccount('app-bad-state');
    const [app] = await knex('applications')
      .insert({ cycle_id: cycleId, account_id: applicantAcc.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [a] = await knex('review_assignments')
      .insert({
        application_id: app.id,
        reviewer_id: reviewerProfileId,
        cycle_id: cycleId,
        assignment_mode: 'manual',
        blind_mode: 'blind',
        assigned_by: reviewerAccountId,
        status: 'submitted', // already submitted — not a valid state for scoringService.submit
      })
      .returning('id');
    cleanup.assignmentIds.push(a.id);

    await expect(
      scoringService.submit(
        { assignmentId: a.id, criterionScores: { research: 8, statement: 7 }, recommendation: 'admit' },
        reviewerAccountId,
        `req-submit-bad-state-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});

// ── saveDraft — upsert behaviour ──────────────────────────────────────────────

describe('scoringService.saveDraft', () => {
  it('creates a draft score row on first call', async () => {
    const draft = await scoringService.saveDraft(
      { assignmentId, criterionScores: { research: 6, statement: 5 }, recommendation: 'borderline' },
      reviewerAccountId,
      `req-draft-create-${TS}`,
    );

    cleanup.reviewScoreIds.push(draft.id);

    expect(draft.is_draft).toBe(true);
    expect(draft.assignment_id).toBe(assignmentId);
    expect(Number(draft.composite_score)).toBeGreaterThan(0);
  });

  it('updates the existing draft row on second call (no duplicate created)', async () => {
    // Perform a second save with different scores
    const draft2 = await scoringService.saveDraft(
      { assignmentId, criterionScores: { research: 9, statement: 9 }, recommendation: 'strong_admit' },
      reviewerAccountId,
      `req-draft-update-${TS}`,
    );

    // The onConflict merge should have updated the existing row — same ID
    const first = cleanup.reviewScoreIds[cleanup.reviewScoreIds.length - 1];
    expect(draft2.id).toBe(first);

    // Only one review_scores row for this assignment
    const all = await knex('review_scores').where({ assignment_id: assignmentId });
    expect(all).toHaveLength(1);
    expect(all[0].recommendation).toBe('strong_admit');
  });

  it('throws AuthorizationError (403) when the reviewer does not own the assignment', async () => {
    await expect(
      scoringService.saveDraft(
        { assignmentId, criterionScores: { research: 5, statement: 5 } },
        otherReviewerAccountId,
        `req-draft-wrong-rev-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
