import { passwordService } from './password.service.js';
import { sessionService } from './session.service.js';
import { withTransaction } from '../../common/db/transaction.js';
import { AuthenticationError } from '../../common/errors/AppError.js';
import { authFailuresTotal } from '../../common/metrics/metrics.js';
import knex from '../../common/db/knex.js';

export const authService = {
  /**
   * Authenticate a user with username + password.
   * Returns a new session token on success.
   */
  async login(username, password, meta = {}) {
    const account = await knex('accounts')
      .where({ username })
      .first('id', 'password_hash', 'status');

    if (!account) {
      authFailuresTotal.inc({ reason: 'unknown_username' });
      // Use timing-safe path: compare against a precomputed valid bcrypt hash so the
      // bcrypt work-factor delay is identical to the known-user path.
      // This hash does not correspond to any real credential.
      await passwordService.verify('__dummy__', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2');
      throw new AuthenticationError('Invalid username or password');
    }

    if (account.status !== 'active') {
      authFailuresTotal.inc({ reason: 'account_inactive' });
      throw new AuthenticationError('Account is not active');
    }

    const valid = await passwordService.verify(password, account.password_hash);
    if (!valid) {
      authFailuresTotal.inc({ reason: 'wrong_password' });
      throw new AuthenticationError('Invalid username or password');
    }

    const rawToken = await sessionService.create(account.id, meta);
    return { token: rawToken, accountId: account.id };
  },

  /**
   * Logout — invalidate the current session.
   */
  async logout(rawToken) {
    await sessionService.invalidate(rawToken);
  },

  /**
   * Change password for authenticated user.
   * Validates complexity, enforces history, rotates all sessions.
   */
  async rotatePassword(accountId, currentPassword, newPassword, trx) {
    const account = await (trx || knex)('accounts')
      .where({ id: accountId })
      .first('id', 'password_hash');

    const valid = await passwordService.verify(currentPassword, account.password_hash);
    if (!valid) {
      throw new AuthenticationError('Current password is incorrect');
    }

    passwordService.validateComplexity(newPassword);
    await passwordService.enforceHistory(accountId, newPassword, trx);

    const newHash = await passwordService.hash(newPassword);

    await withTransaction(async (innerTrx) => {
      await passwordService.archiveCurrentPassword(accountId, account.password_hash, innerTrx);
      await innerTrx('accounts').where({ id: accountId }).update({
        password_hash: newHash,
        password_last_rotated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      // Invalidate all existing sessions for security
      await sessionService.invalidateAll(accountId, 'password_change', innerTrx);
    });
  },
};
