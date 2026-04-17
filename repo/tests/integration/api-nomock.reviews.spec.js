import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

/**
 * True no-mock API integration tests — applications, assignments, workbench,
 * scoring, rankings, and escalations.
 *
 * Full HTTP stack with real DB, no mocked execution-path dependencies.
 * Requires a real PostgreSQL test database.
 */

const TS = Date.now();
const PW = 'ReviewFlow@2026!!';

let knex;
let server;
let adminToken, reviewerToken, applicantToken;
let adminId, reviewerId, applicantId, reviewerProfileId;
let cycleId, scoringTemplateId, universityId, schoolId, majorId, majorVersionId;
let applicationId, assignmentId;

const cleanup = {
  escalationIds: [],
  rankingIds: [],
  scoreIds: [],
  assignmentIds: [],
  applicationIds: [],
  reviewerProfileIds: [],
  accountIds: [],
  entityIds: [], // [table, id] pairs for cleanup
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  await knex.seed.run();

  const hash = await bcrypt.hash(PW, 12);

  // Create admin
  const [admin] = await knex('accounts')
    .insert({ username: `rv-admin-${TS}`, password_hash: hash, status: 'active' })
    .returning('*');
  adminId = admin.id;
  cleanup.accountIds.push(admin.id);
  const adminRole = await knex('roles').where({ name: 'SYSTEM_ADMIN' }).first();
  await knex('account_roles').insert({ account_id: admin.id, role_id: adminRole.id })
    .onConflict(['account_id', 'role_id']).ignore();

  // Create reviewer account
  const [rev] = await knex('accounts')
    .insert({ username: `rv-rev-${TS}`, password_hash: hash, status: 'active' })
    .returning('*');
  reviewerId = rev.id;
  cleanup.accountIds.push(rev.id);
  const revRole = await knex('roles').where({ name: 'REVIEWER' }).first();
  await knex('account_roles').insert({ account_id: rev.id, role_id: revRole.id })
    .onConflict(['account_id', 'role_id']).ignore();

  // Create applicant account
  const [app] = await knex('accounts')
    .insert({ username: `rv-app-${TS}`, password_hash: hash, status: 'active' })
    .returning('*');
  applicantId = app.id;
  cleanup.accountIds.push(app.id);
  const appRole = await knex('roles').where({ name: 'APPLICANT' }).first();
  await knex('account_roles').insert({ account_id: app.id, role_id: appRole.id })
    .onConflict(['account_id', 'role_id']).ignore();

  // Create prerequisite data: application cycle
  const [cycle] = await knex('application_cycles')
    .insert({ name: `Cycle ${TS}`, status: 'open', year: 2026 })
    .returning('*');
  cycleId = cycle.id;

  const [template] = await knex('scoring_form_templates')
    .insert({
      cycle_id: cycleId,
      name: `No-mock scoring template ${TS}`,
      active: true,
      created_by: adminId,
      criteria_schema: JSON.stringify({
        criteria: [
          { id: 'research', weight: 50, maxScore: 10 },
          { id: 'statement', weight: 50, maxScore: 10 },
        ],
      }),
    })
    .returning('*');
  scoringTemplateId = template.id;

  // University → school → major chain for program choices
  const [uni] = await knex('universities')
    .insert({ name_normalized: `rv-uni-${TS}`, created_by: adminId }).returning('*');
  universityId = uni.id;

  const [school] = await knex('schools')
    .insert({ university_id: uni.id, name_normalized: `rv-school-${TS}`, created_by: adminId }).returning('*');
  schoolId = school.id;

  const [major] = await knex('majors')
    .insert({ school_id: school.id, name_normalized: `rv-major-${TS}`, created_by: adminId }).returning('*');
  majorId = major.id;

  // Major needs an active version for program choice lookup
  const [mv] = await knex('major_versions')
    .insert({
      major_id: majorId,
      version_number: 1,
      lifecycle_status: 'active',
      effective_from: '2026-01-01',
      payload_json: JSON.stringify({ name: `rv-major-${TS}`, field: 'computer science' }),
      created_by: adminId,
      published_at: new Date().toISOString(),
      published_by: adminId,
    }).returning('*');
  majorVersionId = mv.id;

  // Reviewer profile
  const [rp] = await knex('reviewer_profiles')
    .insert({
      account_id: reviewerId,
      max_load: 10,
      active_assignments: 0,
      available: true,
      active: true,
      expertise_tags: JSON.stringify(['computer science']),
    }).returning('*');
  reviewerProfileId = rp.id;
  cleanup.reviewerProfileIds.push(rp.id);

  // Boot real app
  const { createApp } = await import('../../src/app.js');
  server = createApp().callback();

  // Login all users
  const al = await request(server).post('/v1/auth/login').send({ username: `rv-admin-${TS}`, password: PW });
  adminToken = al.body.data.token;

  const rl = await request(server).post('/v1/auth/login').send({ username: `rv-rev-${TS}`, password: PW });
  reviewerToken = rl.body.data.token;

  const apl = await request(server).post('/v1/auth/login').send({ username: `rv-app-${TS}`, password: PW });
  applicantToken = apl.body.data.token;
}, 90_000);

afterAll(async () => {
  // Clean in FK order
  for (const id of cleanup.escalationIds) await knex('escalation_events').where('id', id).delete().catch(() => {});
  await knex('application_rankings').where('cycle_id', cycleId).delete().catch(() => {});
  await knex('application_aggregates').where('cycle_id', cycleId).delete().catch(() => {});
  for (const id of cleanup.scoreIds) await knex('review_scores').where('id', id).delete().catch(() => {});
  for (const id of cleanup.assignmentIds) await knex('review_assignments').where('id', id).delete().catch(() => {});
  for (const id of cleanup.applicationIds) {
    await knex('application_program_choices').where('application_id', id).delete().catch(() => {});
    await knex('application_institution_history').where('application_id', id).delete().catch(() => {});
    await knex('applications').where('id', id).delete().catch(() => {});
  }
  for (const id of cleanup.reviewerProfileIds) {
    await knex('reviewer_institution_history').where('reviewer_id', id).delete().catch(() => {});
    await knex('reviewer_profiles').where('id', id).delete().catch(() => {});
  }
  await knex('major_versions').where('id', majorVersionId).delete().catch(() => {});
  await knex('majors').where('id', majorId).delete().catch(() => {});
  await knex('schools').where('id', schoolId).delete().catch(() => {});
  await knex('universities').where('id', universityId).delete().catch(() => {});
  await knex('scoring_form_templates').where('id', scoringTemplateId).delete().catch(() => {});
  await knex('application_cycles').where('id', cycleId).delete().catch(() => {});
  for (const id of cleanup.accountIds) {
    await knex('sessions').where('account_id', id).delete().catch(() => {});
    await knex('idempotency_keys').where('account_id', id).delete().catch(() => {});
    await knex('audit_events').where('actor_account_id', id).delete().catch(() => {});
    await knex('account_roles').where('account_id', id).delete().catch(() => {});
    await knex('accounts').where('id', id).delete().catch(() => {});
  }
  await knex.destroy();
});

// ── Applications — no-mock ───────────────────────────────────────────────────

describe('Applications — no-mock', () => {
  it('POST /v1/applications — applicant creates application', async () => {
    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', `Bearer ${applicantToken}`)
      .set('Idempotency-Key', `rv-app-create-${TS}`)
      .send({
        cycleId,
        programChoices: [{ majorId, preferenceOrder: 1 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.cycle_id).toBe(cycleId);
    expect(res.body.data.status).toBe('submitted');
    applicationId = res.body.data.id;
    cleanup.applicationIds.push(applicationId);
  });

  it('GET /v1/applications — applicant sees own applications', async () => {
    const res = await request(server)
      .get('/v1/applications')
      .set('Authorization', `Bearer ${applicantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/applications/:id — applicant views own application', async () => {
    const res = await request(server)
      .get(`/v1/applications/${applicationId}`)
      .set('Authorization', `Bearer ${applicantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(applicationId);
  });

  it('GET /v1/applications — admin sees all applications', async () => {
    const res = await request(server)
      .get('/v1/applications')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Assignments — no-mock ────────────────────────────────────────────────────

describe('Assignments — no-mock', () => {
  it('POST /v1/assignments — admin creates assignment', async () => {
    const res = await request(server)
      .post('/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `rv-assign-${TS}`)
      .send({
        applicationId,
        reviewerId: reviewerProfileId,
        blindMode: 'semi_blind',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.blind_mode).toBe('semi_blind');
    assignmentId = res.body.data.id;
    cleanup.assignmentIds.push(assignmentId);
  });

  it('GET /v1/assignments — admin lists all assignments', async () => {
    const res = await request(server)
      .get('/v1/assignments')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/assignments/:id — admin views assignment', async () => {
    const res = await request(server)
      .get(`/v1/assignments/${assignmentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(assignmentId);
  });

  it('GET /v1/assignments — reviewer sees own assignments', async () => {
    const res = await request(server)
      .get('/v1/assignments')
      .set('Authorization', `Bearer ${reviewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('POST /v1/assignments/batch — admin creates batch assignment', async () => {
    const res = await request(server)
      .post('/v1/assignments/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `rv-batch-${TS}`)
      .send({
        applicationIds: [applicationId],
        reviewersPerApplication: 1,
        blindMode: 'blind',
      });

    expect([201, 422]).toContain(res.status);
    if (res.status === 201 && Array.isArray(res.body.data)) {
      for (const a of res.body.data) cleanup.assignmentIds.push(a.id);
    }
  });
});

// ── Attachments — no-mock ────────────────────────────────────────────────────

describe('Attachments — no-mock', () => {
  it('GET /v1/attachments — reviewer lists attachments for assignment', async () => {
    const res = await request(server)
      .get(`/v1/attachments?assignmentId=${assignmentId}`)
      .set('Authorization', `Bearer ${reviewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

// ── Workbench — no-mock ──────────────────────────────────────────────────────

describe('Workbench — no-mock', () => {
  it('GET /v1/workbench — reviewer sees pending assignments', async () => {
    const res = await request(server)
      .get('/v1/workbench')
      .set('Authorization', `Bearer ${reviewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeDefined();
  });

  it('GET /v1/workbench/:assignmentId — reviewer views assignment detail', async () => {
    const res = await request(server)
      .get(`/v1/workbench/${assignmentId}`)
      .set('Authorization', `Bearer ${reviewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

// ── Scoring — no-mock ────────────────────────────────────────────────────────

describe('Scoring — no-mock', () => {
  it('PUT /v1/scores/draft — reviewer saves draft score', async () => {
    const res = await request(server)
      .put('/v1/scores/draft')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .set('Idempotency-Key', `rv-draft-${TS}`)
      .send({
        assignmentId,
        criterionScores: { research: 8, statement: 7.5 },
        narrativeComments: 'Strong research background',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.is_draft).toBe(true);
    if (res.body.data.id) cleanup.scoreIds.push(res.body.data.id);
  });

  it('POST /v1/scores/submit — reviewer submits final score', async () => {
    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .set('Idempotency-Key', `rv-submit-${TS}`)
      .send({
        assignmentId,
        criterionScores: { research: 8, statement: 7.5 },
        recommendation: 'admit',
        narrativeComments: 'Strong candidate',
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.is_draft).toBe(false);
    if (res.body.data.id) cleanup.scoreIds.push(res.body.data.id);
  });

  it('GET /v1/scores/:assignmentId — reviewer reads submitted score', async () => {
    const res = await request(server)
      .get(`/v1/scores/${assignmentId}`)
      .set('Authorization', `Bearer ${reviewerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

// ── Rankings — no-mock ───────────────────────────────────────────────────────

describe('Rankings — no-mock', () => {
  it('POST /v1/rankings/cycles/:cycleId/aggregate — triggers aggregation', async () => {
    const res = await request(server)
      .post(`/v1/rankings/cycles/${cycleId}/aggregate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `rv-agg-${TS}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('POST /v1/rankings/cycles/:cycleId/rank — computes rankings', async () => {
    const res = await request(server)
      .post(`/v1/rankings/cycles/${cycleId}/rank`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `rv-rank-${TS}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/rankings/cycles/:cycleId — reads ranked list', async () => {
    const res = await request(server)
      .get(`/v1/rankings/cycles/${cycleId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeDefined();
  });

  it('POST /v1/rankings/escalations — creates manual escalation', async () => {
    const res = await request(server)
      .post('/v1/rankings/escalations')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Idempotency-Key', `rv-esc-${TS}`)
      .send({
        applicationId,
        cycleId,
        trigger: 'manual',
        notes: 'Needs committee review',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    if (res.body.data.id) cleanup.escalationIds.push(res.body.data.id);
  });
});
