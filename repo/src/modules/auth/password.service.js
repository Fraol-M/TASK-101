import bcrypt from 'bcrypt';
import { authConfig } from '../../config/auth.js';
import { UnprocessableError } from '../../common/errors/AppError.js';
import knex from '../../common/db/knex.js';

const { saltRounds, minLength, minClassCount, historyCount } = authConfig.password;

/**
 * Password service.
 * Handles hashing, complexity validation, and history enforcement.
 */
export const passwordService = {
  /**
   * Hash a plaintext password using bcrypt.
   * Note: bcrypt at cost 12 takes ~300ms. This is intentional and documented.
   */
  async hash(plaintext) {
    return bcrypt.hash(plaintext, saltRounds);
  },

  /**
   * Verify a plaintext password against a stored hash.
   */
  async verify(plaintext, hash) {
    return bcrypt.compare(plaintext, hash);
  },

  /**
   * Validate password complexity.
   * Rules: 12+ chars, at least 3 of 4 classes (upper/lower/digit/symbol)
   * Throws UnprocessableError if invalid.
   */
  validateComplexity(password) {
    if (typeof password !== 'string' || password.length < minLength) {
      throw new UnprocessableError(
        `Password must be at least ${minLength} characters`,
        [{ field: 'password', issue: `minimum_length_${minLength}` }],
      );
    }

    const classes = [
      /[A-Z]/.test(password),  // uppercase
      /[a-z]/.test(password),  // lowercase
      /[0-9]/.test(password),  // digit
      /[^A-Za-z0-9]/.test(password),  // symbol
    ];

    const classCount = classes.filter(Boolean).length;
    if (classCount < minClassCount) {
      throw new UnprocessableError(
        `Password must contain at least ${minClassCount} of: uppercase, lowercase, digit, symbol`,
        [{ field: 'password', issue: 'insufficient_character_classes' }],
      );
    }
  },

  /**
   * Check that the new password is not in the last N password hashes.
   * Throws UnprocessableError if the password was recently used.
   * @param {string} accountId
   * @param {string} newPlaintext
   * @param {object} [trx]
   */
  async enforceHistory(accountId, newPlaintext, trx) {
    const history = await (trx || knex)('account_password_history')
      .where({ account_id: accountId })
      .orderBy('created_at', 'desc')
      .limit(historyCount)
      .select('password_hash');

    // Also check the current password
    const account = await (trx || knex)('accounts')
      .where({ id: accountId })
      .first('password_hash');

    const allHashes = [
      ...(account ? [account.password_hash] : []),
      ...history.map((h) => h.password_hash),
    ];

    for (const hash of allHashes) {
      const matches = await bcrypt.compare(newPlaintext, hash);
      if (matches) {
        throw new UnprocessableError(
          `Password was recently used. Choose a different password.`,
          [{ field: 'password', issue: 'recently_used' }],
        );
      }
    }
  },

  /**
   * Store current password hash in history before changing it.
   * Trims history to last N entries.
   * @param {string} accountId
   * @param {string} currentHash
   * @param {object} [trx]
   */
  async archiveCurrentPassword(accountId, currentHash, trx) {
    await (trx || knex)('account_password_history').insert({
      account_id: accountId,
      password_hash: currentHash,
    });

    // Keep only the last historyCount entries
    const toDelete = await (trx || knex)('account_password_history')
      .where({ account_id: accountId })
      .orderBy('created_at', 'desc')
      .offset(historyCount)
      .select('id');

    if (toDelete.length > 0) {
      await (trx || knex)('account_password_history')
        .whereIn('id', toDelete.map((r) => r.id))
        .delete();
    }
  },
};
