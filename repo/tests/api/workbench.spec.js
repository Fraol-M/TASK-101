import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for reviewer workbench endpoints.
 * Covers: list pending assignments (GET /v1/workbench),
 *         blind-projected assignment view (GET /v1/workbench/:assignmentId).
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3041, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/reviews/workbench/workbench.service.js', () => ({
  workbenchService: {
    listMyAssignments: vi.fn(),
    getWorkbench: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { workbenchService } from '../../src/modules/reviews/workbench/workbench.service.js';
import { NotFoundError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const REVIEWER    = { id: 'rev-1', username: 'reviewer1', roles: ['REVIEWER'] };
const ASSIGN_ID   = '00000000-0000-0000-0000-000000000030';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

// ── GET /v1/workbench ────────────────────────────────────────────────────────

describe('GET /v1/workbench', () => {
  it('returns 200 with reviewer pending assignments', async () => {
    asUser(REVIEWER);
    workbenchService.listMyAssignments.mockResolvedValueOnce({
      rows: [{ id: ASSIGN_ID, status: 'assigned', blind_mode: 'blind' }],
      total: 1,
    });

    const res = await request(server)
      .get('/v1/workbench')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/workbench');
    expect(res.status).toBe(401);
  });

  it('returns 403 without review:read-assigned permission', async () => {
    asUser(REVIEWER, false);

    const res = await request(server)
      .get('/v1/workbench')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });
});

// ── GET /v1/workbench/:assignmentId ──────────────────────────────────────────

describe('GET /v1/workbench/:assignmentId', () => {
  it('returns 200 with blind-projected assignment view', async () => {
    asUser(REVIEWER);
    workbenchService.getWorkbench.mockResolvedValueOnce({
      id: ASSIGN_ID, status: 'assigned', blind_mode: 'blind',
    });

    const res = await request(server)
      .get(`/v1/workbench/${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ASSIGN_ID);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 404 when assignment not found', async () => {
    asUser(REVIEWER);
    workbenchService.getWorkbench.mockRejectedValueOnce(
      new NotFoundError('Assignment not found'),
    );

    const res = await request(server)
      .get(`/v1/workbench/${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(404);
  });

  it('returns 400 when assignmentId is not a UUID', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .get('/v1/workbench/not-a-uuid')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/workbench/${ASSIGN_ID}`);
    expect(res.status).toBe(401);
  });
});
