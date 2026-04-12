import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

/**
 * API tests for authentication endpoints.
 * These use a Supertest wrapper around the actual Koa app.
 * Integration tests that require a real DB are in tests/integration/.
 * These API tests mock the service layer.
 */

vi.mock('../../src/modules/auth/auth.service.js', () => ({
  authService: {
    login: vi.fn(),
    logout: vi.fn(),
    rotatePassword: vi.fn(),
  },
}));

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: {
    validateAndRotate: vi.fn(),
    create: vi.fn(),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: {
    can: vi.fn().mockResolvedValue(true),
    getRoles: vi.fn().mockResolvedValue(['REVIEWER']),
  },
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: {
    record: vi.fn().mockResolvedValue(undefined),
    query: vi.fn(),
  },
}));

vi.mock('../../src/common/idempotency/idempotency.repository.js', () => ({
  idempotencyRepository: {
    reserve: vi.fn().mockResolvedValue(true),
    findByAccountAndKey: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue(undefined),
    deletePending: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3001,
    nodeEnv: 'test',
    isProduction: false,
    isTest: true,
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    attachments: { storageRoot: '/tmp', maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    personalization: { historyRetentionDays: 180 },
    search: { defaultLanguage: 'english' },
    logLevel: 'error',
  },
}));

import { authService } from '../../src/modules/auth/auth.service.js';
import { sessionService } from '../../src/modules/auth/session.service.js';
import { createApp } from '../../src/app.js';

let app;
let server;

beforeAll(() => {
  app = createApp();
  server = app.callback();
});

describe('POST /v1/auth/login', () => {
  it('returns 200 and token on valid credentials', async () => {
    authService.login.mockResolvedValueOnce({ token: 'abc123', accountId: 'user-1' });

    const res = await request(server)
      .post('/v1/auth/login')
      .send({ username: 'admin', password: 'ValidPass@123' });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBe('abc123');
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 400 on missing username', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ password: 'ValidPass@123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 on missing password', async () => {
    const res = await request(server)
      .post('/v1/auth/login')
      .send({ username: 'admin' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 on invalid credentials', async () => {
    const { AuthenticationError } = await import('../../src/common/errors/AppError.js');
    authService.login.mockRejectedValueOnce(new AuthenticationError('Invalid username or password'));

    const res = await request(server)
      .post('/v1/auth/login')
      .send({ username: 'admin', password: 'WrongPass@123' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

describe('POST /v1/auth/logout', () => {
  it('returns 401 without Authorization header', async () => {
    const res = await request(server).post('/v1/auth/logout');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid session', async () => {
    sessionService.validateAndRotate.mockResolvedValueOnce({
      user: { id: 'user-1', username: 'admin', roles: ['SYSTEM_ADMIN'] },
      newToken: null,
    });
    authService.logout.mockResolvedValueOnce(undefined);

    const res = await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', 'Bearer validtoken123')
      .set('Idempotency-Key', 'logout-1');

    expect(res.status).toBe(200);
  });
});

describe('POST /v1/auth/password/rotate', () => {
  it('returns 400 if newPassword is too short', async () => {
    sessionService.validateAndRotate.mockResolvedValue({
      user: { id: 'user-1', username: 'admin', roles: ['REVIEWER'] },
      newToken: null,
    });

    const res = await request(server)
      .post('/v1/auth/password/rotate')
      .set('Authorization', 'Bearer valid')
      .send({ currentPassword: 'OldPass@123', newPassword: 'short' });

    expect(res.status).toBe(400);
  });
});
