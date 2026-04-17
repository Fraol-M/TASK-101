import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for RBAC management endpoints.
 * Covers: list roles, create role, update role, assign role, list permissions.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: {
    can: vi.fn(),
    getRoles: vi.fn(),
    listRoles: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    assignRole: vi.fn(),
    listPermissions: vi.fn(),
  },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3043, nodeEnv: 'test', isProduction: false, isTest: true,
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

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { createApp } from '../../src/app.js';

const SYSTEM_ADMIN = { id: 'sa-1', username: 'sysadmin', roles: ['SYSTEM_ADMIN'] };
const ROLE_ID      = '00000000-0000-0000-0000-000000000070';
const ACCOUNT_ID   = '00000000-0000-0000-0000-000000000071';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

// ── GET /v1/admin/roles ──────────────────────────────────────────────────────

describe('GET /v1/admin/roles', () => {
  it('returns 200 with role list', async () => {
    asUser(SYSTEM_ADMIN);
    rbacService.listRoles.mockResolvedValueOnce([
      { id: ROLE_ID, name: 'SYSTEM_ADMIN', description: 'Full access' },
    ]);

    const res = await request(server)
      .get('/v1/admin/roles')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('SYSTEM_ADMIN');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/admin/roles');
    expect(res.status).toBe(401);
  });

  it('returns 403 without rbac:read permission', async () => {
    asUser(SYSTEM_ADMIN, false);

    const res = await request(server)
      .get('/v1/admin/roles')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(403);
  });
});

// ── POST /v1/admin/roles ─────────────────────────────────────────────────────

describe('POST /v1/admin/roles', () => {
  it('returns 201 with created role', async () => {
    asUser(SYSTEM_ADMIN);
    rbacService.createRole.mockResolvedValueOnce({
      id: ROLE_ID, name: 'CUSTOM_ROLE', description: 'A custom role',
    });

    const res = await request(server)
      .post('/v1/admin/roles')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'role-create-1')
      .send({ name: 'CUSTOM_ROLE', description: 'A custom role' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('CUSTOM_ROLE');
  });

  it('returns 400 when name has lowercase characters', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post('/v1/admin/roles')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'role-create-2')
      .send({ name: 'bad_role' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when name is empty', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post('/v1/admin/roles')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'role-create-3')
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .post('/v1/admin/roles')
      .send({ name: 'TEST_ROLE' });
    expect(res.status).toBe(401);
  });
});

// ── PATCH /v1/admin/roles/:id ────────────────────────────────────────────────

describe('PATCH /v1/admin/roles/:id', () => {
  it('returns 200 with updated role', async () => {
    asUser(SYSTEM_ADMIN);
    rbacService.updateRole.mockResolvedValueOnce({
      id: ROLE_ID, name: 'SYSTEM_ADMIN', description: 'Updated',
    });

    const res = await request(server)
      .patch(`/v1/admin/roles/${ROLE_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'role-update-1')
      .send({ description: 'Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .patch(`/v1/admin/roles/${ROLE_ID}`)
      .send({ description: 'x' });
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/admin/accounts/:id/roles ────────────────────────────────────────

describe('POST /v1/admin/accounts/:id/roles', () => {
  it('returns 200 with assigned: true', async () => {
    asUser(SYSTEM_ADMIN);
    rbacService.assignRole.mockResolvedValueOnce(undefined);

    const res = await request(server)
      .post(`/v1/admin/accounts/${ACCOUNT_ID}/roles`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'role-assign-1')
      .send({ roleName: 'REVIEWER' });

    expect(res.status).toBe(200);
    expect(res.body.data.assigned).toBe(true);
  });

  it('returns 400 when roleName is missing', async () => {
    asUser(SYSTEM_ADMIN);

    const res = await request(server)
      .post(`/v1/admin/accounts/${ACCOUNT_ID}/roles`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'role-assign-2')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .post(`/v1/admin/accounts/${ACCOUNT_ID}/roles`)
      .send({ roleName: 'REVIEWER' });
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/admin/permissions ────────────────────────────────────────────────

describe('GET /v1/admin/permissions', () => {
  it('returns 200 with permission list', async () => {
    asUser(SYSTEM_ADMIN);
    rbacService.listPermissions.mockResolvedValueOnce([
      { id: '1', resource: 'review', action: 'submit' },
    ]);

    const res = await request(server)
      .get('/v1/admin/permissions')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/admin/permissions');
    expect(res.status).toBe(401);
  });
});
