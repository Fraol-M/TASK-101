import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Integration tests for the applicant application submission flow.
 *
 * Covers the path that was missing from the API test suite:
 *   applicationService.create → persists application + program choices + institution history
 *   applicationService.getById → enforces object-level ownership (applicant sees own, 403 for others)
 *   applicationService.list → scoped to the applicant's own applications
 *
 * APPLICANT capability requires applications:write (seeded in 00_roles_permissions.js).
 * This test exercises the service layer directly with a real DB so the transaction
 * logic (all-or-nothing insert of application + choices + history) is verified.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let applicationService;

// Shared fixtures created in beforeAll
let cycleId;
let universityId;
let majorId;
let applicantId;
let outsiderId;

const cleanup = {
  applicationIds: [],
  programChoiceIds: [],
  institutionHistoryIds: [],
  majorIds: [],
  schoolIds: [],
  universityIds: [],
  cycleIds: [],
  accountIds: [],
};

async function createAccount(suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `app-sub-${TS}-${suffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/applications/application.service.js');
  applicationService = mod.applicationService;

  // Cycle
  const [cycle] = await knex('application_cycles')
    .insert({ name: `App Submission Test ${TS}`, year: 2099, status: 'open' })
    .returning('id');
  cycleId = cycle.id;
  cleanup.cycleIds.push(cycleId);

  // University (needed for institution_history FK and majors hierarchy)
  const [univ] = await knex('universities')
    .insert({ name_normalized: `app-sub-univ-${TS}` })
    .returning('id');
  universityId = univ.id;
  cleanup.universityIds.push(universityId);

  // School (needed for majors FK)
  const [school] = await knex('schools')
    .insert({ university_id: universityId, name_normalized: `app-sub-school-${TS}` })
    .returning('id');
  cleanup.schoolIds.push(school.id);

  // Major (needed for program_choices FK)
  const [major] = await knex('majors')
    .insert({ school_id: school.id, name_normalized: `app-sub-major-${TS}` })
    .returning('id');
  majorId = major.id;
  cleanup.majorIds.push(majorId);

  // Applicant account
  const applicant = await createAccount('applicant');
  applicantId = applicant.id;

  // Outsider account (different user, not admin, not the applicant)
  const outsider = await createAccount('outsider');
  outsiderId = outsider.id;
});

afterAll(async () => {
  // Delete in reverse FK order
  if (cleanup.applicationIds.length) {
    await knex('application_institution_history')
      .whereIn('application_id', cleanup.applicationIds).delete();
    await knex('application_program_choices')
      .whereIn('application_id', cleanup.applicationIds).delete();
    await knex('applications').whereIn('id', cleanup.applicationIds).delete();
  }
  if (cleanup.majorIds.length) {
    await knex('majors').whereIn('id', cleanup.majorIds).delete();
  }
  if (cleanup.schoolIds.length) {
    await knex('schools').whereIn('id', cleanup.schoolIds).delete();
  }
  if (cleanup.universityIds.length) {
    await knex('universities').whereIn('id', cleanup.universityIds).delete();
  }
  if (cleanup.cycleIds.length) {
    await knex('application_cycles').whereIn('id', cleanup.cycleIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

describe('applicationService.create — transactional submission', () => {
  it('creates application, program choices, and institution history in a single transaction', async () => {
    const app = await applicationService.create(
      {
        cycleId,
        programChoices: [{ majorId, preferenceOrder: 1 }],
        institutionHistory: [
          {
            universityId,
            role: 'enrolled',
            startDate: '2020-09-01',
            endDate: '2024-06-30',
          },
        ],
      },
      applicantId,
      `req-app-create-${TS}`,
    );

    cleanup.applicationIds.push(app.id);

    // Application persisted
    expect(app.id).toBeDefined();
    expect(app.cycle_id).toBe(cycleId);
    expect(app.account_id).toBe(applicantId);
    expect(app.status).toBe('submitted');
    expect(app.submitted_at).toBeTruthy();

    // Program choices persisted
    const choices = await knex('application_program_choices')
      .where({ application_id: app.id })
      .select('major_id', 'preference_order');
    expect(choices).toHaveLength(1);
    expect(choices[0].major_id).toBe(majorId);
    expect(Number(choices[0].preference_order)).toBe(1);

    // Institution history persisted
    const history = await knex('application_institution_history')
      .where({ application_id: app.id })
      .select('university_id', 'role', 'start_date', 'end_date');
    expect(history).toHaveLength(1);
    expect(history[0].university_id).toBe(universityId);
    expect(history[0].role).toBe('enrolled');
  });

  it('creates application without institution history when omitted', async () => {
    const app = await applicationService.create(
      {
        cycleId,
        programChoices: [{ majorId, preferenceOrder: 1 }],
      },
      applicantId,
      `req-app-no-hist-${TS}`,
    );

    cleanup.applicationIds.push(app.id);

    const history = await knex('application_institution_history')
      .where({ application_id: app.id });
    expect(history).toHaveLength(0);
  });
});

describe('applicationService.getById — object-level ownership', () => {
  let ownedAppId;

  beforeAll(async () => {
    const app = await applicationService.create(
      { cycleId, programChoices: [{ majorId, preferenceOrder: 1 }] },
      applicantId,
      `req-app-getbyid-${TS}`,
    );
    ownedAppId = app.id;
    cleanup.applicationIds.push(ownedAppId);
  });

  it('allows the applicant to retrieve their own application', async () => {
    const result = await applicationService.getById(ownedAppId, {
      id: applicantId,
      roles: [],
    });
    expect(result.id).toBe(ownedAppId);
    expect(result.account_id).toBe(applicantId);
  });

  it('throws AuthorizationError (403) when a different non-admin account requests the application', async () => {
    await expect(
      applicationService.getById(ownedAppId, { id: outsiderId, roles: [] }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('allows SYSTEM_ADMIN to retrieve any application', async () => {
    const result = await applicationService.getById(ownedAppId, {
      id: outsiderId,
      roles: ['SYSTEM_ADMIN'],
    });
    expect(result.id).toBe(ownedAppId);
  });

  it('allows PROGRAM_ADMIN to retrieve any application', async () => {
    const result = await applicationService.getById(ownedAppId, {
      id: outsiderId,
      roles: ['PROGRAM_ADMIN'],
    });
    expect(result.id).toBe(ownedAppId);
  });
});

describe('applicationService.list — applicant scoping', () => {
  it('returns only the applicant own applications (not other users)', async () => {
    // Create an application for a separate user to ensure it doesn't appear
    const otherApplicant = await createAccount('other-applicant');
    const otherApp = await applicationService.create(
      { cycleId, programChoices: [{ majorId, preferenceOrder: 1 }] },
      otherApplicant.id,
      `req-other-app-${TS}`,
    );
    cleanup.applicationIds.push(otherApp.id);

    const result = await applicationService.list({ id: applicantId, roles: [] }, { cycleId });

    // All returned applications must belong to the applicant
    for (const row of result.rows) {
      expect(row.account_id).toBe(applicantId);
    }

    // The other applicant's application must not be included
    const leakedApp = result.rows.find((r) => r.id === otherApp.id);
    expect(leakedApp).toBeUndefined();
  });

  it('returns all applications for PROGRAM_ADMIN', async () => {
    const result = await applicationService.list(
      { id: outsiderId, roles: ['PROGRAM_ADMIN'] },
      { cycleId },
    );
    // Admin should see both applicantId's apps and otherApplicant's apps in this cycle
    expect(result.total).toBeGreaterThanOrEqual(2);
  });
});
