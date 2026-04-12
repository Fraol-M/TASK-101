import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for idempotency middleware.
 * Verifies:
 *   1. First request → reserves slot, executes handler, completes slot
 *   2. Duplicate request with same fingerprint (completed) → returns cached response (no re-execution)
 *   3. Duplicate request with same fingerprint (pending/in-flight) → 409 IN_FLIGHT
 *   4. Duplicate request with different fingerprint → 409 Conflict
 *   5. Requests without Idempotency-Key → 400 MISSING_IDEMPOTENCY_KEY
 *   6. Unauthenticated write requests → pass through unchanged
 *   7. Handler failure → pending slot is cleaned up
 */

vi.mock('../../src/common/db/knex.js', () => ({ default: vi.fn() }));
vi.mock('../../src/common/logging/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../../src/config/env.js', () => ({
  default: {
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    nodeEnv: 'test', isTest: true, isProduction: false,
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    attachments: { storageRoot: '/tmp', maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
  },
}));

vi.mock('../../src/common/idempotency/idempotency.repository.js', () => ({
  idempotencyRepository: {
    reserve: vi.fn(),
    findByAccountAndKey: vi.fn(),
    complete: vi.fn().mockResolvedValue(undefined),
    deletePending: vi.fn().mockResolvedValue(undefined),
    insert: vi.fn().mockResolvedValue(undefined),
    deleteExpired: vi.fn(),
  },
}));

import { idempotencyMiddleware } from '../../src/common/idempotency/idempotency.middleware.js';
import { idempotencyRepository } from '../../src/common/idempotency/idempotency.repository.js';
import { ConflictError } from '../../src/common/errors/AppError.js';

function makeCtx(overrides = {}) {
  return {
    method: 'POST',
    path: '/v1/test',
    get: vi.fn((header) => overrides.headers?.[header] ?? ''),
    state: { user: { id: 'user-1' } },
    status: 200,
    body: null,
    request: { body: { data: 'test' } },
    ...overrides,
  };
}

describe('idempotencyMiddleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when authenticated write request is missing Idempotency-Key', async () => {
    const ctx = makeCtx({ headers: { 'Idempotency-Key': '' } });
    const next = vi.fn();

    await idempotencyMiddleware()(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(400);
    expect(ctx.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('passes through unauthenticated write requests without a key (e.g. login)', async () => {
    const ctx = makeCtx({ headers: { 'Idempotency-Key': '' } });
    ctx.state = {}; // no user
    const next = vi.fn().mockResolvedValue(undefined);

    await idempotencyMiddleware()(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(idempotencyRepository.reserve).not.toHaveBeenCalled();
  });

  it('reserves slot, executes handler and completes slot on first request', async () => {
    idempotencyRepository.reserve.mockResolvedValue(true); // slot reserved

    const ctx = makeCtx({ headers: { 'Idempotency-Key': 'key-abc' } });
    ctx.get = vi.fn((h) => h === 'Idempotency-Key' ? 'key-abc' : '');

    const next = vi.fn().mockImplementation(() => {
      ctx.status = 201;
      ctx.body = { data: { id: 'new-1' } };
    });

    await idempotencyMiddleware()(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(idempotencyRepository.reserve).toHaveBeenCalledOnce();
    expect(idempotencyRepository.complete).toHaveBeenCalledWith(
      'user-1', 'key-abc', 201, { data: { id: 'new-1' } },
    );
  });

  it('replays cached response on duplicate request with same fingerprint (completed)', async () => {
    // reserve() returns false — slot already existed
    idempotencyRepository.reserve.mockResolvedValue(false);

    const { requestFingerprint } = await import('../../src/common/crypto/tokens.js');
    const fp = requestFingerprint('POST', '/v1/test', { data: 'test' });

    idempotencyRepository.findByAccountAndKey.mockResolvedValue({
      request_fingerprint: fp,
      response_status: 201,  // completed (not pending)
      response_body: JSON.stringify({ data: { id: 'existing-1' } }),
    });

    const ctx = makeCtx({ headers: { 'Idempotency-Key': 'key-dup' } });
    ctx.get = vi.fn((h) => h === 'Idempotency-Key' ? 'key-dup' : '');

    const next = vi.fn();
    await idempotencyMiddleware()(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(201);
    expect(ctx.body.data.id).toBe('existing-1');
  });

  it('returns 409 IN_FLIGHT when duplicate request arrives while slot is still pending', async () => {
    idempotencyRepository.reserve.mockResolvedValue(false);

    const { requestFingerprint } = await import('../../src/common/crypto/tokens.js');
    const fp = requestFingerprint('POST', '/v1/test', { data: 'test' });

    idempotencyRepository.findByAccountAndKey.mockResolvedValue({
      request_fingerprint: fp,
      response_status: 0, // pending sentinel
      response_body: '{}',
    });

    const ctx = makeCtx({ headers: { 'Idempotency-Key': 'key-inflight' } });
    ctx.get = vi.fn((h) => h === 'Idempotency-Key' ? 'key-inflight' : '');

    const next = vi.fn();
    await idempotencyMiddleware()(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.status).toBe(409);
    expect(ctx.body.error.code).toBe('IDEMPOTENCY_KEY_IN_FLIGHT');
  });

  it('throws ConflictError when fingerprint differs (payload mismatch)', async () => {
    idempotencyRepository.reserve.mockResolvedValue(false);
    idempotencyRepository.findByAccountAndKey.mockResolvedValue({
      request_fingerprint: 'different-fingerprint-hash',
      response_status: 201,
      response_body: '{}',
    });

    const ctx = makeCtx({ headers: { 'Idempotency-Key': 'key-conflict' } });
    ctx.get = vi.fn((h) => h === 'Idempotency-Key' ? 'key-conflict' : '');

    const next = vi.fn();
    await expect(idempotencyMiddleware()(ctx, next)).rejects.toThrow(ConflictError);
    expect(next).not.toHaveBeenCalled();
  });

  it('cleans up the pending slot when the handler throws', async () => {
    idempotencyRepository.reserve.mockResolvedValue(true);

    const ctx = makeCtx({ headers: { 'Idempotency-Key': 'key-fail' } });
    ctx.get = vi.fn((h) => h === 'Idempotency-Key' ? 'key-fail' : '');

    const handlerError = new Error('downstream failure');
    const next = vi.fn().mockRejectedValue(handlerError);

    await expect(idempotencyMiddleware()(ctx, next)).rejects.toThrow('downstream failure');

    expect(idempotencyRepository.deletePending).toHaveBeenCalledWith('user-1', 'key-fail');
    expect(idempotencyRepository.complete).not.toHaveBeenCalled();
  });

  it('passes through GET requests even with Idempotency-Key (read methods skip idempotency)', async () => {
    const ctx = makeCtx({ method: 'GET', headers: { 'Idempotency-Key': 'key-get' } });
    ctx.get = vi.fn((h) => h === 'Idempotency-Key' ? 'key-get' : '');

    const next = vi.fn().mockResolvedValue(undefined);
    await idempotencyMiddleware()(ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(idempotencyRepository.reserve).not.toHaveBeenCalled();
  });
});
