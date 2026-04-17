import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for scoring endpoints.
 *
 * Focuses on route-level Zod validation that is not exercised by service-level
 * or integration tests:
 *   - criterionScores values must be multiples of 0.5 (0–10 range, 0.5 step)
 *   - non-0.5-aligned values (e.g. 7.3) are rejected with 400 VALIDATION_ERROR
 *   - values outside 0–10 are rejected with 400 VALIDATION_ERROR
 *   - recommendation enum enforced on submit (missing → 400 on route, not 422 from service)
 *   - assignmentId must be a UUID
 *   - valid payloads are forwarded to the service (200/201 pass-through)
 *
 * Service behaviour (ownership, duplicate detection, composite computation) is
 * covered by tests/integration/scoring.submit.spec.js.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3020, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/reviews/scoring/scoring.service.js', () => ({
  scoringService: {
    submit: vi.fn(),
    saveDraft: vi.fn(),
    getByAssignment: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { scoringService } from '../../src/modules/reviews/scoring/scoring.service.js';
import { AuthenticationError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const REVIEWER     = { id: 'rev-1', username: 'rev1', roles: ['REVIEWER'] };
const ASSIGN_ID    = '00000000-0000-0000-0000-000000000010';
const SCORE_ID     = '00000000-0000-0000-0000-000000000011';

const VALID_SUBMIT_BODY = {
  assignmentId: ASSIGN_ID,
  criterionScores: { research: 8, statement: 7 },
  recommendation: 'admit',
};

const VALID_DRAFT_BODY = {
  assignmentId: ASSIGN_ID,
  criterionScores: { research: 6, statement: 5 },
  recommendation: 'borderline',
};

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(true);
}

// ── POST /v1/scores/submit — route-level Zod validation ──────────────────────

describe('POST /v1/scores/submit — score step and range validation', () => {
  it('returns 400 when a criterion score is not a multiple of 0.5 (e.g. 7.3)', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-step-1')
      .send({ ...VALID_SUBMIT_BODY, criterionScores: { research: 7.3, statement: 7 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a criterion score is not a multiple of 0.5 (e.g. 0.1)', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-step-2')
      .send({ ...VALID_SUBMIT_BODY, criterionScores: { research: 0.1, statement: 7 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a criterion score exceeds 10', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-range-hi')
      .send({ ...VALID_SUBMIT_BODY, criterionScores: { research: 10.5, statement: 7 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when a criterion score is below 0', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-range-lo')
      .send({ ...VALID_SUBMIT_BODY, criterionScores: { research: -0.5, statement: 7 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when recommendation is absent', async () => {
    asUser(REVIEWER);
    const { recommendation: _r, ...bodyWithoutRec } = VALID_SUBMIT_BODY;

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-no-rec')
      .send(bodyWithoutRec);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when recommendation is not a valid enum value', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-bad-rec')
      .send({ ...VALID_SUBMIT_BODY, recommendation: 'maybe' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when assignmentId is not a UUID', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-bad-id')
      .send({ ...VALID_SUBMIT_BODY, assignmentId: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts 0 and 10 as valid boundary values', async () => {
    asUser(REVIEWER);
    const stub = { id: SCORE_ID, is_draft: false };
    scoringService.submit.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-boundary')
      .send({ ...VALID_SUBMIT_BODY, criterionScores: { research: 0, statement: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SCORE_ID);
  });

  it('accepts 0.5-aligned non-integer values (e.g. 7.5)', async () => {
    asUser(REVIEWER);
    const stub = { id: SCORE_ID, is_draft: false };
    scoringService.submit.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/scores/submit')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'submit-half-step')
      .send({ ...VALID_SUBMIT_BODY, criterionScores: { research: 7.5, statement: 6.5 } });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SCORE_ID);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).post('/v1/scores/submit').send(VALID_SUBMIT_BODY);
    expect(res.status).toBe(401);
  });
});

// ── PUT /v1/scores/draft — route-level Zod validation ────────────────────────

describe('PUT /v1/scores/draft — score step and range validation', () => {
  it('returns 400 when a criterion score is not a multiple of 0.5 (e.g. 3.7)', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .put('/v1/scores/draft')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'draft-step-1')
      .send({ ...VALID_DRAFT_BODY, criterionScores: { research: 3.7, statement: 5 } });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a valid draft payload and forwards to service', async () => {
    asUser(REVIEWER);
    const stub = { id: SCORE_ID, is_draft: true };
    scoringService.saveDraft.mockResolvedValueOnce(stub);

    const res = await request(server)
      .put('/v1/scores/draft')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'draft-valid-1')
      .send(VALID_DRAFT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SCORE_ID);
    expect(scoringService.saveDraft).toHaveBeenCalledOnce();
  });

  it('accepts draft without recommendation (field is optional on draft)', async () => {
    asUser(REVIEWER);
    const stub = { id: SCORE_ID, is_draft: true };
    scoringService.saveDraft.mockResolvedValueOnce(stub);
    const { recommendation: _r, ...bodyWithoutRec } = VALID_DRAFT_BODY;

    const res = await request(server)
      .put('/v1/scores/draft')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'draft-no-rec')
      .send(bodyWithoutRec);

    expect(res.status).toBe(200);
  });
});

// ── GET /v1/scores/:assignmentId ─────────────────────────────────────────────

describe('GET /v1/scores/:assignmentId', () => {
  it('returns 200 with score for assignment', async () => {
    asUser(REVIEWER);
    scoringService.getByAssignment.mockResolvedValueOnce({
      id: SCORE_ID, assignment_id: ASSIGN_ID, is_draft: false,
    });

    const res = await request(server)
      .get(`/v1/scores/${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(SCORE_ID);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 400 when assignmentId is not a UUID', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .get('/v1/scores/not-a-uuid')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get(`/v1/scores/${ASSIGN_ID}`);
    expect(res.status).toBe(401);
  });
});
