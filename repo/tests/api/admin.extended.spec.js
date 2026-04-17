import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for admin reviewer-pool endpoints not covered by admin.reviewer-pool.spec.js.
 * Covers: list (GET), get by ID (GET /:id), create (POST), institution-history (POST /:id/institution-history).
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3044, nodeEnv: 'test', isProduction: false, isTest: true,
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    attachments: { storageRoot: '/tmp', maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    personalization: { historyRetentionDays: 180 },
    search: { defaultLanguage: 'english' },
    logLevel: 'error',
  },
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined), query: vi.fn() },
}));

vi.mock('../../src/common/idempotency/idempotency.repository.js', () => ({
  idempotencyRepository: {
    reserve: vi.fn().mockResolvedValue(true),
    findByAccountAndKey: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue(undefined),
    deletePending: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/modules/admin/reviewer-pool/reviewer-pool.service.js', () => ({
  reviewerPoolService: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    addInstitutionHistory: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { reviewerPoolService } from '../../src/modules/admin/reviewer-pool/reviewer-pool.service.js';
import { NotFoundError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const SYSTEM_ADMIN = { id: 'sa-1', username: 'sysadmin', roles: ['SYSTEM_ADMIN'] };
const REVIEWER     = { id: 'rv-1', username: 'reviewer', roles: ['REVIEWER'] };
const REVIEWER_ID  = '00000000-0000-0000-0000-000000000040';
const ACCOUNT_ID   = '00000000-0000-0000-0000-000000000041';
const UNIV_ID      = '00000000-0000-0000-0000-000000000042';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

// ── GET /v1/admin/metrics ─────────────────────────────────────────────────────

describe('GET /v1/admin/metrics', () => {
  it('returns 200 with Prometheus metrics text', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .get('/v1/admin/metrics')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(typeof res.text).toBe('string');
    expect(res.text.length).toBeGreaterThan(0);
  });

  it('returns 403 without metrics:read permission', async () => {
    asUser(REVIEWER, false);

    const res = await request(server)
      .get('/v1/admin/metrics')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });
});

// ── GET /v1/admin/reviewer-pool ──────────────────────────────────────────────

describe('GET /v1/admin/reviewer-pool', () => {
  it('returns 200 with paginated list', async () => {
    asUser(SYSTEM_ADMIN);
    reviewerPoolService.list.mockResolvedValueOnce({
      rows: [{ id: REVIEWER_ID, max_load: 10, available: true }],
      total: 1,
    });

    const res = await request(server)
      .get('/v1/admin/reviewer-pool')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/admin/reviewer-pool');
    expect(res.status).toBe(401);
  });

  it('returns 403 without reviewers:manage permission', async () => {
    asUser(REVIEWER, false);

    const res = await request(server)
      .get('/v1/admin/reviewer-pool')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });
});

// ── GET /v1/admin/reviewer-pool/:id ──────────────────────────────────────────

describe('GET /v1/admin/reviewer-pool/:id', () => {
  it('returns 200 with reviewer profile', async () => {
    asUser(SYSTEM_ADMIN);
    reviewerPoolService.getById.mockResolvedValueOnce({
      id: REVIEWER_ID, max_load: 10, available: true, expertise_tags: ['ML'],
    });

    const res = await request(server)
      .get(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(REVIEWER_ID);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 404 when reviewer not found', async () => {
    asUser(SYSTEM_ADMIN);
    reviewerPoolService.getById.mockRejectedValueOnce(
      new NotFoundError('Reviewer not found'),
    );

    const res = await request(server)
      .get(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(404);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/admin/reviewer-pool/${REVIEWER_ID}`);
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/admin/reviewer-pool ─────────────────────────────────────────────

describe('POST /v1/admin/reviewer-pool', () => {
  it('returns 201 with created reviewer profile', async () => {
    asUser(SYSTEM_ADMIN);
    reviewerPoolService.create.mockResolvedValueOnce({
      id: REVIEWER_ID, account_id: ACCOUNT_ID, max_load: 20, available: true,
    });

    const res = await request(server)
      .post('/v1/admin/reviewer-pool')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-create-1')
      .send({ accountId: ACCOUNT_ID, maxLoad: 20, expertiseTags: ['ML', 'NLP'] });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(REVIEWER_ID);
  });

  it('returns 400 when accountId is not a UUID', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post('/v1/admin/reviewer-pool')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-create-2')
      .send({ accountId: 'not-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when maxLoad exceeds 50', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post('/v1/admin/reviewer-pool')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-create-3')
      .send({ accountId: ACCOUNT_ID, maxLoad: 51 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .post('/v1/admin/reviewer-pool')
      .send({ accountId: ACCOUNT_ID });
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/admin/reviewer-pool/:id/institution-history ─────────────────────

describe('POST /v1/admin/reviewer-pool/:id/institution-history', () => {
  it('returns 201 with created institution history entry', async () => {
    asUser(SYSTEM_ADMIN);
    reviewerPoolService.addInstitutionHistory.mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000099',
      reviewer_id: REVIEWER_ID,
      university_id: UNIV_ID,
      role: 'employed',
      start_date: '2020-01-01',
    });

    const res = await request(server)
      .post(`/v1/admin/reviewer-pool/${REVIEWER_ID}/institution-history`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-hist-1')
      .send({
        universityId: UNIV_ID,
        role: 'employed',
        startDate: '2020-01-01',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('employed');
  });

  it('returns 400 when role is invalid', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post(`/v1/admin/reviewer-pool/${REVIEWER_ID}/institution-history`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-hist-2')
      .send({
        universityId: UNIV_ID,
        role: 'invalid_role',
        startDate: '2020-01-01',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when startDate has wrong format', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post(`/v1/admin/reviewer-pool/${REVIEWER_ID}/institution-history`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-hist-3')
      .send({
        universityId: UNIV_ID,
        role: 'employed',
        startDate: '01/01/2020',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .post(`/v1/admin/reviewer-pool/${REVIEWER_ID}/institution-history`)
      .send({ universityId: UNIV_ID, role: 'employed', startDate: '2020-01-01' });
    expect(res.status).toBe(401);
  });
});
