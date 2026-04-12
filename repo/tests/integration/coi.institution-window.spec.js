import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for COI institution-window SQL logic.
 * Validates the actual SQL joins and time-window filtering in coiService
 * against real schema data — not mocked query results.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

let knex;
let coiService;

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

const cleanup = {
  appInstHistIds: [],
  revInstHistIds: [],
  reviewerProfileIds: [],
  applicationIds: [],
  cycleIds: [],
  universityIds: [],
  accountIds: [],
};

async function createAccount(suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `coi-test-${TS}-${suffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

async function createUniversity(suffix) {
  const [univ] = await knex('universities')
    .insert({ name_normalized: `coi-test-univ-${TS}-${suffix}` })
    .returning('id');
  cleanup.universityIds.push(univ.id);
  return univ;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/reviews/assignments/coi.service.js');
  coiService = mod.coiService;
});

afterAll(async () => {
  if (cleanup.appInstHistIds.length) {
    await knex('application_institution_history').whereIn('id', cleanup.appInstHistIds).delete();
  }
  if (cleanup.revInstHistIds.length) {
    await knex('reviewer_institution_history').whereIn('id', cleanup.revInstHistIds).delete();
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
  if (cleanup.universityIds.length) {
    await knex('universities').whereIn('id', cleanup.universityIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

describe('coiService.checkConflict — institution affiliation window', () => {
  it('detects COI when reviewer and applicant share a university (current affiliation)', async () => {
    const univ = await createUniversity('shared');

    // Reviewer: currently affiliated (end_date = null)
    const reviewerAcct = await createAccount('reviewer-coi');
    const [profile] = await knex('reviewer_profiles')
      .insert({ account_id: reviewerAcct.id })
      .returning('id');
    cleanup.reviewerProfileIds.push(profile.id);

    const [revHist] = await knex('reviewer_institution_history')
      .insert({
        reviewer_id: profile.id,
        university_id: univ.id,
        role: 'employed',
        start_date: '2020-01-01',
        end_date: null, // currently affiliated
      })
      .returning('id');
    cleanup.revInstHistIds.push(revHist.id);

    // Applicant: affiliated with same university
    const applicantAcct = await createAccount('applicant-coi');
    const [cycle] = await knex('application_cycles')
      .insert({ name: `COI Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicantAcct.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [appHist] = await knex('application_institution_history')
      .insert({
        application_id: app.id,
        university_id: univ.id,
        role: 'enrolled',
        start_date: '2019-09-01',
        end_date: '2023-06-01',
      })
      .returning('id');
    cleanup.appInstHistIds.push(appHist.id);

    const result = await coiService.checkConflict(profile.id, app.id);

    expect(result.hasConflict).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].type).toBe('institution_affiliation');
  });

  it('detects COI when reviewer affiliation ended within the 5-year window', async () => {
    const univ = await createUniversity('recent');

    const reviewerAcct = await createAccount('reviewer-recent');
    const [profile] = await knex('reviewer_profiles')
      .insert({ account_id: reviewerAcct.id })
      .returning('id');
    cleanup.reviewerProfileIds.push(profile.id);

    // Ended 2 years ago — still within the 5-year window
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const endDateStr = twoYearsAgo.toISOString().split('T')[0];

    const [revHist] = await knex('reviewer_institution_history')
      .insert({
        reviewer_id: profile.id,
        university_id: univ.id,
        role: 'employed',
        start_date: '2015-01-01',
        end_date: endDateStr,
      })
      .returning('id');
    cleanup.revInstHistIds.push(revHist.id);

    const applicantAcct = await createAccount('applicant-recent');
    const [cycle] = await knex('application_cycles')
      .insert({ name: `COI Recent Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicantAcct.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [appHist] = await knex('application_institution_history')
      .insert({
        application_id: app.id,
        university_id: univ.id,
        role: 'enrolled',
        start_date: '2019-01-01',
        end_date: '2023-01-01',
      })
      .returning('id');
    cleanup.appInstHistIds.push(appHist.id);

    const result = await coiService.checkConflict(profile.id, app.id);

    expect(result.hasConflict).toBe(true);
    expect(result.reasons[0].type).toBe('institution_affiliation');
  });

  it('clears COI when reviewer affiliation ended more than 5 years ago', async () => {
    const univ = await createUniversity('old');

    const reviewerAcct = await createAccount('reviewer-old');
    const [profile] = await knex('reviewer_profiles')
      .insert({ account_id: reviewerAcct.id })
      .returning('id');
    cleanup.reviewerProfileIds.push(profile.id);

    // Ended 6 years ago — outside the 5-year window
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);
    const endDateStr = sixYearsAgo.toISOString().split('T')[0];

    const [revHist] = await knex('reviewer_institution_history')
      .insert({
        reviewer_id: profile.id,
        university_id: univ.id,
        role: 'employed',
        start_date: '2010-01-01',
        end_date: endDateStr,
      })
      .returning('id');
    cleanup.revInstHistIds.push(revHist.id);

    const applicantAcct = await createAccount('applicant-old');
    const [cycle] = await knex('application_cycles')
      .insert({ name: `COI Old Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicantAcct.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [appHist] = await knex('application_institution_history')
      .insert({
        application_id: app.id,
        university_id: univ.id,
        role: 'enrolled',
        start_date: '2018-01-01',
        end_date: '2022-01-01',
      })
      .returning('id');
    cleanup.appInstHistIds.push(appHist.id);

    const result = await coiService.checkConflict(profile.id, app.id);

    expect(result.hasConflict).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it('returns no conflict when reviewer and applicant are at different universities', async () => {
    const reviewerUniv = await createUniversity('reviewer-only');
    const applicantUniv = await createUniversity('applicant-only');

    const reviewerAcct = await createAccount('reviewer-diff');
    const [profile] = await knex('reviewer_profiles')
      .insert({ account_id: reviewerAcct.id })
      .returning('id');
    cleanup.reviewerProfileIds.push(profile.id);

    const [revHist] = await knex('reviewer_institution_history')
      .insert({
        reviewer_id: profile.id,
        university_id: reviewerUniv.id,
        role: 'employed',
        start_date: '2020-01-01',
        end_date: null,
      })
      .returning('id');
    cleanup.revInstHistIds.push(revHist.id);

    const applicantAcct = await createAccount('applicant-diff');
    const [cycle] = await knex('application_cycles')
      .insert({ name: `COI No-Conflict Test ${TS}`, year: 2099, status: 'open' })
      .returning('id');
    cleanup.cycleIds.push(cycle.id);

    const [app] = await knex('applications')
      .insert({ cycle_id: cycle.id, account_id: applicantAcct.id, status: 'submitted' })
      .returning('id');
    cleanup.applicationIds.push(app.id);

    const [appHist] = await knex('application_institution_history')
      .insert({
        application_id: app.id,
        university_id: applicantUniv.id,
        role: 'enrolled',
        start_date: '2019-01-01',
        end_date: '2023-01-01',
      })
      .returning('id');
    cleanup.appInstHistIds.push(appHist.id);

    const result = await coiService.checkConflict(profile.id, app.id);

    expect(result.hasConflict).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });
});
