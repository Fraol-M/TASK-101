import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for versioned university-data endpoints.
 *
 * All 8 entities (universities, schools, majors, research-tracks, enrollment-plans,
 * transfer-quotas, application-requirements, retest-rules) share the same route
 * factory. This file tests the full 11-route surface via /v1/universities and
 * verifies that all 8 entity prefixes are registered and responding.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3040, nodeEnv: 'test', isProduction: false, isTest: true,
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

// Mock the versioned service factory so all 8 entities get a shared mock service.
vi.mock('../../src/modules/university-data/_versioning/versioned.service.factory.js', () => {
  const svc = {
    create: vi.fn(),
    listCurrent: vi.fn(),
    findCurrent: vi.fn(),
    findVersionById: vi.fn(),
    findHistory: vi.fn(),
    findAtPointInTime: vi.fn(),
    createNewDraft: vi.fn(),
    updateDraft: vi.fn(),
    publish: vi.fn(),
    promoteScheduled: vi.fn(),
    archive: vi.fn(),
  };
  return {
    makeVersionedService: vi.fn(() => svc),
    _testSvc: svc,
  };
});

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { _testSvc as svc } from '../../src/modules/university-data/_versioning/versioned.service.factory.js';
import { createApp } from '../../src/app.js';

const ADMIN      = { id: 'admin-1', username: 'admin', roles: ['SYSTEM_ADMIN'] };
const STABLE_ID  = '00000000-0000-0000-0000-000000000001';
const VERSION_ID = '00000000-0000-0000-0000-000000000002';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

// ── POST /v1/universities ────────────────────────────────────────────────────

describe('POST /v1/universities', () => {
  it('returns 201 on valid create', async () => {
    asUser(ADMIN);
    svc.create.mockResolvedValueOnce({
      stable: { id: STABLE_ID, name_normalized: 'test university' },
      version: { id: VERSION_ID, version_number: 1, lifecycle_status: 'draft' },
    });

    const res = await request(server)
      .post('/v1/universities')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-create-1')
      .send({ name: 'Test University' });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    asUser(ADMIN);

    const res = await request(server)
      .post('/v1/universities')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-create-2')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .post('/v1/universities')
      .send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('returns 403 without university-data:write permission', async () => {
    asUser(ADMIN, false);

    const res = await request(server)
      .post('/v1/universities')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-create-3')
      .send({ name: 'Test' });

    expect(res.status).toBe(403);
  });
});

// ── GET /v1/universities ─────────────────────────────────────────────────────

describe('GET /v1/universities', () => {
  it('returns 200 with paginated list', async () => {
    asUser(ADMIN);
    svc.listCurrent.mockResolvedValueOnce({
      rows: [{ id: STABLE_ID, name_normalized: 'test' }],
      total: 1,
    });

    const res = await request(server)
      .get('/v1/universities')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/universities');
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/universities/:stableId ───────────────────────────────────────────

describe('GET /v1/universities/:stableId', () => {
  it('returns 200 with current version', async () => {
    asUser(ADMIN);
    svc.findCurrent.mockResolvedValueOnce({
      id: VERSION_ID, lifecycle_status: 'active', payload_json: '{}',
    });

    const res = await request(server)
      .get(`/v1/universities/${STABLE_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VERSION_ID);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/universities/${STABLE_ID}`);
    expect(res.status).toBe(401);
  });
});

// ── GET /v1/universities/:stableId/current ───────────────────────────────────

describe('GET /v1/universities/:stableId/current', () => {
  it('returns 200 as alias for GET /:stableId', async () => {
    asUser(ADMIN);
    svc.findCurrent.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'active' });

    const res = await request(server)
      .get(`/v1/universities/${STABLE_ID}/current`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VERSION_ID);
  });
});

// ── GET /v1/universities/:stableId/versions ──────────────────────────────────

describe('GET /v1/universities/:stableId/versions', () => {
  it('returns 200 with version history', async () => {
    asUser(ADMIN);
    svc.findHistory.mockResolvedValueOnce([
      { id: VERSION_ID, version_number: 1 },
    ]);

    const res = await request(server)
      .get(`/v1/universities/${STABLE_ID}/versions`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });
});

// ── GET /v1/universities/:stableId/versions/:versionId ───────────────────────

describe('GET /v1/universities/:stableId/versions/:versionId', () => {
  it('returns 200 with specific version', async () => {
    asUser(ADMIN);
    svc.findVersionById.mockResolvedValueOnce({
      id: VERSION_ID, version_number: 1, lifecycle_status: 'draft',
    });

    const res = await request(server)
      .get(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VERSION_ID);
  });
});

// ── POST /v1/universities/:stableId/versions (create new draft) ──────────────

describe('POST /v1/universities/:stableId/versions', () => {
  it('returns 201 with new draft version', async () => {
    asUser(ADMIN);
    svc.createNewDraft.mockResolvedValueOnce({
      id: VERSION_ID, version_number: 2, lifecycle_status: 'draft',
    });

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-draft-1')
      .send({ name: 'Updated University Name' });

    expect(res.status).toBe(201);
    expect(res.body.data.lifecycle_status).toBe('draft');
  });

  it('returns 400 when name is missing', async () => {
    asUser(ADMIN);

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-draft-2')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ── PATCH /v1/universities/:stableId/versions/:versionId (update draft) ──────

describe('PATCH /v1/universities/:stableId/versions/:versionId', () => {
  it('returns 200 with updated draft', async () => {
    asUser(ADMIN);
    svc.updateDraft.mockResolvedValueOnce({
      id: VERSION_ID, version_number: 1, lifecycle_status: 'draft',
    });

    const res = await request(server)
      .patch(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-patch-1')
      .send({ name: 'Patched Name' });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VERSION_ID);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .patch(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}`)
      .send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

// ── POST /v1/universities/:stableId/versions/:versionId/publish ──────────────

describe('POST /v1/universities/:stableId/versions/:versionId/publish', () => {
  it('returns 200 with published version', async () => {
    asUser(ADMIN);
    svc.publish.mockResolvedValueOnce({
      id: VERSION_ID, version_number: 1, lifecycle_status: 'active',
      effective_from: '2026-04-16',
    });

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}/publish`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-pub-1')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_status).toBe('active');
  });

  it('accepts optional effectiveFrom date', async () => {
    asUser(ADMIN);
    svc.publish.mockResolvedValueOnce({
      id: VERSION_ID, lifecycle_status: 'scheduled', effective_from: '2026-12-01',
    });

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}/publish`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-pub-2')
      .send({ effectiveFrom: '2026-12-01' });

    expect(res.status).toBe(200);
  });
});

// ── POST /v1/universities/:stableId/versions/:versionId/activate ─────────────

describe('POST /v1/universities/:stableId/versions/:versionId/activate', () => {
  it('returns 200 with promoted version', async () => {
    asUser(ADMIN);
    svc.promoteScheduled.mockResolvedValueOnce({
      id: VERSION_ID, lifecycle_status: 'active',
    });

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}/activate`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-act-1');

    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle_status).toBe('active');
  });

  it('returns 404 when version not found or not scheduled', async () => {
    asUser(ADMIN);
    svc.promoteScheduled.mockResolvedValueOnce(null);

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}/activate`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-act-2');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 422 when version is not yet due', async () => {
    asUser(ADMIN);
    const notDue = new Error('effective_from 2099-01-01 is not yet due');
    notDue.code = 'NOT_DUE';
    svc.promoteScheduled.mockRejectedValueOnce(notDue);

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/versions/${VERSION_ID}/activate`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-act-3');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VERSION_NOT_DUE');
  });
});

// ── POST /v1/universities/:stableId/archive ──────────────────────────────────

describe('POST /v1/universities/:stableId/archive', () => {
  it('returns 200 with archived: true', async () => {
    asUser(ADMIN);
    svc.archive.mockResolvedValueOnce(1);

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/archive`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-arch-1');

    expect(res.status).toBe(200);
    expect(res.body.data.archived).toBe(true);
  });

  it('returns 404 when entity not found or already archived', async () => {
    asUser(ADMIN);
    svc.archive.mockResolvedValueOnce(0);

    const res = await request(server)
      .post(`/v1/universities/${STABLE_ID}/archive`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'uni-arch-2');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ── Full 11-route coverage for all 7 non-universities entities ───────────────
// Universities is fully covered above; the remaining entities share the same
// route factory and service interface.  These tests prove every generated
// route per-entity is wired up and responds correctly.

const FK_ID = '00000000-0000-0000-0000-000000000099';

const OTHER_ENTITIES = [
  { prefix: 'schools',                  fk: { universityId: FK_ID } },
  { prefix: 'majors',                   fk: { schoolId: FK_ID } },
  { prefix: 'research-tracks',          fk: { majorId: FK_ID } },
  { prefix: 'enrollment-plans',         fk: { majorId: FK_ID } },
  { prefix: 'transfer-quotas',          fk: { majorId: FK_ID } },
  { prefix: 'application-requirements', fk: { majorId: FK_ID } },
  { prefix: 'retest-rules',             fk: { majorId: FK_ID } },
];

for (const { prefix, fk } of OTHER_ENTITIES) {
  describe(`/v1/${prefix} — all 11 versioned routes`, () => {
    const createBody = { name: `Test ${prefix}`, ...fk };

    it(`POST /v1/${prefix} returns 201 with data and meta`, async () => {
      asUser(ADMIN);
      svc.create.mockResolvedValueOnce({ stable: { id: STABLE_ID }, version: { id: VERSION_ID } });
      const res = await request(server)
        .post(`/v1/${prefix}`)
        .set('Authorization', 'Bearer token')
        .set('Idempotency-Key', `${prefix}-create`)
        .send(createBody);
      expect(res.status).toBe(201);
      expect(res.body.data.stable.id).toBe(STABLE_ID);
      expect(res.body.data.version.id).toBe(VERSION_ID);
      expect(res.body.meta.requestId).toBeDefined();
    });

    it(`GET /v1/${prefix} returns 200 with paginated list`, async () => {
      asUser(ADMIN);
      svc.listCurrent.mockResolvedValueOnce({ rows: [{ id: STABLE_ID }], total: 1 });
      const res = await request(server)
        .get(`/v1/${prefix}`)
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.requestId).toBeDefined();
    });

    it(`GET /v1/${prefix}/:stableId returns 200 with current version`, async () => {
      asUser(ADMIN);
      svc.findCurrent.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'active' });
      const res = await request(server)
        .get(`/v1/${prefix}/${STABLE_ID}`)
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(VERSION_ID);
      expect(res.body.data.lifecycle_status).toBe('active');
    });

    it(`GET /v1/${prefix}/:stableId/current returns 200 with active version`, async () => {
      asUser(ADMIN);
      svc.findCurrent.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'active' });
      const res = await request(server)
        .get(`/v1/${prefix}/${STABLE_ID}/current`)
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(VERSION_ID);
      expect(res.body.meta.requestId).toBeDefined();
    });

    it(`GET /v1/${prefix}/:stableId/versions returns 200 with history`, async () => {
      asUser(ADMIN);
      svc.findHistory.mockResolvedValueOnce([{ id: VERSION_ID, version_number: 1 }]);
      const res = await request(server)
        .get(`/v1/${prefix}/${STABLE_ID}/versions`)
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].version_number).toBe(1);
      expect(res.body.meta.total).toBe(1);
    });

    it(`GET /v1/${prefix}/:stableId/versions/:versionId returns 200 with version detail`, async () => {
      asUser(ADMIN);
      svc.findVersionById.mockResolvedValueOnce({ id: VERSION_ID, version_number: 1, lifecycle_status: 'draft' });
      const res = await request(server)
        .get(`/v1/${prefix}/${STABLE_ID}/versions/${VERSION_ID}`)
        .set('Authorization', 'Bearer token');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(VERSION_ID);
      expect(res.body.data.lifecycle_status).toBe('draft');
    });

    it(`POST /v1/${prefix}/:stableId/versions returns 201 with new draft`, async () => {
      asUser(ADMIN);
      svc.createNewDraft.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'draft', version_number: 2 });
      const res = await request(server)
        .post(`/v1/${prefix}/${STABLE_ID}/versions`)
        .set('Authorization', 'Bearer token')
        .set('Idempotency-Key', `${prefix}-draft`)
        .send(createBody);
      expect(res.status).toBe(201);
      expect(res.body.data.lifecycle_status).toBe('draft');
      expect(res.body.meta.requestId).toBeDefined();
    });

    it(`PATCH /v1/${prefix}/:stableId/versions/:versionId returns 200 with updated draft`, async () => {
      asUser(ADMIN);
      svc.updateDraft.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'draft', payload_json: '{"name":"Updated"}' });
      const res = await request(server)
        .patch(`/v1/${prefix}/${STABLE_ID}/versions/${VERSION_ID}`)
        .set('Authorization', 'Bearer token')
        .set('Idempotency-Key', `${prefix}-patch`)
        .send({ name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(VERSION_ID);
      expect(res.body.meta.requestId).toBeDefined();
    });

    it(`POST /v1/${prefix}/:stableId/versions/:versionId/publish returns 200 with active version`, async () => {
      asUser(ADMIN);
      svc.publish.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'active', version_number: 1 });
      const res = await request(server)
        .post(`/v1/${prefix}/${STABLE_ID}/versions/${VERSION_ID}/publish`)
        .set('Authorization', 'Bearer token')
        .set('Idempotency-Key', `${prefix}-pub`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.lifecycle_status).toBe('active');
    });

    it(`POST /v1/${prefix}/:stableId/versions/:versionId/activate returns 200 with promoted version`, async () => {
      asUser(ADMIN);
      svc.promoteScheduled.mockResolvedValueOnce({ id: VERSION_ID, lifecycle_status: 'active' });
      const res = await request(server)
        .post(`/v1/${prefix}/${STABLE_ID}/versions/${VERSION_ID}/activate`)
        .set('Authorization', 'Bearer token')
        .set('Idempotency-Key', `${prefix}-act`);
      expect(res.status).toBe(200);
      expect(res.body.data.lifecycle_status).toBe('active');
    });

    it(`POST /v1/${prefix}/:stableId/archive returns 200 with archived confirmation`, async () => {
      asUser(ADMIN);
      svc.archive.mockResolvedValueOnce(1);
      const res = await request(server)
        .post(`/v1/${prefix}/${STABLE_ID}/archive`)
        .set('Authorization', 'Bearer token')
        .set('Idempotency-Key', `${prefix}-arch`);
      expect(res.status).toBe(200);
      expect(res.body.data.archived).toBe(true);
      expect(res.body.meta.requestId).toBeDefined();
    });
  });
}
