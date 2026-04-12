import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for the full aggregation → ranking pipeline.
 *
 * These tests replace the service-mocked coverage in tests/api/rankings.spec.js
 * for the critical logic paths: trimmed mean computation, rank ordering,
 * tie-breaking (trimmed_mean DESC → research_fit_score DESC → submitted_at ASC),
 * and getRankings pagination.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let aggregationService;

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

async function createAccount(suffix) {
  const uniqueSuffix = `${suffix}-${cleanup.accountIds.length}`;
  const [acc] = await knex('accounts')
    .insert({ username: `rank-pipe-${TS}-${uniqueSuffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

async function createCycleAndTemplate(suffix) {
  const [cycle] = await knex('application_cycles')
    .insert({ name: `Rankings Pipeline ${suffix} ${TS}`, year: 2099, status: 'open' })
    .returning('id');
  cleanup.cycleIds.push(cycle.id);

  const [template] = await knex('scoring_form_templates')
    .insert({
      cycle_id: cycle.id,
      name: `Template ${suffix}`,
      active: true,
      criteria_schema: JSON.stringify({
        criteria: [{ id: 'overall', weight: 100, maxScore: 10 }],
      }),
    })
    .returning('id');
  cleanup.templateIds.push(template.id);

  return { cycleId: cycle.id, templateId: template.id };
}

async function createApplication(cycleId, accountId, researchFitScore, submittedAt) {
  const [app] = await knex('applications')
    .insert({
      cycle_id: cycleId,
      account_id: accountId,
      status: 'submitted',
      research_fit_score: researchFitScore,
      submitted_at: submittedAt,
    })
    .returning('id');
  cleanup.applicationIds.push(app.id);
  return app;
}

async function submitScore(cycleId, appId, templateId, actorId, score) {
  const acc = await createAccount(`rev-${score}-${appId.slice(-4)}`);
  const [profile] = await knex('reviewer_profiles')
    .insert({ account_id: acc.id })
    .returning('id');
  cleanup.reviewerProfileIds.push(profile.id);

  const [assignment] = await knex('review_assignments')
    .insert({
      application_id: appId,
      reviewer_id: profile.id,
      cycle_id: cycleId,
      assignment_mode: 'manual',
      assigned_by: actorId,
      status: 'submitted',
    })
    .returning('id');
  cleanup.assignmentIds.push(assignment.id);

  const [scoreRow] = await knex('review_scores')
    .insert({
      assignment_id: assignment.id,
      template_id: templateId,
      criterion_scores: JSON.stringify({ overall: score }),
      composite_score: score,
      recommendation: 'admit',
      is_draft: false,
    })
    .returning('id');
  cleanup.reviewScoreIds.push(scoreRow.id);
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/rankings/aggregation.service.js');
  aggregationService = mod.aggregationService;
});

afterAll(async () => {
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

describe('rankings pipeline — aggregateCycle + rankCycle + getRankings', () => {
  it('ranks applications by trimmed_mean_score DESC, breaking ties by research_fit_score DESC', async () => {
    const actor = await createAccount('actor');
    const { cycleId, templateId } = await createCycleAndTemplate('rank-order');

    // Application A: mean 8.5, research_fit 8.0
    const applicantA = await createAccount('app-a');
    const appA = await createApplication(cycleId, applicantA.id, 8.0, '2025-01-01T10:00:00Z');

    // Application B: mean 7.5, research_fit 9.0 (lower score wins second by score, not fit)
    const applicantB = await createAccount('app-b');
    const appB = await createApplication(cycleId, applicantB.id, 9.0, '2025-01-01T10:01:00Z');

    // Application C: mean 8.5, research_fit 9.0 (ties with A on mean, wins by higher fit)
    const applicantC = await createAccount('app-c');
    const appC = await createApplication(cycleId, applicantC.id, 9.0, '2025-01-01T10:02:00Z');

    // Submit 2 scores per application (< trimMinCount=7, so plain mean is used)
    await submitScore(cycleId, appA.id, templateId, actor.id, 8);
    await submitScore(cycleId, appA.id, templateId, actor.id, 9);   // mean = 8.5

    await submitScore(cycleId, appB.id, templateId, actor.id, 7);
    await submitScore(cycleId, appB.id, templateId, actor.id, 8);   // mean = 7.5

    await submitScore(cycleId, appC.id, templateId, actor.id, 8);
    await submitScore(cycleId, appC.id, templateId, actor.id, 9);   // mean = 8.5

    const aggResult = await aggregationService.aggregateCycle(
      cycleId,
      actor.id,
      `req-rank-order-${TS}`,
    );
    expect(aggResult.aggregated).toBe(3);

    // Record aggregates for cleanup
    const aggs = await knex('application_score_aggregates').where({ cycle_id: cycleId }).select('id');
    for (const a of aggs) cleanup.aggregateIds.push(a.id);

    const rankResult = await aggregationService.rankCycle(cycleId, actor.id, `req-rank-compute-${TS}`);
    expect(rankResult.ranked).toBe(3);

    const { rows } = await aggregationService.getRankings(cycleId);
    expect(rows).toHaveLength(3);

    // Expected order: C (8.5 mean, 9.0 fit), A (8.5 mean, 8.0 fit), B (7.5 mean)
    expect(rows[0].application_id).toBe(appC.id);
    expect(rows[1].application_id).toBe(appA.id);
    expect(rows[2].application_id).toBe(appB.id);

    // Verify rank values are sequential from 1
    expect(Number(rows[0].rank)).toBe(1);
    expect(Number(rows[1].rank)).toBe(2);
    expect(Number(rows[2].rank)).toBe(3);
  });

  it('getRankings paginates correctly', async () => {
    const actor = await createAccount('actor-page');
    const { cycleId, templateId } = await createCycleAndTemplate('pagination');

    // Insert 5 applications with distinct scores
    const appIds = [];
    for (let i = 0; i < 5; i++) {
      const applicant = await createAccount(`page-app-${i}`);
      const app = await createApplication(cycleId, applicant.id, null, `2025-01-0${i + 1}T10:00:00Z`);
      appIds.push(app.id);
      // Each gets 2 scores: (10-i) → scores 10, 9, 8, 7, 6
      await submitScore(cycleId, app.id, templateId, actor.id, 10 - i);
      await submitScore(cycleId, app.id, templateId, actor.id, 10 - i);
    }

    await aggregationService.aggregateCycle(cycleId, actor.id, `req-page-agg-${TS}`);
    const aggs = await knex('application_score_aggregates').where({ cycle_id: cycleId }).select('id');
    for (const a of aggs) cleanup.aggregateIds.push(a.id);

    await aggregationService.rankCycle(cycleId, actor.id, `req-page-rank-${TS}`);

    // Page 1: first 2 items
    const page1 = await aggregationService.getRankings(cycleId, { pageSize: 2, page: 1 });
    expect(page1.total).toBe(5);
    expect(page1.rows).toHaveLength(2);
    expect(Number(page1.rows[0].rank)).toBe(1);
    expect(Number(page1.rows[1].rank)).toBe(2);

    // Page 2: next 2 items
    const page2 = await aggregationService.getRankings(cycleId, { pageSize: 2, page: 2 });
    expect(page2.total).toBe(5);
    expect(page2.rows).toHaveLength(2);
    expect(Number(page2.rows[0].rank)).toBe(3);
    expect(Number(page2.rows[1].rank)).toBe(4);

    // Page 3: last item
    const page3 = await aggregationService.getRankings(cycleId, { pageSize: 2, page: 3 });
    expect(page3.rows).toHaveLength(1);
    expect(Number(page3.rows[0].rank)).toBe(5);
  });

  it('getRankings filters to escalated applications when escalationOnly = true', async () => {
    const actor = await createAccount('actor-esc-filter');
    const { cycleId, templateId } = await createCycleAndTemplate('esc-filter');

    // App X: low variance (scores all 7) — should NOT be escalated
    const appXApplicant = await createAccount('esc-app-x');
    const appX = await createApplication(cycleId, appXApplicant.id, null, '2025-01-01T10:00:00Z');
    for (let i = 0; i < 3; i++) {
      await submitScore(cycleId, appX.id, templateId, actor.id, 7);
    }

    // App Y: high variance (scores 0 and 10 alternating) — should be escalated
    const appYApplicant = await createAccount('esc-app-y');
    const appY = await createApplication(cycleId, appYApplicant.id, null, '2025-01-01T10:01:00Z');
    for (let i = 0; i < 6; i++) {
      await submitScore(cycleId, appY.id, templateId, actor.id, i % 2 === 0 ? 0 : 10);
    }

    await aggregationService.aggregateCycle(cycleId, actor.id, `req-esc-filter-${TS}`);
    const aggs = await knex('application_score_aggregates').where({ cycle_id: cycleId }).select('id');
    for (const a of aggs) cleanup.aggregateIds.push(a.id);

    const escEvents = await knex('escalation_events').where({ cycle_id: cycleId }).select('id');
    for (const e of escEvents) cleanup.escalationIds.push(e.id);

    await aggregationService.rankCycle(cycleId, actor.id, `req-esc-filter-rank-${TS}`);

    const allRankings = await aggregationService.getRankings(cycleId);
    expect(allRankings.total).toBe(2);

    const escalatedOnly = await aggregationService.getRankings(cycleId, { escalationOnly: true });
    expect(escalatedOnly.total).toBe(1);
    expect(escalatedOnly.rows[0].application_id).toBe(appY.id);
    expect(escalatedOnly.rows[0].escalation_flag).toBe(true);
  });
});
