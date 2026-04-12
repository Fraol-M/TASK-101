import { passwordService } from '../auth/password.service.js';
import { withTransaction } from '../../common/db/transaction.js';
import { NotFoundError, ConflictError } from '../../common/errors/AppError.js';
import { encrypt } from '../../common/crypto/field-encryption.js';
import { auditService } from '../admin/audit/audit.service.js';
import knex from '../../common/db/knex.js';

export const accountService = {
  async getById(accountId) {
    const account = await knex('accounts')
      .where({ id: accountId })
      .first('id', 'username', 'status', 'password_last_rotated_at', 'created_at');
    if (!account) throw new NotFoundError('Account not found');
    return account;
  },

  async create({ username, password, email, displayName }, actorAccountId, requestId) {
    passwordService.validateComplexity(password);

    const existing = await knex('accounts').where({ username }).first('id');
    if (existing) throw new ConflictError('Username already taken');

    const passwordHash = await passwordService.hash(password);

    return withTransaction(async (trx) => {
      const [account] = await trx('accounts')
        .insert({
          username,
          password_hash: passwordHash,
          email_encrypted: email ? encrypt(email) : null,
          display_name_encrypted: displayName ? encrypt(displayName) : null,
        })
        .returning('id', 'username', 'status', 'created_at');

      await auditService.record({
        actorAccountId,
        actionType: 'account.created',
        entityType: 'account',
        entityId: account.id,
        requestId,
        afterSummary: { username: account.username },
      }, trx);

      return account;
    });
  },

  async updateStatus(accountId, status, actorAccountId, requestId, trx) {
    const before = await (trx || knex)('accounts').where({ id: accountId }).first('status');
    const [account] = await (trx || knex)('accounts')
      .where({ id: accountId })
      .update({ status, updated_at: new Date().toISOString() })
      .returning('id', 'username', 'status');
    if (!account) throw new NotFoundError('Account not found');

    await auditService.record({
      actorAccountId,
      actionType: 'account.status_updated',
      entityType: 'account',
      entityId: accountId,
      requestId,
      beforeSummary: { status: before?.status },
      afterSummary: { status },
    }, trx);

    return account;
  },
};
