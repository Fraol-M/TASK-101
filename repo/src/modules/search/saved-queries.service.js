import { withTransaction } from '../../common/db/transaction.js';
import { NotFoundError, ConflictError, AuthorizationError } from '../../common/errors/AppError.js';
import { searchService } from './search.service.js';
import { auditService } from '../admin/audit/audit.service.js';
import knex from '../../common/db/knex.js';

export const savedQueriesService = {
  async list(accountId, options = {}) {
    const page = Number(options.page) || 1;
    const pageSize = Math.min(Number(options.pageSize) || 20, 100);
    const q = knex('search_saved_queries')
      .where({ account_id: accountId })
      .orderBy('updated_at', 'desc');
    if (options.subscribed != null) q.where('subscribed', options.subscribed === 'true');
    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));
    const rows = await q.limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total };
  },

  async create({ accountId, name, queryText, filters = {}, subscribed = false }) {
    try {
      return await withTransaction(async (trx) => {
        const [sq] = await trx('search_saved_queries')
          .insert({ account_id: accountId, name, query_text: queryText, filters: JSON.stringify(filters), subscribed })
          .returning('*');
        await auditService.record({
          actorAccountId: accountId,
          actionType: 'saved_query.created',
          entityType: 'saved_query',
          entityId: String(sq.id),
          afterSummary: { name },
        }, trx);
        return sq;
      });
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('A saved query with this name already exists');
      throw err;
    }
  },

  async update(id, accountId, patch) {
    try {
      return await withTransaction(async (trx) => {
        const sq = await trx('search_saved_queries').where({ id }).first();
        if (!sq) throw new NotFoundError('Saved query not found');
        if (sq.account_id !== accountId) throw new AuthorizationError('Access denied');

        const update = { updated_at: new Date().toISOString() };
        // Accept both camelCase API contract field (queryText) and snake_case DB column
        if (patch.name != null) update.name = patch.name;
        if (patch.queryText != null) update.query_text = patch.queryText;
        if (patch.filters != null) update.filters = JSON.stringify(patch.filters);
        if (patch.subscribed != null) update.subscribed = patch.subscribed;

        const [updated] = await trx('search_saved_queries').where({ id }).update(update).returning('*');
        await auditService.record({
          actorAccountId: accountId,
          actionType: 'saved_query.updated',
          entityType: 'saved_query',
          entityId: String(id),
          beforeSummary: { name: sq.name },
          afterSummary: { name: updated.name },
        }, trx);
        return updated;
      });
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('A saved query with this name already exists');
      throw err;
    }
  },

  async delete(id, accountId) {
    await withTransaction(async (trx) => {
      const sq = await trx('search_saved_queries').where({ id }).first();
      if (!sq) throw new NotFoundError('Saved query not found');
      if (sq.account_id !== accountId) throw new AuthorizationError('Access denied');
      await trx('search_saved_queries').where({ id }).delete();
      await auditService.record({
        actorAccountId: accountId,
        actionType: 'saved_query.deleted',
        entityType: 'saved_query',
        entityId: String(id),
        beforeSummary: { name: sq.name },
      }, trx);
    });
  },

  /**
   * Run a saved query and update last_run_at + last_result_count.
   */
  async run(id, accountId) {
    const sq = await knex('search_saved_queries').where({ id }).first();
    if (!sq) throw new NotFoundError('Saved query not found');
    if (sq.account_id !== accountId) throw new AuthorizationError('Access denied');

    const result = await searchService.search(sq.query_text, {
      entityTypes: sq.filters?.entityTypes,
      lifecycleStatus: sq.filters?.lifecycleStatus,
      effectiveFrom: sq.filters?.effectiveFrom,
      effectiveTo: sq.filters?.effectiveTo,
      nameContains: sq.filters?.nameContains,
      descriptionContains: sq.filters?.descriptionContains,
      tags: sq.filters?.tags,
      accountId,
    });

    await knex('search_saved_queries').where({ id }).update({
      last_run_at: new Date().toISOString(),
      last_result_count: result.total,
      updated_at: new Date().toISOString(),
    });

    return result;
  },
};
