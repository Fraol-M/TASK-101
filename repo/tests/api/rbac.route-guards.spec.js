import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * Tests for route-level RBAC enforcement.
 * Verifies that:
 * - Unauthenticated requests return 401
 * - Authenticated but unauthorised requests return 403
 * - Admin-only routes block non-admin users
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: {
    validateAndRotate: vi.fn(),
  },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: {
    can: vi.fn(),
    getRoles: vi.fn(),
  },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3002, nodeEnv: 'test', isProduction: false, isTest: true,
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    attachments: { storageRoot: '/tmp', maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    personalization: { historyRetentionDays: 180 },
    search: { defaultLanguage: 'english' },
    logLevel: 'error',
  },
}));

// Prevent audit service DB calls
vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn(), query: vi.fn().mockResolvedValue({ events: [], total: 0 }) },
}));

// Prevent idempotency DB calls
vi.mock('../../src/common/idempotency/idempotency.repository.js', () => ({
  idempotencyRepository: {
    reserve: vi.fn().mockResolvedValue(true),
    findByAccountAndKey: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue(undefined),
    deletePending: vi.fn().mockResolvedValue(undefined),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { AuthenticationError, AuthorizationError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

let server;

beforeAll(() => {
  const app = createApp();
  server = app.callback();
});

describe('Unauthenticated requests → 401', () => {
  it('GET /v1/accounts/me returns 401 without token', async () => {
    sessionService.validateAndRotate.mockRejectedValue(
      new AuthenticationError('Missing or malformed Authorization header'),
    );
    const res = await request(server).get('/v1/accounts/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('GET /v1/admin/metrics returns 401 without token', async () => {
    sessionService.validateAndRotate.mockRejectedValue(new AuthenticationError());
    const res = await request(server).get('/v1/admin/metrics');
    expect(res.status).toBe(401);
  });
});

describe('Authenticated but unauthorised → 403', () => {
  beforeEach(() => {
    // User is authenticated
    sessionService.validateAndRotate.mockResolvedValue({
      user: { id: 'user-1', username: 'reviewer1', roles: ['REVIEWER'] },
      newToken: null,
    });
  });

  it('GET /v1/admin/metrics returns 403 for REVIEWER role', async () => {
    // REVIEWER does not have metrics:read
    rbacService.can.mockResolvedValue(false);

    const res = await request(server)
      .get('/v1/admin/metrics')
      .set('Authorization', 'Bearer sometoken');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTHORIZATION_ERROR');
  });

  it('POST /v1/accounts returns 403 for REVIEWER role', async () => {
    rbacService.can.mockResolvedValue(false);

    const res = await request(server)
      .post('/v1/accounts')
      .set('Authorization', 'Bearer sometoken')
      .set('Idempotency-Key', 'rbac-test-key-1')
      .send({ username: 'newuser', password: 'ValidPass@123' });

    expect(res.status).toBe(403);
  });
});

describe('Admin-only routes — accessible for SYSTEM_ADMIN', () => {
  it('GET /v1/admin/audit-events returns 200 for SYSTEM_ADMIN', async () => {
    sessionService.validateAndRotate.mockResolvedValue({
      user: { id: 'admin-1', username: 'admin', roles: ['SYSTEM_ADMIN'] },
      newToken: null,
    });
    rbacService.can.mockResolvedValue(true);

    const res = await request(server)
      .get('/v1/admin/audit-events')
      .set('Authorization', 'Bearer admintoken');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});

