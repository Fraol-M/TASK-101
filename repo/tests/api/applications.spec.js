import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for the application submission endpoints.
 * Covers: create (201/400/401/403), list (200/401), get-by-id (200/403/404).
 *
 * Exercises the HTTP layer — route registration, Zod schema validation, RBAC guards,
 * and response envelope format.  Domain logic (transaction atomicity, ownership
 * enforcement) is covered by tests/integration/applications.submission.spec.js.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3015, nodeEnv: 'test', isProduction: false, isTest: true,
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
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/common/idempotency/idempotency.repository.js', () => ({
  idempotencyRepository: {
    reserve: vi.fn().mockResolvedValue(true),
    findByAccountAndKey: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue(undefined),
    deletePending: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/modules/applications/application.service.js', () => ({
  applicationService: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { applicationService } from '../../src/modules/applications/application.service.js';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
} from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const APPLICANT      = { id: 'app-1',   username: 'applicant1', roles: ['APPLICANT'] };
const PROGRAM_ADMIN  = { id: 'admin-1', username: 'admin',      roles: ['PROGRAM_ADMIN'] };

const CYCLE_ID  = '00000000-0000-0000-0000-000000000050';
const MAJOR_ID  = '00000000-0000-0000-0000-000000000051';
const APP_ID    = '00000000-0000-0000-0000-000000000052';
const UNIV_ID   = '00000000-0000-0000-0000-000000000053';

const VALID_BODY = {
  cycleId: CYCLE_ID,
  programChoices: [{ majorId: MAJOR_ID, preferenceOrder: 1 }],
};

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

// ── POST /v1/applications ─────────────────────────────────────────────────────

describe('POST /v1/applications', () => {
  it('returns 201 with created application for APPLICANT', async () => {
    asUser(APPLICANT);
    const stub = { id: APP_ID, cycle_id: CYCLE_ID, account_id: APPLICANT.id, status: 'submitted' };
    applicationService.create.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-1')
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(APP_ID);
    expect(res.body.data.status).toBe('submitted');
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 400 when cycleId is missing', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-2')
      .send({ programChoices: [{ majorId: MAJOR_ID, preferenceOrder: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when cycleId is not a valid UUID', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-3')
      .send({ cycleId: 'not-a-uuid', programChoices: [{ majorId: MAJOR_ID, preferenceOrder: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when programChoices is empty (min 1)', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-4')
      .send({ cycleId: CYCLE_ID, programChoices: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a programChoice has a majorId that is not a UUID', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-5')
      .send({ cycleId: CYCLE_ID, programChoices: [{ majorId: 'bad', preferenceOrder: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when institutionHistory entry has an invalid role', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-6')
      .send({
        ...VALID_BODY,
        institutionHistory: [
          { universityId: UNIV_ID, role: 'invalid-role', startDate: '2020-09-01' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for authenticated write without Idempotency-Key', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).post('/v1/applications').send(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a user without applications:write permission', async () => {
    asUser(APPLICANT, false); // rbacService.can returns false

    const res = await request(server)
      .post('/v1/applications')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'app-create-7')
      .send(VALID_BODY);

    expect(res.status).toBe(403);
  });
});

// ── GET /v1/applications ──────────────────────────────────────────────────────

describe('GET /v1/applications', () => {
  it('returns 200 with paginated list for APPLICANT', async () => {
    asUser(APPLICANT);
    applicationService.list.mockResolvedValueOnce({
      rows: [{ id: APP_ID, cycle_id: CYCLE_ID, status: 'submitted' }],
      total: 1,
    });

    const res = await request(server)
      .get('/v1/applications')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 200 with all applications for PROGRAM_ADMIN', async () => {
    asUser(PROGRAM_ADMIN);
    applicationService.list.mockResolvedValueOnce({
      rows: [{ id: APP_ID }, { id: '00000000-0000-0000-0000-000000000099' }],
      total: 2,
    });

    const res = await request(server)
      .get('/v1/applications')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/applications');
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/applications/:id ──────────────────────────────────────────────────

describe('GET /v1/applications/:id', () => {
  it('returns 200 with application for the owning applicant', async () => {
    asUser(APPLICANT);
    applicationService.getById.mockResolvedValueOnce({
      id: APP_ID,
      cycle_id: CYCLE_ID,
      account_id: APPLICANT.id,
      status: 'submitted',
    });

    const res = await request(server)
      .get(`/v1/applications/${APP_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(APP_ID);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 403 when applicant requests another applicant\'s application', async () => {
    asUser(APPLICANT);
    applicationService.getById.mockRejectedValueOnce(
      new AuthorizationError('Access denied'),
    );

    const res = await request(server)
      .get(`/v1/applications/${APP_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown application ID', async () => {
    asUser(APPLICANT);
    applicationService.getById.mockRejectedValueOnce(new NotFoundError('Application not found'));

    const res = await request(server)
      .get(`/v1/applications/${APP_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(404);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/applications/${APP_ID}`);
    expect(res.status).toBe(401);
  });
});
