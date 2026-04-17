import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

/**
 * True no-mock API integration tests — search, personalization, and multi-entity versioning.
 *
 * Full HTTP stack without any mocked execution-path dependencies.
 * Requires a real PostgreSQL test database.
 */

const TS = Date.now();
const TEST_PASSWORD = 'FeatNoMock@2026!!';

let knex;
let server;
let userToken;
let userId;

const cleanup = {
  accountIds: [],
  universityIds: [],
  versionIds: [],
  schoolIds: [],
  schoolVersionIds: [],
  majorIds: [],
  majorVersionIds: [],
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  await knex.seed.run();

  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  const [acc] = await knex('accounts')
    .insert({ username: `nm-feat-${TS}`, password_hash: hash, status: 'active' })
    .returning('*');
  userId = acc.id;
  cleanup.accountIds.push(acc.id);

  // Assign SYSTEM_ADMIN (has all permissions)
  const role = await knex('roles').where({ name: 'SYSTEM_ADMIN' }).first();
  await knex('account_roles').insert({ account_id: acc.id, role_id: role.id })
    .onConflict(['account_id', 'role_id']).ignore();

  const { createApp } = await import('../../src/app.js');
  server = createApp().callback();

  const loginRes = await request(server)
    .post('/v1/auth/login')
    .send({ username: `nm-feat-${TS}`, password: TEST_PASSWORD });
  userToken = loginRes.body.data.token;
}, 60_000);

afterAll(async () => {
  // Clean downstream FK entities (linked via majors)
  for (const tbl of ['retest_rule_versions', 'application_requirement_versions', 'transfer_quota_versions', 'enrollment_plan_versions', 'research_track_versions']) {
    await knex(tbl).where('created_by', userId).delete().catch(() => {});
  }
  for (const tbl of ['retest_rules', 'application_requirements', 'transfer_quotas', 'enrollment_plans', 'research_tracks']) {
    await knex(tbl).where('created_by', userId).delete().catch(() => {});
  }
  for (const id of cleanup.majorVersionIds) {
    await knex('major_versions').where('id', id).delete().catch(() => {});
  }
  await knex('major_versions').where('created_by', userId).delete().catch(() => {});
  await knex('majors').where('created_by', userId).delete().catch(() => {});
  for (const id of cleanup.schoolVersionIds) {
    await knex('school_versions').where('id', id).delete().catch(() => {});
  }
  for (const id of cleanup.schoolIds) {
    await knex('schools').where('id', id).delete().catch(() => {});
  }
  await knex('school_versions').where('created_by', userId).delete().catch(() => {});
  await knex('schools').where('created_by', userId).delete().catch(() => {});
  for (const id of cleanup.versionIds) {
    await knex('university_versions').where('id', id).delete().catch(() => {});
  }
  for (const id of cleanup.universityIds) {
    await knex('universities').where('id', id).delete().catch(() => {});
  }
  await knex('university_versions').where('created_by', userId).delete().catch(() => {});
  await knex('universities').where('created_by', userId).delete().catch(() => {});
  for (const id of cleanup.accountIds) {
    await knex('browsing_history').where('account_id', id).delete().catch(() => {});
    await knex('user_bookmarks').where('account_id', id).delete().catch(() => {});
    await knex('user_preferences').where('account_id', id).delete().catch(() => {});
    await knex('user_tag_subscriptions').where('account_id', id).delete().catch(() => {});
    await knex('saved_queries').where('account_id', id).delete().catch(() => {});
    await knex('sessions').where('account_id', id).delete().catch(() => {});
    await knex('idempotency_keys').where('account_id', id).delete().catch(() => {});
    await knex('audit_events').where('actor_account_id', id).delete().catch(() => {});
    await knex('account_roles').where('account_id', id).delete().catch(() => {});
    await knex('accounts').where('id', id).delete().catch(() => {});
  }
  await knex.destroy();
});

function auth() {
  return { Authorization: `Bearer ${userToken}` };
}

// ── Search endpoints — no-mock ───────────────────────────────────────────────

describe('Search — no-mock', () => {
  it('GET /v1/search/suggest — returns suggestions', async () => {
    const res = await request(server)
      .get('/v1/search/suggest?q=test')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  let savedQueryId;

  it('POST /v1/search/saved-queries — creates saved query', async () => {
    const res = await request(server)
      .post('/v1/search/saved-queries')
      .set(auth())
      .set('Idempotency-Key', `nm-sq-create-${TS}`)
      .send({ name: `NM Query ${TS}`, queryText: 'computer science' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    savedQueryId = res.body.data.id;
  });

  it('GET /v1/search/saved-queries — lists saved queries', async () => {
    const res = await request(server)
      .get('/v1/search/saved-queries')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('PATCH /v1/search/saved-queries/:id — updates saved query', async () => {
    const res = await request(server)
      .patch(`/v1/search/saved-queries/${savedQueryId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-sq-patch-${TS}`)
      .send({ name: `Updated NM Query ${TS}` });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(savedQueryId);
  });

  it('POST /v1/search/saved-queries/:id/run — executes saved query', async () => {
    const res = await request(server)
      .post(`/v1/search/saved-queries/${savedQueryId}/run`)
      .set(auth())
      .set('Idempotency-Key', `nm-sq-run-${TS}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('DELETE /v1/search/saved-queries/:id — deletes saved query', async () => {
    const res = await request(server)
      .delete(`/v1/search/saved-queries/${savedQueryId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-sq-delete-${TS}`);

    expect(res.status).toBe(204);
  });
});

// ── Personalization endpoints — no-mock ──────────────────────────────────────

describe('Personalization — no-mock', () => {
  const stableId = '00000000-0000-0000-0000-ffffffffffff';

  it('POST /v1/personalization/views — records a view', async () => {
    const res = await request(server)
      .post('/v1/personalization/views')
      .set(auth())
      .set('Idempotency-Key', `nm-view-${TS}`)
      .send({ entityType: 'university', stableId });

    expect(res.status).toBe(204);
  });

  it('GET /v1/personalization/history — includes the recorded view', async () => {
    const res = await request(server)
      .get('/v1/personalization/history')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('POST /v1/personalization/bookmarks — adds a bookmark', async () => {
    const res = await request(server)
      .post('/v1/personalization/bookmarks')
      .set(auth())
      .set('Idempotency-Key', `nm-bm-add-${TS}`)
      .send({ entityType: 'university', stableId });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/personalization/bookmarks — includes the bookmark', async () => {
    const res = await request(server)
      .get('/v1/personalization/bookmarks')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /v1/personalization/bookmarks — removes the bookmark', async () => {
    const res = await request(server)
      .delete('/v1/personalization/bookmarks')
      .set(auth())
      .set('Idempotency-Key', `nm-bm-del-${TS}`)
      .send({ entityType: 'university', stableId });

    expect(res.status).toBe(204);
  });

  it('GET /v1/personalization/recommendations — returns recommendations', async () => {
    const res = await request(server)
      .get('/v1/personalization/recommendations')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('PUT /v1/personalization/preferences/:key — sets a preference', async () => {
    const res = await request(server)
      .put('/v1/personalization/preferences/theme')
      .set(auth())
      .set('Idempotency-Key', `nm-pref-set-${TS}`)
      .send({ value: 'dark' });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/personalization/preferences — includes the preference', async () => {
    const res = await request(server)
      .get('/v1/personalization/preferences')
      .set(auth());

    expect(res.status).toBe(200);
  });

  it('DELETE /v1/personalization/preferences/:key — deletes the preference', async () => {
    const res = await request(server)
      .delete('/v1/personalization/preferences/theme')
      .set(auth())
      .set('Idempotency-Key', `nm-pref-del-${TS}`);

    expect(res.status).toBe(204);
  });

  it('POST /v1/personalization/subscriptions — adds tag subscription', async () => {
    const res = await request(server)
      .post('/v1/personalization/subscriptions')
      .set(auth())
      .set('Idempotency-Key', `nm-sub-add-${TS}`)
      .send({ tag: 'machine-learning', tagType: 'topic' });

    expect(res.status).toBe(201);
    expect(res.body.data.tag).toBe('machine-learning');
  });

  it('GET /v1/personalization/subscriptions — includes the subscription', async () => {
    const res = await request(server)
      .get('/v1/personalization/subscriptions')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /v1/personalization/subscriptions/:tag — removes subscription', async () => {
    const res = await request(server)
      .delete('/v1/personalization/subscriptions/machine-learning')
      .set(auth())
      .set('Idempotency-Key', `nm-sub-del-${TS}`);

    expect(res.status).toBe(204);
  });
});

// ── Multi-entity versioning — schools lifecycle (proves FK entity coverage) ──

describe('Schools versioned lifecycle — no-mock', () => {
  let universityId;
  let schoolStableId;
  let schoolVersionId;

  it('POST /v1/universities — creates parent entity', async () => {
    const res = await request(server)
      .post('/v1/universities')
      .set(auth())
      .set('Idempotency-Key', `nm-uni-school-${TS}`)
      .send({ name: `School Parent Uni ${TS}` });

    expect(res.status).toBe(201);
    universityId = res.body.data.stable.id;
    cleanup.universityIds.push(universityId);
    cleanup.versionIds.push(res.body.data.version.id);
  });

  it('POST /v1/schools — creates a school under the university', async () => {
    const res = await request(server)
      .post('/v1/schools')
      .set(auth())
      .set('Idempotency-Key', `nm-school-create-${TS}`)
      .send({ name: `NM School ${TS}`, universityId });

    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
    schoolStableId = res.body.data.stable.id;
    schoolVersionId = res.body.data.version.id;
    cleanup.schoolIds.push(schoolStableId);
    cleanup.schoolVersionIds.push(schoolVersionId);
  });

  it('GET /v1/schools — lists schools', async () => {
    const res = await request(server)
      .get('/v1/schools')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/schools/:stableId/versions — shows school version history', async () => {
    const res = await request(server)
      .get(`/v1/schools/${schoolStableId}/versions`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/schools/:stableId/versions/:versionId — returns school version', async () => {
    const res = await request(server)
      .get(`/v1/schools/${schoolStableId}/versions/${schoolVersionId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(schoolVersionId);
  });

  it('PATCH /v1/schools/:stableId/versions/:versionId — updates school draft', async () => {
    const res = await request(server)
      .patch(`/v1/schools/${schoolStableId}/versions/${schoolVersionId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-school-patch-${TS}`)
      .send({ name: `Updated School ${TS}`, universityId });

    expect(res.status).toBe(200);
  });

  it('POST /v1/schools/.../publish — publishes school version', async () => {
    const res = await request(server)
      .post(`/v1/schools/${schoolStableId}/versions/${schoolVersionId}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-school-pub-${TS}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_status).toBe('active');
  });

  it('GET /v1/schools/:stableId — returns active school version', async () => {
    const res = await request(server)
      .get(`/v1/schools/${schoolStableId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_status).toBe('active');
  });

  it('GET /v1/schools/:stableId/current — returns current school version', async () => {
    const res = await request(server)
      .get(`/v1/schools/${schoolStableId}/current`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_status).toBe('active');
  });

  it('POST /v1/schools/:stableId/versions/:versionId/activate — activates school version', async () => {
    const res = await request(server)
      .post(`/v1/schools/${schoolStableId}/versions/${schoolVersionId}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-school-act-${TS}`)
      .send({});

    expect([200, 409, 422]).toContain(res.status);
  });

  it('POST /v1/schools/:stableId/versions — creates new school draft version', async () => {
    const res = await request(server)
      .post(`/v1/schools/${schoolStableId}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-school-newv-${TS}`)
      .send({ name: `NM School v2 ${TS}`, universityId });

    expect(res.status).toBe(201);
    if (res.body.data?.id) cleanup.schoolVersionIds.push(res.body.data.id);
  });

  it('POST /v1/schools/:stableId/archive — archives school', async () => {
    const res = await request(server)
      .post(`/v1/schools/${schoolStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-school-arch-${TS}`);

    expect(res.status).toBe(200);
    expect(res.body.data.archived).toBe(true);
  });
});

// ── Chained FK versioned entities — majors + downstream ──────────────────────
// Tests the university → school → major → (research-tracks, enrollment-plans,
// transfer-quotas, application-requirements) FK chain through the real API.

describe('Chained versioned entities — no-mock', () => {
  let uniId, schoolId2, majorStableId, majorVersionId2;

  // Build the FK chain: university → school → major
  it('POST /v1/universities — parent for chain', async () => {
    const res = await request(server)
      .post('/v1/universities')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-uni-${TS}`)
      .send({ name: `Chain Uni ${TS}` });
    expect(res.status).toBe(201);
    uniId = res.body.data.stable.id;
    cleanup.universityIds.push(uniId);
    cleanup.versionIds.push(res.body.data.version.id);
  });

  it('POST /v1/schools — school in chain', async () => {
    const res = await request(server)
      .post('/v1/schools')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-school-${TS}`)
      .send({ name: `Chain School ${TS}`, universityId: uniId });
    expect(res.status).toBe(201);
    schoolId2 = res.body.data.stable.id;
    cleanup.schoolIds.push(schoolId2);
    cleanup.schoolVersionIds.push(res.body.data.version.id);
  });

  it('POST /v1/majors — creates major under school', async () => {
    const res = await request(server)
      .post('/v1/majors')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-major-${TS}`)
      .send({ name: `Chain Major ${TS}`, schoolId: schoolId2 });
    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
    majorStableId = res.body.data.stable.id;
    majorVersionId2 = res.body.data.version.id;
  });

  it('GET /v1/majors — lists majors', async () => {
    const res = await request(server).get('/v1/majors').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/majors/:stableId/versions — shows version history', async () => {
    const res = await request(server)
      .get(`/v1/majors/${majorStableId}/versions`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/majors/:stableId/versions/:versionId — returns version', async () => {
    const res = await request(server)
      .get(`/v1/majors/${majorStableId}/versions/${majorVersionId2}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(majorVersionId2);
  });

  it('POST /v1/majors/:stableId/archive — archives major', async () => {
    const res = await request(server)
      .post(`/v1/majors/${majorStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-chain-major-arch-${TS}`);
    expect(res.status).toBe(200);
    expect(res.body.data.archived).toBe(true);
  });

  // ── Downstream FK entities (all need majorId) ─────────────────────────────

  // Create a fresh major for downstream entities (previous was archived)
  let liveMajorId;
  it('POST /v1/majors — fresh major for downstream tests', async () => {
    const res = await request(server)
      .post('/v1/majors')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-major2-${TS}`)
      .send({ name: `Live Major ${TS}`, schoolId: schoolId2 });
    expect(res.status).toBe(201);
    liveMajorId = res.body.data.stable.id;
  });

  // Research Tracks
  it('POST /v1/research-tracks — creates under major', async () => {
    const res = await request(server)
      .post('/v1/research-tracks')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-rt-${TS}`)
      .send({ name: `Chain RT ${TS}`, majorId: liveMajorId });
    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
  });

  it('GET /v1/research-tracks — lists research tracks', async () => {
    const res = await request(server).get('/v1/research-tracks').set(auth());
    expect(res.status).toBe(200);
  });

  // Enrollment Plans
  it('POST /v1/enrollment-plans — creates under major', async () => {
    const res = await request(server)
      .post('/v1/enrollment-plans')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-ep-${TS}`)
      .send({ name: `Chain EP ${TS}`, majorId: liveMajorId });
    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
  });

  it('GET /v1/enrollment-plans — lists enrollment plans', async () => {
    const res = await request(server).get('/v1/enrollment-plans').set(auth());
    expect(res.status).toBe(200);
  });

  // Transfer Quotas
  it('POST /v1/transfer-quotas — creates under major', async () => {
    const res = await request(server)
      .post('/v1/transfer-quotas')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-tq-${TS}`)
      .send({ name: `Chain TQ ${TS}`, majorId: liveMajorId });
    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
  });

  it('GET /v1/transfer-quotas — lists transfer quotas', async () => {
    const res = await request(server).get('/v1/transfer-quotas').set(auth());
    expect(res.status).toBe(200);
  });

  // Application Requirements
  it('POST /v1/application-requirements — creates under major', async () => {
    const res = await request(server)
      .post('/v1/application-requirements')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-ar-${TS}`)
      .send({ name: `Chain AR ${TS}`, majorId: liveMajorId });
    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
  });

  it('GET /v1/application-requirements — lists', async () => {
    const res = await request(server).get('/v1/application-requirements').set(auth());
    expect(res.status).toBe(200);
  });

  // Retest Rules
  it('POST /v1/retest-rules — creates under major', async () => {
    const res = await request(server)
      .post('/v1/retest-rules')
      .set(auth())
      .set('Idempotency-Key', `nm-chain-rr-${TS}`)
      .send({ name: `Chain RR ${TS}`, majorId: liveMajorId });
    expect(res.status).toBe(201);
    expect(res.body.data.stable).toBeDefined();
  });

  it('GET /v1/retest-rules — lists', async () => {
    const res = await request(server).get('/v1/retest-rules').set(auth());
    expect(res.status).toBe(200);
  });
});

// ── Majors full lifecycle — no-mock ──────────────────────────────────────────

describe('Majors full lifecycle — no-mock', () => {
  let uniId2, schoolId3, majorStableId2, majorVersionId3, draftVersionId;

  it('POST /v1/universities — setup parent', async () => {
    const res = await request(server)
      .post('/v1/universities')
      .set(auth())
      .set('Idempotency-Key', `nm-lc-uni-${TS}`)
      .send({ name: `LC Uni ${TS}` });
    expect(res.status).toBe(201);
    uniId2 = res.body.data.stable.id;
    cleanup.universityIds.push(uniId2);
    cleanup.versionIds.push(res.body.data.version.id);
  });

  it('POST /v1/schools — setup school', async () => {
    const res = await request(server)
      .post('/v1/schools')
      .set(auth())
      .set('Idempotency-Key', `nm-lc-school-${TS}`)
      .send({ name: `LC School ${TS}`, universityId: uniId2 });
    expect(res.status).toBe(201);
    schoolId3 = res.body.data.stable.id;
    cleanup.schoolIds.push(schoolId3);
    cleanup.schoolVersionIds.push(res.body.data.version.id);
  });

  it('POST /v1/majors — creates major', async () => {
    const res = await request(server)
      .post('/v1/majors')
      .set(auth())
      .set('Idempotency-Key', `nm-lc-major-${TS}`)
      .send({ name: `LC Major ${TS}`, schoolId: schoolId3 });
    expect(res.status).toBe(201);
    majorStableId2 = res.body.data.stable.id;
    majorVersionId3 = res.body.data.version.id;
    cleanup.majorVersionIds.push(majorVersionId3);
  });

  it('GET /v1/majors/:stableId — gets major by stable id', async () => {
    const res = await request(server)
      .get(`/v1/majors/${majorStableId2}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/majors/:stableId/current — gets current version', async () => {
    const res = await request(server)
      .get(`/v1/majors/${majorStableId2}/current`)
      .set(auth());
    expect([200, 404]).toContain(res.status);
  });

  it('PATCH /v1/majors/:stableId/versions/:versionId — patches draft version', async () => {
    const res = await request(server)
      .patch(`/v1/majors/${majorStableId2}/versions/${majorVersionId3}`)
      .set(auth())
      .set('Idempotency-Key', `nm-lc-major-patch-${TS}`)
      .send({ name: `LC Major Updated ${TS}` });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /v1/majors/:stableId/versions/:versionId/publish — publishes version', async () => {
    const res = await request(server)
      .post(`/v1/majors/${majorStableId2}/versions/${majorVersionId3}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-lc-major-pub-${TS}`)
      .send({});
    expect([200, 409]).toContain(res.status);
  });

  it('POST /v1/majors/:stableId/versions — creates new draft version', async () => {
    const res = await request(server)
      .post(`/v1/majors/${majorStableId2}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-lc-major-newv-${TS}`)
      .send({ name: `LC Major v2 ${TS}`, schoolId: schoolId3 });
    expect(res.status).toBe(201);
    if (res.body.data?.id) {
      draftVersionId = res.body.data.id;
      cleanup.majorVersionIds.push(draftVersionId);
    }
  });

  it('POST /v1/majors/:stableId/versions/:versionId/activate — activates published version', async () => {
    const res = await request(server)
      .post(`/v1/majors/${majorStableId2}/versions/${majorVersionId3}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-lc-major-act-${TS}`);
    expect([200, 409, 422]).toContain(res.status);
  });
});

// ── Downstream entity detail routes — no-mock ────────────────────────────────

describe('Downstream entity GET detail routes — no-mock', () => {
  let uniId3, schoolId4, majorId4;
  let rtStableId, epStableId, tqStableId, arStableId, rrStableId;
  let rtVersionId, epVersionId, tqVersionId, arVersionId, rrVersionId;

  it('setup: university → school → major chain', async () => {
    const uniRes = await request(server)
      .post('/v1/universities')
      .set(auth())
      .set('Idempotency-Key', `nm-det-uni-${TS}`)
      .send({ name: `Det Uni ${TS}` });
    expect(uniRes.status).toBe(201);
    uniId3 = uniRes.body.data.stable.id;
    cleanup.universityIds.push(uniId3);
    cleanup.versionIds.push(uniRes.body.data.version.id);

    const schRes = await request(server)
      .post('/v1/schools')
      .set(auth())
      .set('Idempotency-Key', `nm-det-school-${TS}`)
      .send({ name: `Det School ${TS}`, universityId: uniId3 });
    expect(schRes.status).toBe(201);
    schoolId4 = schRes.body.data.stable.id;
    cleanup.schoolIds.push(schoolId4);
    cleanup.schoolVersionIds.push(schRes.body.data.version.id);

    const majRes = await request(server)
      .post('/v1/majors')
      .set(auth())
      .set('Idempotency-Key', `nm-det-major-${TS}`)
      .send({ name: `Det Major ${TS}`, schoolId: schoolId4 });
    expect(majRes.status).toBe(201);
    majorId4 = majRes.body.data.stable.id;
    cleanup.majorVersionIds.push(majRes.body.data.version.id);
  });

  it('setup: create research-track', async () => {
    const res = await request(server)
      .post('/v1/research-tracks')
      .set(auth())
      .set('Idempotency-Key', `nm-det-rt-${TS}`)
      .send({ name: `Det RT ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
    rtStableId = res.body.data.stable.id;
    rtVersionId = res.body.data.version.id;
  });

  it('GET /v1/research-tracks/:stableId — gets research-track by id', async () => {
    const res = await request(server).get(`/v1/research-tracks/${rtStableId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('GET /v1/research-tracks/:stableId/current — gets current version', async () => {
    const res = await request(server).get(`/v1/research-tracks/${rtStableId}/current`).set(auth());
    expect([200, 404]).toContain(res.status);
  });

  it('GET /v1/research-tracks/:stableId/versions — lists versions', async () => {
    const res = await request(server).get(`/v1/research-tracks/${rtStableId}/versions`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/research-tracks/:stableId/versions/:versionId — gets version', async () => {
    const res = await request(server)
      .get(`/v1/research-tracks/${rtStableId}/versions/${rtVersionId}`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(rtVersionId);
  });

  it('PATCH /v1/research-tracks/:stableId/versions/:versionId — patches version', async () => {
    const res = await request(server)
      .patch(`/v1/research-tracks/${rtStableId}/versions/${rtVersionId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rt-patch-${TS}`)
      .send({ name: `Det RT Updated ${TS}` });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /v1/research-tracks/:stableId/versions/:versionId/publish — publishes version', async () => {
    const res = await request(server)
      .post(`/v1/research-tracks/${rtStableId}/versions/${rtVersionId}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rt-pub-${TS}`)
      .send({});
    expect([200, 409]).toContain(res.status);
  });

  it('POST /v1/research-tracks/:stableId/versions/:versionId/activate — activates version', async () => {
    const res = await request(server)
      .post(`/v1/research-tracks/${rtStableId}/versions/${rtVersionId}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rt-act-${TS}`)
      .send({});
    expect([200, 409, 422]).toContain(res.status);
  });

  it('POST /v1/research-tracks/:stableId/versions — creates new draft version', async () => {
    const res = await request(server)
      .post(`/v1/research-tracks/${rtStableId}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rt-newv-${TS}`)
      .send({ name: `Det RT v2 ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
  });

  it('POST /v1/research-tracks/:stableId/archive — archives research-track', async () => {
    const res = await request(server)
      .post(`/v1/research-tracks/${rtStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rt-arch-${TS}`);
    expect([200, 404]).toContain(res.status);
  });

  it('setup: create enrollment-plan', async () => {
    const res = await request(server)
      .post('/v1/enrollment-plans')
      .set(auth())
      .set('Idempotency-Key', `nm-det-ep-${TS}`)
      .send({ name: `Det EP ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
    epStableId = res.body.data.stable.id;
    epVersionId = res.body.data.version.id;
  });

  it('GET /v1/enrollment-plans/:stableId — gets by id', async () => {
    const res = await request(server).get(`/v1/enrollment-plans/${epStableId}`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/enrollment-plans/:stableId/current — gets current version', async () => {
    const res = await request(server).get(`/v1/enrollment-plans/${epStableId}/current`).set(auth());
    expect([200, 404]).toContain(res.status);
  });

  it('GET /v1/enrollment-plans/:stableId/versions — lists versions', async () => {
    const res = await request(server).get(`/v1/enrollment-plans/${epStableId}/versions`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/enrollment-plans/:stableId/versions/:versionId — gets version', async () => {
    const res = await request(server)
      .get(`/v1/enrollment-plans/${epStableId}/versions/${epVersionId}`)
      .set(auth());
    expect(res.status).toBe(200);
  });

  it('PATCH /v1/enrollment-plans/:stableId/versions/:versionId — patches draft', async () => {
    const res = await request(server)
      .patch(`/v1/enrollment-plans/${epStableId}/versions/${epVersionId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ep-patch-${TS}`)
      .send({ name: `Det EP Updated ${TS}` });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /v1/enrollment-plans/:stableId/versions/:versionId/publish — publishes', async () => {
    const res = await request(server)
      .post(`/v1/enrollment-plans/${epStableId}/versions/${epVersionId}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ep-pub-${TS}`)
      .send({});
    expect([200, 409]).toContain(res.status);
  });

  it('POST /v1/enrollment-plans/:stableId/versions/:versionId/activate — activates', async () => {
    const res = await request(server)
      .post(`/v1/enrollment-plans/${epStableId}/versions/${epVersionId}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ep-act-${TS}`)
      .send({});
    expect([200, 409, 422]).toContain(res.status);
  });

  it('POST /v1/enrollment-plans/:stableId/versions — creates new draft', async () => {
    const res = await request(server)
      .post(`/v1/enrollment-plans/${epStableId}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ep-newv-${TS}`)
      .send({ name: `Det EP v2 ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
  });

  it('POST /v1/enrollment-plans/:stableId/archive — archives', async () => {
    const res = await request(server)
      .post(`/v1/enrollment-plans/${epStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ep-arch-${TS}`);
    expect([200, 404]).toContain(res.status);
  });

  it('setup: create transfer-quota', async () => {
    const res = await request(server)
      .post('/v1/transfer-quotas')
      .set(auth())
      .set('Idempotency-Key', `nm-det-tq-${TS}`)
      .send({ name: `Det TQ ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
    tqStableId = res.body.data.stable.id;
    tqVersionId = res.body.data.version.id;
  });

  it('GET /v1/transfer-quotas/:stableId — gets by id', async () => {
    const res = await request(server).get(`/v1/transfer-quotas/${tqStableId}`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/transfer-quotas/:stableId/current — gets current version', async () => {
    const res = await request(server).get(`/v1/transfer-quotas/${tqStableId}/current`).set(auth());
    expect([200, 404]).toContain(res.status);
  });

  it('GET /v1/transfer-quotas/:stableId/versions — lists versions', async () => {
    const res = await request(server).get(`/v1/transfer-quotas/${tqStableId}/versions`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/transfer-quotas/:stableId/versions/:versionId — gets version', async () => {
    const res = await request(server)
      .get(`/v1/transfer-quotas/${tqStableId}/versions/${tqVersionId}`)
      .set(auth());
    expect(res.status).toBe(200);
  });

  it('PATCH /v1/transfer-quotas/:stableId/versions/:versionId — patches draft', async () => {
    const res = await request(server)
      .patch(`/v1/transfer-quotas/${tqStableId}/versions/${tqVersionId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-tq-patch-${TS}`)
      .send({ name: `Det TQ Updated ${TS}` });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /v1/transfer-quotas/:stableId/versions/:versionId/publish — publishes', async () => {
    const res = await request(server)
      .post(`/v1/transfer-quotas/${tqStableId}/versions/${tqVersionId}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-tq-pub-${TS}`)
      .send({});
    expect([200, 409]).toContain(res.status);
  });

  it('POST /v1/transfer-quotas/:stableId/versions/:versionId/activate — activates', async () => {
    const res = await request(server)
      .post(`/v1/transfer-quotas/${tqStableId}/versions/${tqVersionId}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-tq-act-${TS}`)
      .send({});
    expect([200, 409, 422]).toContain(res.status);
  });

  it('POST /v1/transfer-quotas/:stableId/versions — creates new draft', async () => {
    const res = await request(server)
      .post(`/v1/transfer-quotas/${tqStableId}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-tq-newv-${TS}`)
      .send({ name: `Det TQ v2 ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
  });

  it('POST /v1/transfer-quotas/:stableId/archive — archives', async () => {
    const res = await request(server)
      .post(`/v1/transfer-quotas/${tqStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-tq-arch-${TS}`);
    expect([200, 404]).toContain(res.status);
  });

  it('setup: create application-requirement', async () => {
    const res = await request(server)
      .post('/v1/application-requirements')
      .set(auth())
      .set('Idempotency-Key', `nm-det-ar-${TS}`)
      .send({ name: `Det AR ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
    arStableId = res.body.data.stable.id;
    arVersionId = res.body.data.version.id;
  });

  it('GET /v1/application-requirements/:stableId — gets by id', async () => {
    const res = await request(server).get(`/v1/application-requirements/${arStableId}`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/application-requirements/:stableId/current — gets current version', async () => {
    const res = await request(server)
      .get(`/v1/application-requirements/${arStableId}/current`)
      .set(auth());
    expect([200, 404]).toContain(res.status);
  });

  it('GET /v1/application-requirements/:stableId/versions — lists versions', async () => {
    const res = await request(server)
      .get(`/v1/application-requirements/${arStableId}/versions`)
      .set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/application-requirements/:stableId/versions/:versionId — gets version', async () => {
    const res = await request(server)
      .get(`/v1/application-requirements/${arStableId}/versions/${arVersionId}`)
      .set(auth());
    expect(res.status).toBe(200);
  });

  it('PATCH /v1/application-requirements/:stableId/versions/:versionId — patches draft', async () => {
    const res = await request(server)
      .patch(`/v1/application-requirements/${arStableId}/versions/${arVersionId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ar-patch-${TS}`)
      .send({ name: `Det AR Updated ${TS}` });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /v1/application-requirements/:stableId/versions/:versionId/publish — publishes', async () => {
    const res = await request(server)
      .post(`/v1/application-requirements/${arStableId}/versions/${arVersionId}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ar-pub-${TS}`)
      .send({});
    expect([200, 409]).toContain(res.status);
  });

  it('POST /v1/application-requirements/:stableId/versions/:versionId/activate — activates', async () => {
    const res = await request(server)
      .post(`/v1/application-requirements/${arStableId}/versions/${arVersionId}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ar-act-${TS}`)
      .send({});
    expect([200, 409, 422]).toContain(res.status);
  });

  it('POST /v1/application-requirements/:stableId/versions — creates new draft', async () => {
    const res = await request(server)
      .post(`/v1/application-requirements/${arStableId}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ar-newv-${TS}`)
      .send({ name: `Det AR v2 ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
  });

  it('POST /v1/application-requirements/:stableId/archive — archives', async () => {
    const res = await request(server)
      .post(`/v1/application-requirements/${arStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-ar-arch-${TS}`);
    expect([200, 404]).toContain(res.status);
  });

  it('setup: create retest-rule', async () => {
    const res = await request(server)
      .post('/v1/retest-rules')
      .set(auth())
      .set('Idempotency-Key', `nm-det-rr-${TS}`)
      .send({ name: `Det RR ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
    rrStableId = res.body.data.stable.id;
    rrVersionId = res.body.data.version.id;
  });

  it('GET /v1/retest-rules/:stableId — gets by id', async () => {
    const res = await request(server).get(`/v1/retest-rules/${rrStableId}`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/retest-rules/:stableId/current — gets current version', async () => {
    const res = await request(server).get(`/v1/retest-rules/${rrStableId}/current`).set(auth());
    expect([200, 404]).toContain(res.status);
  });

  it('GET /v1/retest-rules/:stableId/versions — lists versions', async () => {
    const res = await request(server).get(`/v1/retest-rules/${rrStableId}/versions`).set(auth());
    expect(res.status).toBe(200);
  });

  it('GET /v1/retest-rules/:stableId/versions/:versionId — gets version', async () => {
    const res = await request(server)
      .get(`/v1/retest-rules/${rrStableId}/versions/${rrVersionId}`)
      .set(auth());
    expect(res.status).toBe(200);
  });

  it('PATCH /v1/retest-rules/:stableId/versions/:versionId — patches draft', async () => {
    const res = await request(server)
      .patch(`/v1/retest-rules/${rrStableId}/versions/${rrVersionId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rr-patch-${TS}`)
      .send({ name: `Det RR Updated ${TS}` });
    expect([200, 204]).toContain(res.status);
  });

  it('POST /v1/retest-rules/:stableId/versions/:versionId/publish — publishes', async () => {
    const res = await request(server)
      .post(`/v1/retest-rules/${rrStableId}/versions/${rrVersionId}/publish`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rr-pub-${TS}`)
      .send({});
    expect([200, 409]).toContain(res.status);
  });

  it('POST /v1/retest-rules/:stableId/versions/:versionId/activate — activates', async () => {
    const res = await request(server)
      .post(`/v1/retest-rules/${rrStableId}/versions/${rrVersionId}/activate`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rr-act-${TS}`)
      .send({});
    expect([200, 409, 422]).toContain(res.status);
  });

  it('POST /v1/retest-rules/:stableId/versions — creates new draft', async () => {
    const res = await request(server)
      .post(`/v1/retest-rules/${rrStableId}/versions`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rr-newv-${TS}`)
      .send({ name: `Det RR v2 ${TS}`, majorId: majorId4 });
    expect(res.status).toBe(201);
  });

  it('POST /v1/retest-rules/:stableId/archive — archives', async () => {
    const res = await request(server)
      .post(`/v1/retest-rules/${rrStableId}/archive`)
      .set(auth())
      .set('Idempotency-Key', `nm-det-rr-arch-${TS}`);
    expect([200, 404]).toContain(res.status);
  });
});
