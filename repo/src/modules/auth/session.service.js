import { generateOpaqueToken, hashToken } from '../../common/crypto/tokens.js';
import { authConfig } from '../../config/auth.js';
import { AuthenticationError } from '../../common/errors/AppError.js';
import { authFailuresTotal } from '../../common/metrics/metrics.js';
import knex from '../../common/db/knex.js';

const { idleTimeoutMs, absoluteTimeoutMs, rotationIntervalMs, rotationGraceMs } =
  authConfig.session;

/**
 * Session service.
 * Manages opaque rotating session tokens stored in PostgreSQL.
 *
 * Security properties:
 * - Raw tokens never stored — only SHA-256 hash
 * - SELECT FOR UPDATE NOWAIT with one retry prevents spurious 401s under concurrent rotation
 * - Grace window (30s) handles concurrent requests during rotation
 * - Idle and absolute timeouts enforced at every request
 */
export const sessionService = {
  /**
   * Create a new session after successful login.
   * Returns the raw token (sent to client once — never stored).
   */
  async create(accountId, meta = {}, trx) {
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const now = new Date();
    const idleExpires = new Date(now.getTime() + idleTimeoutMs);
    const absoluteExpires = new Date(now.getTime() + absoluteTimeoutMs);

    await (trx || knex)('sessions').insert({
      account_id: accountId,
      token_hash: tokenHash,
      idle_expires_at: idleExpires.toISOString(),
      absolute_expires_at: absoluteExpires.toISOString(),
      // Set rotated_at to now so the rotation interval is measured from session creation,
      // not from null (which would cause Infinity > interval → immediate first-request rotation).
      rotated_at: now.toISOString(),
      ip_address: meta.ipAddress || null,
      user_agent: meta.userAgent || null,
    });

    return rawToken;
  },

  /**
   * Validate a session token and rotate if needed.
   * Uses SELECT FOR UPDATE NOWAIT with one retry to handle transient lock contention.
   *
   * Returns { user, newToken } where newToken is only set if rotation occurred.
   * The caller should send newToken in X-Session-Token response header.
   */
  async validateAndRotate(rawToken) {
    const tokenHash = hashToken(rawToken);
    const now = new Date();

    // Use FOR UPDATE NOWAIT with one retry to handle transient lock contention.
    // The retry must start a fresh transaction because a 55P03 error aborts
    // the current transaction in PostgreSQL.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // SKIP LOCKED can silently miss a locked row and return null, causing spurious 401s
        // when two concurrent requests arrive during a rotation window.
        return await knex.transaction(async (trx) => {
          const session = await trx.raw(
            `
            SELECT s.*, a.id AS account_id, a.username, a.status AS account_status
            FROM sessions s
            JOIN accounts a ON a.id = s.account_id
            WHERE (s.token_hash = ? OR s.previous_token_hash = ?)
              AND s.invalidated_at IS NULL
              AND s.absolute_expires_at > NOW()
              AND s.idle_expires_at > NOW()
            LIMIT 1
            FOR UPDATE NOWAIT
            `,
            [tokenHash, tokenHash],
          ).then((r) => r.rows[0]);

          if (!session) {
            authFailuresTotal.inc({ reason: 'invalid_or_expired_token' });
            throw new AuthenticationError('Session not found or expired');
          }

          if (session.account_status !== 'active') {
            authFailuresTotal.inc({ reason: 'account_inactive' });
            throw new AuthenticationError('Account is not active');
          }

          let newToken = null;
          const isUsingPreviousToken = Buffer.compare(
            Buffer.from(tokenHash),
            Buffer.from(session.previous_token_hash || Buffer.alloc(0)),
          ) === 0;

          if (isUsingPreviousToken) {
            // Enforce grace window: previous token is only valid for rotationGraceMs after rotation.
            // Without this check, a stolen previous token would remain valid indefinitely.
            const rotatedAtMs = session.rotated_at ? new Date(session.rotated_at).getTime() : 0;
            if (now.getTime() - rotatedAtMs > rotationGraceMs) {
              authFailuresTotal.inc({ reason: 'grace_expired' });
              throw new AuthenticationError('Session grace window expired - please re-authenticate');
            }
            // Update last_active_at only (do not re-rotate; client must use the already-issued token)
            await trx('sessions')
              .where({ id: session.id })
              .update({
                last_active_at: now.toISOString(),
                idle_expires_at: new Date(now.getTime() + idleTimeoutMs).toISOString(),
              });
          } else {
            // Normal path: current token
            const timeSinceRotation = session.rotated_at
              ? now.getTime() - new Date(session.rotated_at).getTime()
              : Infinity;

            if (timeSinceRotation > rotationIntervalMs) {
              // Rotate token
              newToken = generateOpaqueToken();
              const newTokenHash = hashToken(newToken);

              await trx('sessions')
                .where({ id: session.id })
                .update({
                  previous_token_hash: tokenHash,
                  token_hash: newTokenHash,
                  rotated_at: now.toISOString(),
                  last_active_at: now.toISOString(),
                  idle_expires_at: new Date(now.getTime() + idleTimeoutMs).toISOString(),
                });
            } else {
              // Just update last_active_at
              await trx('sessions')
                .where({ id: session.id })
                .update({
                  last_active_at: now.toISOString(),
                  idle_expires_at: new Date(now.getTime() + idleTimeoutMs).toISOString(),
                });
            }
          }

          // Load user roles
          const roles = await trx('account_roles')
            .join('roles', 'roles.id', 'account_roles.role_id')
            .where('account_roles.account_id', session.account_id)
            .pluck('roles.name');

          return {
            user: {
              id: session.account_id,
              username: session.username,
              roles,
            },
            newToken,
          };
        });
      } catch (err) {
        // 55P03 = lock_not_available (FOR UPDATE NOWAIT); retry once with brief backoff
        if (err.code === '55P03' && attempt < 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          continue;
        }
        throw err;
      }
    }
  },

  /**
   * Invalidate a session (logout).
   */
  async invalidate(rawToken, reason = 'logout', trx) {
    const tokenHash = hashToken(rawToken);
    await (trx || knex)('sessions')
      .where(function () {
        this.where('token_hash', tokenHash).orWhere('previous_token_hash', tokenHash);
      })
      .whereNull('invalidated_at')
      .update({
        invalidated_at: new Date().toISOString(),
        invalidated_reason: reason,
      });
  },

  /**
   * Invalidate all sessions for an account (e.g., on password change).
   */
  async invalidateAll(accountId, reason = 'password_change', trx) {
    await (trx || knex)('sessions')
      .where({ account_id: accountId })
      .whereNull('invalidated_at')
      .update({
        invalidated_at: new Date().toISOString(),
        invalidated_reason: reason,
      });
  },
};

