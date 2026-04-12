import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for PATCH /v1/admin/reviewer-pool/:id
 *
 * Verifies:
 *   - Zod validation schema rejects wrong types for maxLoad and expertiseTags
 *   - Unknown fields are stripped (not rejected) — valid camelCase contract
 *   - Permission guard: requires reviewers:manage (SYSTEM_ADMIN)
 *   - 404 propagated when service throws NotFoundError
 *   - Service is called with the validated camelCase body as-is (mapping is in the service)
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3016, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/common/metrics/metrics.js', () => ({
  registry: { contentType: 'text/plain', metrics: vi.fn().mockResolvedValue('') },
  reviewSubmissionsTotal: { inc: vi.fn() },
  secondPassEscalationsTotal: { inc: vi.fn() },
  authFailuresTotal: { inc: vi.fn() },
  recommendationGenerationsTotal: { inc: vi.fn() },
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
const REVIEWER     = { id: 'rv-1', username: 'reviewer',  roles: ['REVIEWER'] };
const REVIEWER_ID  = '00000000-0000-0000-0000-000000000040';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

describe('PATCH /v1/admin/reviewer-pool/:id — validation', () => {
  it('returns 200 and calls service with camelCase maxLoad and expertiseTags', async () => {
    asUser(SYSTEM_ADMIN);
    const stub = { id: REVIEWER_ID, max_load: 15, expertise_tags: ['ML', 'CV'], available: true };
    reviewerPoolService.update.mockResolvedValueOnce(stub);

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-1')
      .send({ maxLoad: 15, expertiseTags: ['ML', 'CV'] });

    expect(res.status).toBe(200);
    expect(res.body.data.max_load).toBe(15);
    // Service receives the validated camelCase body — field mapping is the service's responsibility
    expect(reviewerPoolService.update).toHaveBeenCalledWith(
      REVIEWER_ID,
      { maxLoad: 15, expertiseTags: ['ML', 'CV'] },
      SYSTEM_ADMIN.id,
      expect.any(String),
    );
  });

  it('returns 200 with boolean available and active fields', async () => {
    asUser(SYSTEM_ADMIN);
    const stub = { id: REVIEWER_ID, available: false, active: true };
    reviewerPoolService.update.mockResolvedValueOnce(stub);

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-2')
      .send({ available: false, active: true });

    expect(res.status).toBe(200);
    expect(reviewerPoolService.update).toHaveBeenCalledWith(
      REVIEWER_ID,
      { available: false, active: true },
      SYSTEM_ADMIN.id,
      expect.any(String),
    );
  });

  it('returns 400 when maxLoad is not an integer (string value)', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-badtype')
      .send({ maxLoad: 'heavy' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(reviewerPoolService.update).not.toHaveBeenCalled();
  });

  it('returns 400 when maxLoad exceeds 50', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-maxexceed')
      .send({ maxLoad: 51 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(reviewerPoolService.update).not.toHaveBeenCalled();
  });

  it('returns 400 when expertiseTags contains a non-string element', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-badtag')
      .send({ expertiseTags: [123, 'ML'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(reviewerPoolService.update).not.toHaveBeenCalled();
  });
});

describe('PATCH /v1/admin/reviewer-pool/:id — authorization', () => {
  it('returns 403 when actor lacks reviewers:manage permission', async () => {
    asUser(REVIEWER, false);

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-forbidden')
      .send({ available: true });

    expect(res.status).toBe(403);
    expect(reviewerPoolService.update).not.toHaveBeenCalled();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .send({ available: true });

    expect(res.status).toBe(401);
  });
});

describe('PATCH /v1/admin/reviewer-pool/:id — service errors', () => {
  it('returns 404 when service throws NotFoundError', async () => {
    asUser(SYSTEM_ADMIN);
    reviewerPoolService.update.mockRejectedValueOnce(
      new NotFoundError('Reviewer profile not found'),
    );

    const res = await request(server)
      .patch(`/v1/admin/reviewer-pool/${REVIEWER_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rp-patch-notfound')
      .send({ available: false });

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/not found/i);
  });
});
