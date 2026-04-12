import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for automatic escalation event creation in aggregateCycle.
 * Verifies the full DB path: review_scores → aggregation → escalation_events.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

let knex;
let aggregationService;

// Dummy bcrypt hash (cost 12, not a real credential — never matches any plaintext)
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

// Track inserted IDs for cleanup
const cleanup = {
  reviewScoreIds: [],
  assignmentIds: [],
  aggregateIds: [],
  escalationIds: [],
  templateIds: [],
  reviewerProfileIds: [],
  applicationIds: [],
  cycleIds: [],
  accountIds: [],
};

async function createAccount(knex, suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `agg-test-${TS}-${suffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/rankings/aggregation.service.js');
  aggregationService = mod.aggregationService;
});

afterAll(async () => {
  // Delete in reverse FK order — audit_events are append-only and not cleaned
  if (cleanup.reviewScoreIds.length) {
    await knex('review_scores').whereIn('id', cleanup.reviewScoreIds).delete();
  }
  if (cleanup.assignmentIds.length) {
    await knex('review_assignments').whereIn('id', cleanup.assignmentIds).delete();
  }
  if (cleanup.escalationIds.length) {
    await knex('escalation_events').whereIn('id', cleanup.escalationIds).delete();
  }
  if (cleanup.aggregateIds.length) {
    await knex('application_score_aggregates').whereIn('id', cleanup.aggregateIds).delete();
  }
  if (cleanup.templateIds.length) {
    await knex('scoring_form_templates').whereIn('id', cleanup.templateIds).delete();
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

describe('aggregateCycle — automatic escalation on high variance', () => {
  it('creates an escalation_event when stddev exceeds threshold (1.8)', async () => {
    // ── Actor account ────────────────────────────────────────────────────────
    const actor = await createAccount(knex, 'actor');

    // ── Cycle ────────────────────────────────────────────────────────────────
    const [cycle] = await knex('application_cycles')
      .insert({ name: `Escalation Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    // ── Applicant + application ──────────────────────────────────────────────
    const applicant = await createAccount(knex, 'applicant');
    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicant.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    // ── Scoring template ─────────────────────────────────────────────────────
    const [template] = await knex('scoring_form_templates')
      .insert({
        cycle_id: cycle.id,
        name: 'Test Template',
        active: true,
        criteria_schema: JSON.stringify({
          criteria: [{ id: 'overall', weight: 100, maxScore: 10 }],
        }),
      })
      .returning('id');
    cleanup.templateIds.push(template.id);

    // ── Six reviewers with alternating scores 0 / 10 (stddev = 5, >> 1.8) ──
    const SCORES = [0, 10, 0, 10, 0, 10];
    for (let i = 0; i < SCORES.length; i++) {
      const reviewer = await createAccount(knex, `reviewer-${i}`);

      const [profile] = await knex('reviewer_profiles')
        .insert({ account_id: reviewer.id })
        .returning('id');
      cleanup.reviewerProfileIds.push(profile.id);

      const [assignment] = await knex('review_assignments')
        .insert({
          application_id: app.id,
          reviewer_id: profile.id,
          cycle_id: cycle.id,
          assignment_mode: 'manual',
          assigned_by: actor.id,
          status: 'submitted',
        })
        .returning('id');
      cleanup.assignmentIds.push(assignment.id);

      const [score] = await knex('review_scores')
        .insert({
          assignment_id: assignment.id,
          template_id: template.id,
          criterion_scores: JSON.stringify({ overall: SCORES[i] }),
          composite_score: SCORES[i],
          recommendation: 'admit',
          is_draft: false,
        })
        .returning('id');
      cleanup.reviewScoreIds.push(score.id);
    }

    // ── Run aggregation ───────────────────────────────────────────────────────
    const result = await aggregationService.aggregateCycle(
      cycle.id,
      actor.id,
      `req-escalation-test-${TS}`,
    );

    expect(result.aggregated).toBe(1);
    expect(result.escalated).toBe(1);

    // ── Verify escalation_event was persisted ─────────────────────────────────
    const events = await knex('escalation_events')
      .where({ application_id: app.id, cycle_id: cycle.id, trigger: 'high_variance' })
      .returning('id');

    expect(events).toHaveLength(1);
    for (const e of events) cleanup.escalationIds.push(e.id);

    // ── Verify aggregate flags are set ────────────────────────────────────────
    const [agg] = await knex('application_score_aggregates')
      .where({ application_id: app.id })
      .returning('id');
    if (agg) cleanup.aggregateIds.push(agg.id);

    const aggRow = await knex('application_score_aggregates')
      .where({ application_id: app.id })
      .first('high_variance_flag', 'escalation_flag', 'escalation_reason');

    expect(aggRow.high_variance_flag).toBe(true);
    expect(aggRow.escalation_flag).toBe(true);
    expect(aggRow.escalation_reason).toMatch(/exceeds threshold/);
  });

  it('does not create a duplicate escalation event when aggregateCycle is re-run (idempotent)', async () => {
    // Re-run against the existing cycle — the idempotency guard in aggregateCycle
    // checks for an existing high_variance event before inserting.
    // This test verifies that re-running does not produce duplicate events.

    const actor = await createAccount(knex, 'actor2');

    const [cycle] = await knex('application_cycles')
      .insert({ name: `Idempotent Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const applicant = await createAccount(knex, 'applicant2');
    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicant.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [template] = await knex('scoring_form_templates')
      .insert({
        cycle_id: cycle.id,
        name: 'Idempotent Template',
        active: true,
        criteria_schema: JSON.stringify({
          criteria: [{ id: 'overall', weight: 100, maxScore: 10 }],
        }),
      })
      .returning('id');
    cleanup.templateIds.push(template.id);

    const SCORES = [0, 10, 0, 10, 0, 10];
    for (let i = 0; i < SCORES.length; i++) {
      const reviewer = await createAccount(knex, `rev2-${i}`);
      const [profile] = await knex('reviewer_profiles')
        .insert({ account_id: reviewer.id })
        .returning('id');
      cleanup.reviewerProfileIds.push(profile.id);

      const [assignment] = await knex('review_assignments')
        .insert({
          application_id: app.id,
          reviewer_id: profile.id,
          cycle_id: cycle.id,
          assignment_mode: 'manual',
          assigned_by: actor.id,
          status: 'submitted',
        })
        .returning('id');
      cleanup.assignmentIds.push(assignment.id);

      const [score] = await knex('review_scores')
        .insert({
          assignment_id: assignment.id,
          template_id: template.id,
          criterion_scores: JSON.stringify({ overall: SCORES[i] }),
          composite_score: SCORES[i],
          recommendation: 'admit',
          is_draft: false,
        })
        .returning('id');
      cleanup.reviewScoreIds.push(score.id);
    }

    const reqId = `req-idempotent-${TS}`;
    await aggregationService.aggregateCycle(cycle.id, actor.id, reqId);
    // Second run — must not insert a second escalation event
    await aggregationService.aggregateCycle(cycle.id, actor.id, reqId + '-2');

    const events = await knex('escalation_events')
      .where({ application_id: app.id, cycle_id: cycle.id, trigger: 'high_variance' })
      .returning('id');

    expect(events).toHaveLength(1);
    for (const e of events) cleanup.escalationIds.push(e.id);

    const [agg] = await knex('application_score_aggregates')
      .where({ application_id: app.id })
      .returning('id');
    if (agg) cleanup.aggregateIds.push(agg.id);
  });

  it('does not create an escalation_event when variance is within threshold', async () => {
    const actor = await createAccount(knex, 'actor3');

    const [cycle] = await knex('application_cycles')
      .insert({ name: `Low Variance Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const applicant = await createAccount(knex, 'applicant3');
    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicant.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [template] = await knex('scoring_form_templates')
      .insert({
        cycle_id: cycle.id,
        name: 'Low Variance Template',
        active: true,
        criteria_schema: JSON.stringify({
          criteria: [{ id: 'overall', weight: 100, maxScore: 10 }],
        }),
      })
      .returning('id');
    cleanup.templateIds.push(template.id);

    // All scores the same → stddev = 0 → no escalation
    const SCORES = [7, 7, 7, 7];
    for (let i = 0; i < SCORES.length; i++) {
      const reviewer = await createAccount(knex, `rev3-${i}`);
      const [profile] = await knex('reviewer_profiles')
        .insert({ account_id: reviewer.id })
        .returning('id');
      cleanup.reviewerProfileIds.push(profile.id);

      const [assignment] = await knex('review_assignments')
        .insert({
          application_id: app.id,
          reviewer_id: profile.id,
          cycle_id: cycle.id,
          assignment_mode: 'manual',
          assigned_by: actor.id,
          status: 'submitted',
        })
        .returning('id');
      cleanup.assignmentIds.push(assignment.id);

      const [score] = await knex('review_scores')
        .insert({
          assignment_id: assignment.id,
          template_id: template.id,
          criterion_scores: JSON.stringify({ overall: SCORES[i] }),
          composite_score: SCORES[i],
          recommendation: 'admit',
          is_draft: false,
        })
        .returning('id');
      cleanup.reviewScoreIds.push(score.id);
    }

    const result = await aggregationService.aggregateCycle(
      cycle.id,
      actor.id,
      `req-low-var-${TS}`,
    );

    expect(result.aggregated).toBe(1);
    expect(result.escalated).toBe(0);

    const events = await knex('escalation_events')
      .where({ application_id: app.id, cycle_id: cycle.id, trigger: 'high_variance' });
    expect(events).toHaveLength(0);

    const [agg] = await knex('application_score_aggregates')
      .where({ application_id: app.id })
      .returning('id');
    if (agg) cleanup.aggregateIds.push(agg.id);

    const aggRow = await knex('application_score_aggregates')
      .where({ application_id: app.id })
      .first('high_variance_flag');
    expect(aggRow.high_variance_flag).toBe(false);
  });
});
