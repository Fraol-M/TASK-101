import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for personalization endpoints.
 * Covers: recommendations (warm + cold-start), bookmarks, history, preferences,
 * tag subscriptions, and RBAC enforcement.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3013, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/personalization/personalization.service.js', () => ({
  personalizationService: {
    getRecommendations: vi.fn(),
    getHistory: vi.fn(),
    getBookmarks: vi.fn(),
    addBookmark: vi.fn(),
    removeBookmark: vi.fn(),
    getPreferences: vi.fn(),
    setPreference: vi.fn(),
    deletePreference: vi.fn(),
    getTagSubscriptions: vi.fn(),
    addTagSubscription: vi.fn(),
    removeTagSubscription: vi.fn(),
    recordView: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { personalizationService } from '../../src/modules/personalization/personalization.service.js';
import { AuthenticationError, ConflictError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const APPLICANT = { id: 'app-1', username: 'alice', roles: ['APPLICANT'] };
const STABLE_ID = '00000000-0000-0000-0000-000000000020';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(true);
}

describe('GET /v1/personalization/recommendations', () => {
  it('returns 200 with warm recommendations (views + bookmarks)', async () => {
    asUser(APPLICANT);
    personalizationService.getRecommendations.mockResolvedValueOnce([
      { entityType: 'university', stableId: STABLE_ID, score: 5, reasons: [{ type: 'frequently_viewed', viewCount: 5 }] },
    ]);

    const res = await request(server)
      .get('/v1/personalization/recommendations')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].reasons[0].type).toBe('frequently_viewed');
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 200 with cold-start recommendations (no signals)', async () => {
    asUser(APPLICANT);
    personalizationService.getRecommendations.mockResolvedValueOnce([
      { entityType: 'university', stableId: STABLE_ID, score: 0, reasons: [{ type: 'cold_start', basis: 'recently_popular' }] },
    ]);

    const res = await request(server)
      .get('/v1/personalization/recommendations')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data[0].reasons[0].type).toBe('cold_start');
  });

  it('returns 200 with tag-subscription-based recs (only tag signals)', async () => {
    asUser(APPLICANT);
    personalizationService.getRecommendations.mockResolvedValueOnce([
      { entityType: 'major', stableId: STABLE_ID, score: 2, reasons: [{ type: 'tag_subscription', entityType: 'major' }] },
    ]);

    const res = await request(server)
      .get('/v1/personalization/recommendations')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data[0].reasons[0].type).toBe('tag_subscription');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/personalization/recommendations');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/personalization/bookmarks', () => {
  it('returns 200 with bookmark list', async () => {
    asUser(APPLICANT);
    personalizationService.getBookmarks.mockResolvedValueOnce({ rows: [{ stable_id: STABLE_ID }], total: 1 });

    const res = await request(server)
      .get('/v1/personalization/bookmarks')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });
});

describe('POST /v1/personalization/bookmarks', () => {
  it('returns 201 on successful bookmark add', async () => {
    asUser(APPLICANT);
    const stub = { id: '00000000-0000-0000-0000-000000000021', entity_type: 'university', stable_id: STABLE_ID };
    personalizationService.addBookmark.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/personalization/bookmarks')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'bookmark-add-1')
      .send({ entityType: 'university', stableId: STABLE_ID });

    expect(res.status).toBe(201);
    expect(res.body.data.stable_id).toBe(STABLE_ID);
  });

  it('returns 409 when already bookmarked', async () => {
    asUser(APPLICANT);
    personalizationService.addBookmark.mockRejectedValueOnce(new ConflictError('Already bookmarked'));

    const res = await request(server)
      .post('/v1/personalization/bookmarks')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'bookmark-add-2')
      .send({ entityType: 'university', stableId: STABLE_ID });

    expect(res.status).toBe(409);
  });

  it('returns 400 without Idempotency-Key', async () => {
    asUser(APPLICANT);

    const res = await request(server)
      .post('/v1/personalization/bookmarks')
      .set('Authorization', 'Bearer token')
      .send({ entityType: 'university', stableId: STABLE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
});

describe('GET /v1/personalization/history', () => {
  it('returns 200 with paginated history', async () => {
    asUser(APPLICANT);
    personalizationService.getHistory.mockResolvedValueOnce({
      rows: [{ entity_type: 'major', stable_id: STABLE_ID }],
      total: 1,
    });

    const res = await request(server)
      .get('/v1/personalization/history')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /v1/personalization/subscriptions', () => {
  it('returns 201 on successful tag subscription', async () => {
    asUser(APPLICANT);
    const stub = { id: '00000000-0000-0000-0000-000000000022', tag: 'major', tag_type: 'entity_type' };
    personalizationService.addTagSubscription.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/personalization/subscriptions')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sub-add-1')
      .send({ tag: 'major', tagType: 'entity_type' });

    expect(res.status).toBe(201);
    expect(res.body.data.tag).toBe('major');
  });
});

describe('GET /v1/personalization/preferences', () => {
  it('returns 200 with preferences map', async () => {
    asUser(APPLICANT);
    personalizationService.getPreferences.mockResolvedValueOnce({ theme: 'dark', language: 'en' });

    const res = await request(server)
      .get('/v1/personalization/preferences')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('dark');
  });
});
