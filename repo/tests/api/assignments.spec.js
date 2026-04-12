import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for assignment endpoints.
 * Covers: create, batch, list, get-by-id, and RBAC enforcement.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3010, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/reviews/assignments/assignment.service.js', () => ({
  assignmentService: {
    create: vi.fn(),
    batchAssign: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { assignmentService } from '../../src/modules/reviews/assignments/assignment.service.js';
import { AuthenticationError, AuthorizationError, NotFoundError, UnprocessableError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const PROGRAM_ADMIN = { id: 'admin-1', username: 'admin', roles: ['PROGRAM_ADMIN'] };
const REVIEWER      = { id: 'rev-1',   username: 'rev1',  roles: ['REVIEWER'] };
const APP_ID    = '00000000-0000-0000-0000-000000000001';
const REV_ID    = '00000000-0000-0000-0000-000000000002';
const CYCLE_ID  = '00000000-0000-0000-0000-000000000003';
const ASSIGN_ID = '00000000-0000-0000-0000-000000000004';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(true);
}

describe('POST /v1/assignments', () => {
  it('returns 201 with assignment on valid request', async () => {
    asUser(PROGRAM_ADMIN);
    const stub = { id: ASSIGN_ID, application_id: APP_ID, reviewer_id: REV_ID };
    assignmentService.create.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/assignments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'assign-create-1')
      .send({ applicationId: APP_ID, reviewerId: REV_ID, cycleId: CYCLE_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(ASSIGN_ID);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 400 on missing required fields', async () => {
    asUser(PROGRAM_ADMIN);

    const res = await request(server)
      .post('/v1/assignments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'assign-create-2')
      .send({ reviewerId: REV_ID }); // missing applicationId and cycleId

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).post('/v1/assignments').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 for authenticated write without Idempotency-Key', async () => {
    asUser(PROGRAM_ADMIN);

    const res = await request(server)
      .post('/v1/assignments')
      .set('Authorization', 'Bearer token')
      .send({ applicationId: APP_ID, reviewerId: REV_ID, cycleId: CYCLE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('returns 422 when service detects a conflict of interest', async () => {
    asUser(PROGRAM_ADMIN);
    assignmentService.create.mockRejectedValueOnce(
      new UnprocessableError('Assignment blocked due to conflict of interest', [
        { field: 'reviewer', issue: 'Reviewer affiliated with university (employed)' },
      ]),
    );

    const res = await request(server)
      .post('/v1/assignments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'assign-coi-1')
      .send({ applicationId: APP_ID, reviewerId: REV_ID, cycleId: CYCLE_ID });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UNPROCESSABLE');
    expect(res.body.error.details).toHaveLength(1);
    expect(res.body.error.details[0].field).toBe('reviewer');
  });
});

describe('POST /v1/assignments/batch', () => {
  it('returns 201 with created assignments array', async () => {
    asUser(PROGRAM_ADMIN);
    assignmentService.batchAssign.mockResolvedValueOnce({ created: [{ id: ASSIGN_ID }], errors: [] });

    const res = await request(server)
      .post('/v1/assignments/batch')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'batch-1')
      .send({ applicationIds: [APP_ID], cycleId: CYCLE_ID, mode: 'random' });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 403 for REVIEWER role', async () => {
    asUser(REVIEWER);
    rbacService.can.mockResolvedValueOnce(false);

    const res = await request(server)
      .post('/v1/assignments/batch')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'batch-2')
      .send({ applicationIds: [APP_ID], cycleId: CYCLE_ID });

    expect(res.status).toBe(403);
  });

  it('returns 201 and includes errors array when some applications could not be assigned', async () => {
    asUser(PROGRAM_ADMIN);
    const UNASSIGNABLE_ID = '00000000-0000-0000-0000-000000000099';
    assignmentService.batchAssign.mockResolvedValueOnce({
      created: [{ id: ASSIGN_ID, application_id: APP_ID }],
      errors: [{ applicationId: UNASSIGNABLE_ID, issue: 'Insufficient eligible reviewers after COI filtering' }],
    });

    const res = await request(server)
      .post('/v1/assignments/batch')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'batch-3')
      .send({ applicationIds: [APP_ID, UNASSIGNABLE_ID], cycleId: CYCLE_ID, mode: 'random' });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.errors).toHaveLength(1);
    expect(res.body.meta.errors[0].applicationId).toBe(UNASSIGNABLE_ID);
  });

  it('returns 400 for authenticated write without Idempotency-Key', async () => {
    asUser(PROGRAM_ADMIN);

    const res = await request(server)
      .post('/v1/assignments/batch')
      .set('Authorization', 'Bearer token')
      .send({ applicationIds: [APP_ID], cycleId: CYCLE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
});

describe('GET /v1/assignments', () => {
  it('returns 200 with paginated list', async () => {
    asUser(REVIEWER);
    assignmentService.list.mockResolvedValueOnce({ rows: [{ id: ASSIGN_ID }], total: 1 });

    const res = await request(server)
      .get('/v1/assignments')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('GET /v1/assignments/:id', () => {
  it('returns 200 for own assignment', async () => {
    asUser(REVIEWER);
    assignmentService.getById.mockResolvedValueOnce({ id: ASSIGN_ID, reviewer_id: REV_ID });

    const res = await request(server)
      .get(`/v1/assignments/${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ASSIGN_ID);
  });

  it('returns 403 when service throws AuthorizationError (different reviewer)', async () => {
    asUser(REVIEWER);
    assignmentService.getById.mockRejectedValueOnce(
      new AuthorizationError('Access to this assignment is not permitted'),
    );

    const res = await request(server)
      .get(`/v1/assignments/${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown assignment', async () => {
    asUser(REVIEWER);
    assignmentService.getById.mockRejectedValueOnce(new NotFoundError('Assignment not found'));

    const res = await request(server)
      .get(`/v1/assignments/${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(404);
  });
});
