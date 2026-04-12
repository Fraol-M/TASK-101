import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for rankings endpoints.
 * Key verifications:
 *   - READ_ONLY can GET rankings (rankings:read) but NOT trigger mutations
 *   - PROGRAM_ADMIN can trigger aggregate, rank, and escalation
 *   - Escalation POST enforces Idempotency-Key
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3014, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/rankings/aggregation.service.js', () => ({
  aggregationService: {
    aggregateCycle: vi.fn(),
    rankCycle: vi.fn(),
    getRankings: vi.fn(),
    escalate: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { aggregationService } from '../../src/modules/rankings/aggregation.service.js';
import { AuthenticationError, AuthorizationError, UnprocessableError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const PROGRAM_ADMIN = { id: 'admin-1', username: 'admin',    roles: ['PROGRAM_ADMIN'] };
const READ_ONLY     = { id: 'ro-1',    username: 'auditor',  roles: ['READ_ONLY'] };
const CYCLE_ID      = '00000000-0000-0000-0000-000000000030';
const APP_ID        = '00000000-0000-0000-0000-000000000031';
const EVENT_ID      = '00000000-0000-0000-0000-000000000032';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user, canResult = true) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(canResult);
}

describe('GET /v1/rankings/cycles/:cycleId — rankings:read', () => {
  it('returns 200 with ranked list for PROGRAM_ADMIN', async () => {
    asUser(PROGRAM_ADMIN);
    aggregationService.getRankings.mockResolvedValueOnce({
      rows: [{ application_id: APP_ID, rank: 1, mean_score: 8.5 }],
      total: 1,
    });

    const res = await request(server)
      .get(`/v1/rankings/cycles/${CYCLE_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 200 for READ_ONLY role (rankings:read permitted)', async () => {
    asUser(READ_ONLY, true); // READ_ONLY has rankings:read
    aggregationService.getRankings.mockResolvedValueOnce({ rows: [], total: 0 });

    const res = await request(server)
      .get(`/v1/rankings/cycles/${CYCLE_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/rankings/cycles/${CYCLE_ID}`);
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/rankings/cycles/:cycleId/aggregate — rankings:compute', () => {
  it('returns 200 with aggregation result for PROGRAM_ADMIN', async () => {
    asUser(PROGRAM_ADMIN);
    aggregationService.aggregateCycle.mockResolvedValueOnce({ aggregated: 42 });

    const res = await request(server)
      .post(`/v1/rankings/cycles/${CYCLE_ID}/aggregate`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'agg-1');

    expect(res.status).toBe(200);
    expect(res.body.data.aggregated).toBe(42);
  });

  it('returns 403 for READ_ONLY role (no rankings:compute)', async () => {
    asUser(READ_ONLY, false); // READ_ONLY lacks rankings:compute

    const res = await request(server)
      .post(`/v1/rankings/cycles/${CYCLE_ID}/aggregate`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'agg-2');

    expect(res.status).toBe(403);
  });

  it('returns 400 for authenticated write without Idempotency-Key', async () => {
    asUser(PROGRAM_ADMIN);

    const res = await request(server)
      .post(`/v1/rankings/cycles/${CYCLE_ID}/aggregate`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
});

describe('POST /v1/rankings/cycles/:cycleId/rank — rankings:compute', () => {
  it('returns 200 with ranking result for PROGRAM_ADMIN', async () => {
    asUser(PROGRAM_ADMIN);
    aggregationService.rankCycle.mockResolvedValueOnce({ ranked: 15 });

    const res = await request(server)
      .post(`/v1/rankings/cycles/${CYCLE_ID}/rank`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rank-1');

    expect(res.status).toBe(200);
    expect(res.body.data.ranked).toBe(15);
  });

  it('returns 403 for READ_ONLY role (no rankings:compute)', async () => {
    asUser(READ_ONLY, false);

    const res = await request(server)
      .post(`/v1/rankings/cycles/${CYCLE_ID}/rank`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'rank-2');

    expect(res.status).toBe(403);
  });
});

describe('POST /v1/rankings/escalations — escalations:write', () => {
  it('returns 201 with escalation event for PROGRAM_ADMIN', async () => {
    asUser(PROGRAM_ADMIN);
    const stub = { id: EVENT_ID, application_id: APP_ID, trigger: 'manual' };
    aggregationService.escalate.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/rankings/escalations')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'esc-1')
      .send({ applicationId: APP_ID, cycleId: CYCLE_ID, trigger: 'manual', notes: 'Borderline case' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(EVENT_ID);
    expect(res.body.data.trigger).toBe('manual');
  });

  it('returns 403 for READ_ONLY role (no escalations:write)', async () => {
    asUser(READ_ONLY, false);

    const res = await request(server)
      .post('/v1/rankings/escalations')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'esc-2')
      .send({ applicationId: APP_ID, cycleId: CYCLE_ID });

    expect(res.status).toBe(403);
  });

  it('returns 400 on missing required fields', async () => {
    asUser(PROGRAM_ADMIN);

    const res = await request(server)
      .post('/v1/rankings/escalations')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'esc-3')
      .send({ notes: 'Missing applicationId and cycleId' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when applicationId does not belong to cycleId', async () => {
    asUser(PROGRAM_ADMIN);
    aggregationService.escalate.mockRejectedValueOnce(
      new UnprocessableError('Application does not belong to the specified cycle'),
    );

    const res = await request(server)
      .post('/v1/rankings/escalations')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'esc-mismatch')
      .send({ applicationId: APP_ID, cycleId: CYCLE_ID, trigger: 'manual' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/does not belong/);
  });
});
