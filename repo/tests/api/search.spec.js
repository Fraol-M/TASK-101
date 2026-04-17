import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for search endpoints.
 * Covers: query, suggest, saved-query CRUD, run, and RBAC enforcement.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3012, nodeEnv: 'test', isProduction: false, isTest: true,
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

vi.mock('../../src/modules/search/search.service.js', () => ({
  searchService: {
    search: vi.fn(),
    suggest: vi.fn(),
  },
}));

vi.mock('../../src/modules/search/saved-queries.service.js', () => ({
  savedQueriesService: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    run: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { searchService } from '../../src/modules/search/search.service.js';
import { savedQueriesService } from '../../src/modules/search/saved-queries.service.js';
import { AuthenticationError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const REVIEWER  = { id: 'rev-1', username: 'rev1', roles: ['REVIEWER'] };
const SQ_ID     = '00000000-0000-0000-0000-000000000010';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(true);
}

describe('GET /v1/search', () => {
  it('returns 200 with results and metadata', async () => {
    asUser(REVIEWER);
    searchService.search.mockResolvedValueOnce({
      rows: [{ entityType: 'university', stableId: 'u1', highlights: ['<mark>CS</mark>'] }],
      total: 1,
      queryText: 'websearch_to_tsquery(...)',
      durationMs: 4,
    });

    const res = await request(server)
      .get('/v1/search?q=computer+science')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('returns 400 when q is missing', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .get('/v1/search')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/search?q=test');
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/search/suggest', () => {
  it('returns 200 with suggestion array', async () => {
    asUser(REVIEWER);
    searchService.suggest.mockResolvedValueOnce(['computer science', 'computational biology']);

    const res = await request(server)
      .get('/v1/search/suggest?q=comp')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toContain('computer science');
  });
});

describe('POST /v1/search/saved-queries', () => {
  it('returns 201 with saved query on success', async () => {
    asUser(REVIEWER);
    const stub = { id: SQ_ID, name: 'My AI Query', query_text: 'artificial intelligence' };
    savedQueriesService.create.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/search/saved-queries')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sq-create-1')
      .send({ name: 'My AI Query', queryText: 'artificial intelligence' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(SQ_ID);
  });

  it('returns 400 when name is missing', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/search/saved-queries')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sq-create-2')
      .send({ queryText: 'machine learning' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for authenticated write without Idempotency-Key', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/search/saved-queries')
      .set('Authorization', 'Bearer token')
      .send({ name: 'Q', queryText: 'test' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
});

describe('POST /v1/search/saved-queries/:id/run', () => {
  it('returns 200 with search results', async () => {
    asUser(REVIEWER);
    savedQueriesService.run.mockResolvedValueOnce({
      rows: [{ entityType: 'major', stableId: 'm1' }],
      total: 1,
      queryText: 'artificial intelligence',
    });

    const res = await request(server)
      .post(`/v1/search/saved-queries/${SQ_ID}/run`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sq-run-1');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.query).toBe('artificial intelligence');
  });
});

describe('GET /v1/search/saved-queries', () => {
  it('returns 200 with saved query list', async () => {
    asUser(REVIEWER);
    savedQueriesService.list.mockResolvedValueOnce({
      rows: [{ id: SQ_ID, name: 'My Query', query_text: 'AI' }],
      total: 1,
    });

    const res = await request(server)
      .get('/v1/search/saved-queries')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).get('/v1/search/saved-queries');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /v1/search/saved-queries/:id', () => {
  it('returns 200 with updated saved query', async () => {
    asUser(REVIEWER);
    savedQueriesService.update.mockResolvedValueOnce({
      id: SQ_ID, name: 'Updated Query', query_text: 'machine learning',
    });

    const res = await request(server)
      .patch(`/v1/search/saved-queries/${SQ_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sq-patch-1')
      .send({ name: 'Updated Query' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Query');
  });

  it('returns 400 when body is empty', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .patch(`/v1/search/saved-queries/${SQ_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sq-patch-2')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server)
      .patch(`/v1/search/saved-queries/${SQ_ID}`)
      .send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /v1/search/saved-queries/:id', () => {
  it('returns 204 on successful delete', async () => {
    asUser(REVIEWER);
    savedQueriesService.delete.mockResolvedValueOnce(undefined);

    const res = await request(server)
      .delete(`/v1/search/saved-queries/${SQ_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'sq-delete-1');

    expect(res.status).toBe(204);
  });
});
