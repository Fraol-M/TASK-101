import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Koa from 'koa';
import request from 'supertest';

/**
 * Integration tests for auth and session flows against a real PostgreSQL database.
 *
 * Coverage:
 *   login    — creates a session, returns a raw token
 *   logout   — invalidates the session; subsequent validation returns 401
 *   rotation — validateAndRotate issues a new token when rotationIntervalMs is exceeded
 *   grace    — previous token (post-rotation) is accepted within the grace window
 *   grace expiry — previous token rejected after the grace window
 *   idle timeout — token rejected when idle_expires_at is in the past
 *   absolute timeout — token rejected when absolute_expires_at is in the past
 *   inactive account — token rejected when account.status !== 'active'
 *   invalidateAll — all sessions for an account are revoked together
 *   middleware X-Session-Token — rotation token delivered as response header
 *   lock contention retry — FOR UPDATE NOWAIT retries once on 55P03
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let sessionService;
let hashToken;

let accountId;
let inactiveAccountId;

const cleanup = {
  accountIds: [],
};

async function createAccount(suffix, status = 'active') {
  const [acc] = await knex('accounts')
    .insert({ username: `auth-int-${TS}-${suffix}`, password_hash: DUMMY_HASH, status })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();

  const sessionMod = await import('../../src/modules/auth/session.service.js');
  sessionService = sessionMod.sessionService;

  const tokenMod = await import('../../src/common/crypto/tokens.js');
  hashToken = tokenMod.hashToken;

  const acc = await createAccount('main');
  accountId = acc.id;

  const inactive = await createAccount('inactive', 'inactive');
  inactiveAccountId = inactive.id;
});

afterAll(async () => {
  if (cleanup.accountIds.length) {
    // Sessions FK-reference accounts; delete sessions first
    await knex('sessions').whereIn('account_id', cleanup.accountIds).delete();
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

// ── login / logout ────────────────────────────────────────────────────────────

describe('sessionService.create + validateAndRotate — happy path', () => {
  it('create returns a raw token and validateAndRotate accepts it', async () => {
    const rawToken = await sessionService.create(accountId, { ipAddress: '127.0.0.1' });

    expect(typeof rawToken).toBe('string');
    expect(rawToken.length).toBeGreaterThan(20);

    const { user, newToken } = await sessionService.validateAndRotate(rawToken);
    expect(user.id).toBe(accountId);
    expect(user.roles).toBeInstanceOf(Array);
    // No rotation yet (session was just created — rotated_at is null → rotationIntervalMs is Infinity)
    expect(newToken).toBeNull();

    // Clean up
    await sessionService.invalidate(rawToken);
  });
});

describe('sessionService.invalidate — logout', () => {
  it('validates before invalidation, rejects after', async () => {
    const rawToken = await sessionService.create(accountId);

    // Should succeed before invalidation
    await expect(sessionService.validateAndRotate(rawToken)).resolves.toMatchObject({
      user: { id: accountId },
    });

    await sessionService.invalidate(rawToken, 'logout');

    // Should fail after invalidation
    await expect(sessionService.validateAndRotate(rawToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

// ── token rotation ────────────────────────────────────────────────────────────

describe('sessionService.validateAndRotate — rotation', () => {
  it('issues a new token when rotationIntervalMs has elapsed', async () => {
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    // Backdating rotated_at to beyond the rotation interval triggers rotation
    const pastRotation = new Date(Date.now() - 16 * 60 * 1000).toISOString(); // 16 min ago
    await knex('sessions')
      .where('token_hash', tokenHash)
      .update({ rotated_at: pastRotation });

    const { newToken } = await sessionService.validateAndRotate(rawToken);
    expect(newToken).not.toBeNull();

    // Clean up — invalidate using the new token
    await sessionService.invalidate(newToken);
  });

  it('accepts the previous token within the grace window after rotation', async () => {
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    // Force rotation by backdating rotated_at
    await knex('sessions')
      .where('token_hash', tokenHash)
      .update({ rotated_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });

    const { newToken } = await sessionService.validateAndRotate(rawToken);
    expect(newToken).not.toBeNull();

    // The old token (now previous_token_hash) should still be accepted within grace
    const { user } = await sessionService.validateAndRotate(rawToken);
    expect(user.id).toBe(accountId);

    await sessionService.invalidate(newToken);
  });

  it('rejects the previous token after the grace window has expired', async () => {
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    // Force rotation
    await knex('sessions')
      .where('token_hash', tokenHash)
      .update({ rotated_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });

    const { newToken } = await sessionService.validateAndRotate(rawToken);
    const newTokenHash = hashToken(newToken);

    // Backdate rotated_at to beyond the grace window (grace = 30s)
    await knex('sessions')
      .where('token_hash', newTokenHash)
      .update({ rotated_at: new Date(Date.now() - 60_000).toISOString() }); // 60s ago

    // Previous token should now be rejected
    await expect(sessionService.validateAndRotate(rawToken)).rejects.toMatchObject({
      statusCode: 401,
    });

    await sessionService.invalidate(newToken);
  });
});

// ── timeout enforcement ───────────────────────────────────────────────────────

describe('sessionService.validateAndRotate — timeout enforcement', () => {
  it('rejects a token whose idle_expires_at is in the past', async () => {
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    // Expire the session via the DB
    await knex('sessions')
      .where('token_hash', tokenHash)
      .update({ idle_expires_at: new Date(Date.now() - 1000).toISOString() });

    await expect(sessionService.validateAndRotate(rawToken)).rejects.toMatchObject({
      statusCode: 401,
    });

    // Clean up
    await knex('sessions').where('token_hash', tokenHash).delete();
  });

  it('rejects a token whose absolute_expires_at is in the past', async () => {
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    await knex('sessions')
      .where('token_hash', tokenHash)
      .update({ absolute_expires_at: new Date(Date.now() - 1000).toISOString() });

    await expect(sessionService.validateAndRotate(rawToken)).rejects.toMatchObject({
      statusCode: 401,
    });

    await knex('sessions').where('token_hash', tokenHash).delete();
  });
});

// ── account status guard ──────────────────────────────────────────────────────

describe('sessionService.validateAndRotate — account status guard', () => {
  it('rejects a valid token when the associated account is inactive', async () => {
    const rawToken = await sessionService.create(inactiveAccountId);

    await expect(sessionService.validateAndRotate(rawToken)).rejects.toMatchObject({
      statusCode: 401,
    });

    await sessionService.invalidate(rawToken);
  });
});

// ── invalidateAll ─────────────────────────────────────────────────────────────

describe('sessionService.invalidateAll', () => {
  it('revokes all sessions for an account', async () => {
    const acc = await createAccount('multi-session');
    const token1 = await sessionService.create(acc.id);
    const token2 = await sessionService.create(acc.id);

    // Both are valid initially
    await expect(sessionService.validateAndRotate(token1)).resolves.toMatchObject({ user: { id: acc.id } });
    await expect(sessionService.validateAndRotate(token2)).resolves.toMatchObject({ user: { id: acc.id } });

    await sessionService.invalidateAll(acc.id, 'password_change');

    await expect(sessionService.validateAndRotate(token1)).rejects.toMatchObject({ statusCode: 401 });
    await expect(sessionService.validateAndRotate(token2)).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ── HTTP middleware: X-Session-Token header on rotation ───────────────────────

describe('authMiddleware — X-Session-Token header', () => {
  /**
   * Uses a minimal Koa app (just authMiddleware + a 200 stub handler) so the test
   * is independent of routing, RBAC, and idempotency infrastructure.
   * This exercises the middleware path directly: the header must appear in the
   * HTTP response when token rotation is triggered.
   */
  it('sets X-Session-Token response header when rotation is triggered', async () => {
    const { authMiddleware } = await import('../../src/modules/auth/auth.middleware.js');

    // Minimal app: auth middleware → always-200 stub
    const app = new Koa();
    app.use(authMiddleware());
    app.use((ctx) => {
      ctx.status = 200;
      ctx.body = { ok: true };
    });

    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    // Backdate rotated_at beyond the 15-minute rotation interval
    await knex('sessions')
      .where('token_hash', tokenHash)
      .update({ rotated_at: new Date(Date.now() - 16 * 60 * 1000).toISOString() });

    const res = await request(app.callback())
      .get('/')
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-session-token']).toBeDefined();
    expect(typeof res.headers['x-session-token']).toBe('string');
    expect(res.headers['x-session-token'].length).toBeGreaterThan(20);

    // Clean up using the new token so the OR-match in invalidate still works
    await sessionService.invalidate(res.headers['x-session-token']);
  });

  it('does NOT set X-Session-Token when rotation interval has not elapsed', async () => {
    const { authMiddleware } = await import('../../src/modules/auth/auth.middleware.js');

    const app = new Koa();
    app.use(authMiddleware());
    app.use((ctx) => {
      ctx.status = 200;
      ctx.body = { ok: true };
    });

    // sessionService.create now sets rotated_at = NOW(), so the rotation interval starts
    // from session creation — the first authenticated request will not trigger rotation.
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    const res = await request(app.callback())
      .get('/')
      .set('Authorization', `Bearer ${rawToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-session-token']).toBeUndefined();

    await sessionService.invalidate(rawToken);
  });
});

// ── Lock-contention retry (FOR UPDATE NOWAIT) ─────────────────────────────────

describe('sessionService.validateAndRotate — FOR UPDATE NOWAIT retry', () => {
  /**
   * Tests that the one-retry / 50 ms backoff path is exercised correctly.
   *
   * Strategy:
   *   1. Hold a SELECT FOR UPDATE lock on the session row in a separate transaction T1.
   *   2. Concurrently call validateAndRotate — its FOR UPDATE NOWAIT will get PG error 55P03.
   *   3. The service waits 50 ms then retries.
   *   4. We release T1 after ~30 ms, so the retry (at ~50 ms) finds the row unlocked.
   *   5. validateAndRotate must succeed (no spurious 401).
   *
   * Note: requires ≥ 2 DB connections in the pool (one for T1, one for validateAndRotate).
   */
  it('succeeds after one retry when row is briefly locked by a concurrent transaction', async () => {
    const rawToken = await sessionService.create(accountId);
    const tokenHash = hashToken(rawToken);

    // Promise-based coordination: T1 signals once the lock is actually held,
    // and we signal T1 when it should release — no timing guesses needed.
    let lockAcquiredResolver, releaseLockResolver;
    const lockAcquiredPromise = new Promise((resolve) => { lockAcquiredResolver = resolve; });
    const lockReleasedPromise = new Promise((resolve) => { releaseLockResolver = resolve; });

    // T1: acquire an explicit FOR UPDATE lock and hold it until signalled
    const lockHolder = knex.transaction(async (trx) => {
      await trx.raw('SELECT id FROM sessions WHERE token_hash = ? FOR UPDATE', [tokenHash]);
      lockAcquiredResolver(); // deterministic signal: lock is now held
      await lockReleasedPromise;
      // Transaction commits here, releasing the lock
    });

    // Wait until T1 has actually acquired the lock before we trigger the race
    await lockAcquiredPromise;

    // Start validateAndRotate — first attempt will hit 55P03, retry after 50 ms
    const validatePromise = sessionService.validateAndRotate(rawToken);

    // Release the lock promptly — well before the 50 ms retry fires
    releaseLockResolver();

    const result = await validatePromise;
    await lockHolder;

    expect(result.user.id).toBe(accountId);

    await sessionService.invalidate(rawToken);
  });
});
