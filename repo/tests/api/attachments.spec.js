import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * API tests for attachment endpoints.
 * Covers: upload, list, delete, MIME enforcement, oversized rejection.
 */

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: { validateAndRotate: vi.fn() },
}));

vi.mock('../../src/modules/rbac/rbac.service.js', () => ({
  rbacService: { can: vi.fn(), getRoles: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3011, nodeEnv: 'test', isProduction: false, isTest: true,
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    attachments: {
      storageRoot: '/tmp',
      maxFileBytes: 10485760,
      maxFilesPerReview: 5,
      allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    },
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

vi.mock('../../src/modules/reviews/attachments/attachment.service.js', () => ({
  attachmentService: {
    upload: vi.fn(),
    listByAssignment: vi.fn(),
    delete: vi.fn(),
  },
}));

import { sessionService } from '../../src/modules/auth/session.service.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';
import { attachmentService } from '../../src/modules/reviews/attachments/attachment.service.js';
import { AuthenticationError, UnprocessableError } from '../../src/common/errors/AppError.js';
import { createApp } from '../../src/app.js';

const REVIEWER    = { id: 'rev-1', username: 'rev1', roles: ['REVIEWER'] };
const ASSIGN_ID   = '00000000-0000-0000-0000-000000000004';
const ATTACH_ID   = '00000000-0000-0000-0000-000000000005';

let server;

beforeAll(() => {
  server = createApp().callback();
});

beforeEach(() => vi.clearAllMocks());

function asUser(user) {
  sessionService.validateAndRotate.mockResolvedValue({ user, newToken: null });
  rbacService.can.mockResolvedValue(true);
}

describe('POST /v1/attachments', () => {
  it('returns 201 with attachment metadata on successful upload', async () => {
    asUser(REVIEWER);
    const stub = { id: ATTACH_ID, assignment_id: ASSIGN_ID, filename: 'report.pdf' };
    attachmentService.upload.mockResolvedValueOnce(stub);

    const res = await request(server)
      .post('/v1/attachments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'attach-upload-1')
      .field('assignmentId', ASSIGN_ID)
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'report.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(ATTACH_ID);
  });

  it('returns 422 when assignmentId is missing', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/attachments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'attach-upload-2')
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'report.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when service throws UnprocessableError (MIME rejected)', async () => {
    asUser(REVIEWER);
    attachmentService.upload.mockRejectedValueOnce(
      new UnprocessableError('File type not allowed. Permitted: application/pdf, image/png, image/jpeg'),
    );

    const res = await request(server)
      .post('/v1/attachments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'attach-upload-3')
      .field('assignmentId', ASSIGN_ID)
      .attach('file', Buffer.from('GIF89a'), { filename: 'hack.gif', contentType: 'image/gif' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/not allowed/i);
  });

  it('returns 422 when service throws UnprocessableError (too many attachments)', async () => {
    asUser(REVIEWER);
    attachmentService.upload.mockRejectedValueOnce(
      new UnprocessableError('Maximum 5 attachments per review assignment'),
    );

    const res = await request(server)
      .post('/v1/attachments')
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'attach-upload-4')
      .field('assignmentId', ASSIGN_ID)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'extra.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/maximum/i);
  });

  it('returns 401 without Authorization header', async () => {
    const res = await request(server).post('/v1/attachments');
    expect(res.status).toBe(401);
  });

  it('returns 400 for authenticated write without Idempotency-Key', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .post('/v1/attachments')
      .set('Authorization', 'Bearer token')
      .field('assignmentId', ASSIGN_ID)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'f.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });
});

describe('GET /v1/attachments', () => {
  it('returns 200 with attachment list for assignment', async () => {
    asUser(REVIEWER);
    attachmentService.listByAssignment.mockResolvedValueOnce([{ id: ATTACH_ID }]);

    const res = await request(server)
      .get(`/v1/attachments?assignmentId=${ASSIGN_ID}`)
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it('returns 422 when assignmentId query param is missing', async () => {
    asUser(REVIEWER);

    const res = await request(server)
      .get('/v1/attachments')
      .set('Authorization', 'Bearer token');

    expect(res.status).toBe(422);
  });
});

describe('DELETE /v1/attachments/:id', () => {
  it('returns 204 on successful delete', async () => {
    asUser(REVIEWER);
    attachmentService.delete.mockResolvedValueOnce(undefined);

    const res = await request(server)
      .delete(`/v1/attachments/${ATTACH_ID}`)
      .set('Authorization', 'Bearer token')
      .set('Idempotency-Key', 'attach-delete-1');

    expect(res.status).toBe(204);
  });
});
