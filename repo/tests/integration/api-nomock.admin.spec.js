import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';

/**
 * True no-mock API integration tests — accounts, RBAC, admin, and metrics.
 *
 * Full HTTP stack without any mocked execution-path dependencies.
 * Requires a real PostgreSQL test database.
 */

const TS = Date.now();
const TEST_PASSWORD = 'AdminNoMock@2026!';

let knex;
let server;
let adminToken;
let adminAccountId;

const cleanup = {
  accountIds: [],
  roleIds: [],
  reviewerProfileIds: [],
};

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  await knex.seed.run();

  const hash = await bcrypt.hash(TEST_PASSWORD, 12);
  const [adminAcc] = await knex('accounts')
    .insert({ username: `nm-adm-${TS}`, password_hash: hash, status: 'active' })
    .returning('*');
  adminAccountId = adminAcc.id;
  cleanup.accountIds.push(adminAcc.id);

  const adminRole = await knex('roles').where({ name: 'SYSTEM_ADMIN' }).first();
  await knex('account_roles')
    .insert({ account_id: adminAcc.id, role_id: adminRole.id })
    .onConflict(['account_id', 'role_id']).ignore();

  const { createApp } = await import('../../src/app.js');
  server = createApp().callback();

  const loginRes = await request(server)
    .post('/v1/auth/login')
    .send({ username: `nm-adm-${TS}`, password: TEST_PASSWORD });
  adminToken = loginRes.body.data.token;
}, 60_000);

afterAll(async () => {
  for (const id of cleanup.reviewerProfileIds) {
    await knex('reviewer_institution_history').where('reviewer_id', id).delete().catch(() => {});
    await knex('reviewer_profiles').where('id', id).delete().catch(() => {});
  }
  for (const id of cleanup.roleIds) {
    await knex('role_permissions').where('role_id', id).delete().catch(() => {});
    await knex('roles').where('id', id).delete().catch(() => {});
  }
  for (const id of cleanup.accountIds) {
    await knex('sessions').where('account_id', id).delete().catch(() => {});
    await knex('idempotency_keys').where('account_id', id).delete().catch(() => {});
    await knex('audit_events').where('actor_account_id', id).delete().catch(() => {});
    await knex('account_roles').where('account_id', id).delete().catch(() => {});
    await knex('accounts').where('id', id).delete().catch(() => {});
  }
  await knex.destroy();
});

function auth() {
  return { Authorization: `Bearer ${adminToken}` };
}

// ── GET /v1/accounts/me ──────────────────────────────────────────────────────

describe('GET /v1/accounts/me — no-mock', () => {
  it('returns 200 with the authenticated admin profile', async () => {
    const res = await request(server)
      .get('/v1/accounts/me')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(adminAccountId);
    expect(res.body.data.username).toBe(`nm-adm-${TS}`);
    expect(res.body.meta.requestId).toBeDefined();
  });
});

// ── POST /v1/accounts — create account ───────────────────────────────────────

describe('POST /v1/accounts — no-mock', () => {
  let createdAccountId;

  it('returns 201 with the created account', async () => {
    const res = await request(server)
      .post('/v1/accounts')
      .set(auth())
      .set('Idempotency-Key', `nm-acct-create-${TS}`)
      .send({ username: `nm-new-${TS}`, password: 'NewAccount@2026!!' });

    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe(`nm-new-${TS}`);
    createdAccountId = res.body.data.id;
    cleanup.accountIds.push(createdAccountId);
  });

  it('GET /v1/accounts/:id — returns the created account', async () => {
    const res = await request(server)
      .get(`/v1/accounts/${createdAccountId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdAccountId);
  });

  it('PATCH /v1/accounts/:id/status — suspends the account', async () => {
    const res = await request(server)
      .patch(`/v1/accounts/${createdAccountId}/status`)
      .set(auth())
      .set('Idempotency-Key', `nm-acct-status-${TS}`)
      .send({ status: 'suspended' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');
  });
});

// ── POST /v1/auth/password/rotate — no-mock ─────────────────────────────────

describe('POST /v1/auth/password/rotate — no-mock', () => {
  let rotateToken;

  beforeAll(async () => {
    // Create a dedicated account for password rotation (avoids invalidating adminToken)
    const hash = await bcrypt.hash('OldPassword@2026!!', 12);
    const [acc] = await knex('accounts')
      .insert({ username: `nm-rotate-${TS}`, password_hash: hash, status: 'active' })
      .returning('*');
    cleanup.accountIds.push(acc.id);

    const role = await knex('roles').where({ name: 'SYSTEM_ADMIN' }).first();
    await knex('account_roles').insert({ account_id: acc.id, role_id: role.id })
      .onConflict(['account_id', 'role_id']).ignore();

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ username: `nm-rotate-${TS}`, password: 'OldPassword@2026!!' });
    rotateToken = login.body.data.token;
  });

  it('returns 200 when password is rotated', async () => {
    const res = await request(server)
      .post('/v1/auth/password/rotate')
      .set('Authorization', `Bearer ${rotateToken}`)
      .set('Idempotency-Key', `nm-pwd-rotate-${TS}`)
      .send({ currentPassword: 'OldPassword@2026!!', newPassword: 'NewPassword@2026!!' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toBeDefined();
  });
});

// ── RBAC endpoints — no-mock ─────────────────────────────────────────────────

describe('RBAC — no-mock', () => {
  let customRoleId;

  it('GET /v1/admin/roles — returns role list', async () => {
    const res = await request(server)
      .get('/v1/admin/roles')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });

  it('POST /v1/admin/roles — creates a custom role', async () => {
    const res = await request(server)
      .post('/v1/admin/roles')
      .set(auth())
      .set('Idempotency-Key', `nm-role-create-${TS}`)
      .send({ name: `TEST_ROLE_${TS}`, description: 'No-mock test role' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe(`TEST_ROLE_${TS}`);
    customRoleId = res.body.data.id;
    cleanup.roleIds.push(customRoleId);
  });

  it('PATCH /v1/admin/roles/:id — updates the custom role', async () => {
    const res = await request(server)
      .patch(`/v1/admin/roles/${customRoleId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-role-update-${TS}`)
      .send({ description: 'Updated description' });

    expect(res.status).toBe(200);
  });

  it('POST /v1/admin/accounts/:id/roles — assigns role', async () => {
    const res = await request(server)
      .post(`/v1/admin/accounts/${adminAccountId}/roles`)
      .set(auth())
      .set('Idempotency-Key', `nm-role-assign-${TS}`)
      .send({ roleName: `TEST_ROLE_${TS}` });

    expect(res.status).toBe(200);
    expect(res.body.data.assigned).toBe(true);
  });

  it('GET /v1/admin/permissions — returns permission list', async () => {
    const res = await request(server)
      .get('/v1/admin/permissions')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Admin endpoints — no-mock ────────────────────────────────────────────────

describe('Admin — no-mock', () => {
  it('GET /v1/admin/metrics — returns Prometheus metrics', async () => {
    const res = await request(server)
      .get('/v1/admin/metrics')
      .set(auth());

    expect(res.status).toBe(200);
    expect(typeof res.text).toBe('string');
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('GET /v1/admin/audit-events — returns audit event list', async () => {
    const res = await request(server)
      .get('/v1/admin/audit-events')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeDefined();
  });
});

// ── Reviewer pool — no-mock ──────────────────────────────────────────────────

describe('Reviewer pool — no-mock', () => {
  let reviewerProfileId;
  let reviewerAccountId;
  let universityId;

  beforeAll(async () => {
    // Create a university for institution-history FK
    const [uni] = await knex('universities')
      .insert({ name_normalized: `nm-uni-pool-${TS}`, created_by: adminAccountId })
      .returning('id');
    universityId = uni.id;

    // Create a dedicated reviewer account
    const hash = await bcrypt.hash('ReviewerPool@2026!', 12);
    const [acc] = await knex('accounts')
      .insert({ username: `nm-rvpool-${TS}`, password_hash: hash, status: 'active' })
      .returning('*');
    reviewerAccountId = acc.id;
    cleanup.accountIds.push(acc.id);
  });

  afterAll(async () => {
    if (reviewerProfileId) {
      await knex('reviewer_institution_history').where('reviewer_id', reviewerProfileId).delete().catch(() => {});
      await knex('reviewer_profiles').where('id', reviewerProfileId).delete().catch(() => {});
    }
    await knex('universities').where('id', universityId).delete().catch(() => {});
  });

  it('GET /v1/admin/reviewer-pool — returns list', async () => {
    const res = await request(server)
      .get('/v1/admin/reviewer-pool')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.total).toBeDefined();
  });

  it('POST /v1/admin/reviewer-pool — creates profile', async () => {
    const res = await request(server)
      .post('/v1/admin/reviewer-pool')
      .set(auth())
      .set('Idempotency-Key', `nm-rp-create-${TS}`)
      .send({ accountId: reviewerAccountId, maxLoad: 10, expertiseTags: ['ML'] });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    reviewerProfileId = res.body.data.id;
  });

  it('GET /v1/admin/reviewer-pool/:id — returns profile', async () => {
    const res = await request(server)
      .get(`/v1/admin/reviewer-pool/${reviewerProfileId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(reviewerProfileId);
  });

  it('PATCH /v1/admin/reviewer-pool/:id — updates profile', async () => {
    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${reviewerProfileId}`)
      .set(auth())
      .set('Idempotency-Key', `nm-rp-patch-${TS}`)
      .send({ maxLoad: 20, expertiseTags: ['ML', 'NLP'] });

    expect(res.status).toBe(200);
  });

  it('POST /v1/admin/reviewer-pool/:id/institution-history — adds entry', async () => {
    const res = await request(server)
      .post(`/v1/admin/reviewer-pool/${reviewerProfileId}/institution-history`)
      .set(auth())
      .set('Idempotency-Key', `nm-rp-hist-${TS}`)
      .send({ universityId, role: 'employed', startDate: '2020-01-01' });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('employed');
  });
});
