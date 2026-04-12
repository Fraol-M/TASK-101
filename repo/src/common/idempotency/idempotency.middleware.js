import { createHash } from 'crypto';
import { promises as fsPromises } from 'fs';
import { requestFingerprint } from '../crypto/tokens.js';
import { idempotencyRepository } from './idempotency.repository.js';
import { ConflictError } from '../errors/AppError.js';
import logger from '../logging/logger.js';

// HTTP methods that require idempotency protection
const IDEMPOTENT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Idempotency-key middleware.
 *
 * For authenticated write requests (POST/PUT/PATCH/DELETE):
 *   - Missing Idempotency-Key header → 400 MISSING_IDEMPOTENCY_KEY
 *   - Key present, no prior record → reserve slot, execute handler, complete slot
 *   - Key present, matching fingerprint, completed → return cached response (deduplication)
 *   - Key present, matching fingerprint, pending → 409 (concurrent in-flight request)
 *   - Key present, different fingerprint → 409 Conflict
 *
 * Unauthenticated write requests (e.g. POST /v1/auth/login) are exempt.
 *
 * Atomicity guarantee: the slot is reserved via INSERT … ON CONFLICT DO NOTHING
 * before the handler runs, so two concurrent requests with the same key race at the
 * DB level. Only one wins the INSERT; the other finds the existing record and either
 * replays the cached response or returns 409 (still pending).
 */
export function idempotencyMiddleware() {
  return async function idempotency(ctx, next) {
    const idempotencyKey = ctx.get('Idempotency-Key');

    // Skip non-write methods entirely
    if (!IDEMPOTENT_METHODS.has(ctx.method)) {
      await next();
      return;
    }

    // Unauthenticated write requests (e.g. POST /v1/auth/login) bypass idempotency
    const accountId = ctx.state.user?.id;
    if (!accountId) {
      await next();
      return;
    }

    // Authenticated write requests MUST supply an Idempotency-Key
    if (!idempotencyKey) {
      ctx.status = 400;
      ctx.body = {
        error: {
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Idempotency-Key header is required for authenticated write operations',
        },
        meta: { requestId: ctx.state.requestId },
      };
      return;
    }

    // For multipart uploads, include file identity (size + SHA-256) in the fingerprint
    // so that re-uploading a different file with the same key is correctly detected as a conflict.
    let fileIdentity = {};
    if (ctx.request.files && Object.keys(ctx.request.files).length > 0) {
      for (const [field, f] of Object.entries(ctx.request.files)) {
        const singleFile = Array.isArray(f) ? f[0] : f;
        if (singleFile?.filepath) {
          const buf = await fsPromises.readFile(singleFile.filepath);
          fileIdentity[field] = {
            size: singleFile.size,
            sha256: createHash('sha256').update(buf).digest('hex'),
          };
        }
      }
    }
    const fingerprintBody = Object.keys(fileIdentity).length
      ? { ...(ctx.request.body || {}), __files: fileIdentity }
      : (ctx.request.body || {});
    const fingerprint = requestFingerprint(ctx.method, ctx.path, fingerprintBody);

    // Attempt to atomically reserve the slot before running the handler.
    // If reserve returns false, a record already exists for this (account, key).
    const reserved = await idempotencyRepository.reserve(accountId, idempotencyKey, fingerprint);

    if (!reserved) {
      // Slot already existed — look up the record to decide what to return
      const existing = await idempotencyRepository.findByAccountAndKey(accountId, idempotencyKey);

      if (!existing) {
        // Record existed when we tried to insert but has since expired — treat as new
        // Re-attempt the reserve; if it fails again another request is truly concurrent
        const retried = await idempotencyRepository.reserve(accountId, idempotencyKey, fingerprint);
        if (!retried) {
          ctx.status = 409;
          ctx.body = {
            error: {
              code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
              message: 'A request with this Idempotency-Key is already being processed',
            },
            meta: { requestId: ctx.state.requestId },
          };
          return;
        }
        // Successfully reserved on retry — fall through to handler execution below
      } else {
        if (existing.request_fingerprint !== fingerprint) {
          throw new ConflictError(
            'Idempotency key already used with a different request body',
          );
        }

        if (existing.response_status === 0) {
          // Still pending — concurrent in-flight request
          ctx.status = 409;
          ctx.body = {
            error: {
              code: 'IDEMPOTENCY_KEY_IN_FLIGHT',
              message: 'A request with this Idempotency-Key is already being processed',
            },
            meta: { requestId: ctx.state.requestId },
          };
          return;
        }

        // Completed — replay cached response
        ctx.status = existing.response_status;
        const cached = typeof existing.response_body === 'string'
          ? JSON.parse(existing.response_body)
          : existing.response_body;
        // 204 responses have no body — only set if the cached payload is non-empty
        if (cached && Object.keys(cached).length > 0) {
          ctx.body = cached;
        }
        return;
      }
    }

    // Slot is now reserved — execute the handler
    try {
      await next();
    } catch (err) {
      // Handler failed — release the pending slot so the client can retry
      await idempotencyRepository.deletePending(accountId, idempotencyKey).catch((e) => {
        // Log but do not suppress the original error
        logger.error({ err: e, accountId, idempotencyKey }, 'idempotency: failed to release pending slot after handler error');
      });
      throw err;
    }

    // Handler succeeded — complete the slot with the real response.
    // Retried up to 3 times (50ms, 100ms backoff) before falling back to deletePending()
    // so the client is not stuck with 409 IN_FLIGHT responses for up to 24 hours.
    if (ctx.status >= 200 && ctx.status < 300) {
      let completeErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await idempotencyRepository.complete(accountId, idempotencyKey, ctx.status, ctx.body ?? {});
          completeErr = null;
          break;
        } catch (e) {
          completeErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
        }
      }
      if (completeErr) {
        // All retries exhausted — leave the pending slot in place. Deleting it would allow
        // client retries to re-execute the handler, violating the duplicate-submission guarantee.
        // The slot will expire naturally; the client will receive 409 IN_FLIGHT until then.
        logger.error({ err: completeErr, accountId, idempotencyKey, status: ctx.status },
          'idempotency: failed to complete slot after retries — slot left pending until expiry to prevent duplicate execution');
      }
    } else {
      // Non-2xx (e.g. validation error that slipped through) — release the slot
      await idempotencyRepository.deletePending(accountId, idempotencyKey).catch((e) => {
        logger.error({ err: e, accountId, idempotencyKey }, 'idempotency: failed to release pending slot after non-2xx response');
      });
    }
  };
}
