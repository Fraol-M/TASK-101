import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for account management endpoints.
 * Covers: GET /:id, POST /, PATCH /:id/status.
 * GET /me is covered by rbac.route-guards.spec.js.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3042, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/accounts/account.service.js', () => ({
  accountService: {
    getById: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { accountService } from '../../src/modules/accounts/account.service.js';
import { NotFoundError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const SYSTEM_ADMIN = { id: 'sa-1', username: 'sysadmin', roles: ['SYSTEM_ADMIN'] };
const REVIEWER     = { id: 'rv-1', username: 'reviewer', roles: ['REVIEWER'] };
const ACCOUNT_ID   = '00000000-0000-0000-0000-000000000060';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

// ── GET /v1/accounts/me ───────────────────────────────────────────────────────

describe('GET /v1/accounts/me', () => {
  it('returns 200 with authenticated user profile', async () => {
    asUser(SYSTEM_ADMIN);
    accountService.getById.mockResolvedValueOnce({
      id: SYSTEM_ADMIN.id, username: 'sysadmin', status: 'active',
    });

    const res = await request(server)
      .get('/v1/accounts/me')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('sysadmin');
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/accounts/me');
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/accounts/:id ─────────────────────────────────────────────────────

describe('GET /v1/accounts/:id', () => {
  it('returns 200 with account for admin', async () => {
    asUser(SYSTEM_ADMIN);
    accountService.getById.mockResolvedValueOnce({
      id: ACCOUNT_ID, username: 'testuser', status: 'active',
    });

    const res = await request(server)
      .get(`/v1/accounts/${ACCOUNT_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(ACCOUNT_ID);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 404 when account not found', async () => {
    asUser(SYSTEM_ADMIN);
    accountService.getById.mockRejectedValueOnce(new NotFoundError('Account not found'));

    const res = await request(server)
      .get(`/v1/accounts/${ACCOUNT_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(404);
  });

  it('returns 403 without accounts:admin:manage permission', async () => {
    asUser(REVIEWER, false);

    const res = await request(server)
      .get(`/v1/accounts/${ACCOUNT_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/accounts/${ACCOUNT_ID}`);
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/accounts ────────────────────────────────────────────────────────

describe('POST /v1/accounts', () => {
  it('returns 201 with created account', async () => {
    asUser(SYSTEM_ADMIN);
    accountService.create.mockResolvedValueOnce({
      id: ACCOUNT_ID, username: 'newuser', status: 'active',
    });

    const res = await request(server)
      .post('/v1/accounts')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'acct-create-1')
      .send({ username: 'newuser', password: 'Secur3P@ssword!!' });

    expect(res.status).toBe(201);
    expect(res.body.data.username).toBe('newuser');
  });

  it('returns 400 when username is too short', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post('/v1/accounts')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'acct-create-2')
      .send({ username: 'ab', password: 'Secur3P@ssword!!' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when password is too short', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post('/v1/accounts')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'acct-create-3')
      .send({ username: 'newuser', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .post('/v1/accounts')
      .send({ username: 'newuser', password: 'Secur3P@ssword!!' });
    expect(res.status).toBe(401);
  });
});

// ── PATCH /v1/accounts/:id/status ────────────────────────────────────────────

describe('PATCH /v1/accounts/:id/status', () => {
  it('returns 200 with updated status', async () => {
    asUser(SYSTEM_ADMIN);
    accountService.updateStatus.mockResolvedValueOnce({
      id: ACCOUNT_ID, username: 'testuser', status: 'suspended',
    });

    const res = await request(server)
      .patch(`/v1/accounts/${ACCOUNT_ID}/status`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'acct-status-1')
      .send({ status: 'suspended' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');
  });

  it('returns 400 for invalid status value', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .patch(`/v1/accounts/${ACCOUNT_ID}/status`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'acct-status-2')
      .send({ status: 'deleted' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .patch(`/v1/accounts/${ACCOUNT_ID}/status`)
      .send({ status: 'active' });
    expect(res.status).toBe(401);
  });

  it('returns 403 without admin permission', async () => {
    asUser(REVIEWER, false);

    const res = await request(server)
      .patch(`/v1/accounts/${ACCOUNT_ID}/status`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'acct-status-3')
      .send({ status: 'active' });

    expect(res.status).toBe(403);
  });
});
