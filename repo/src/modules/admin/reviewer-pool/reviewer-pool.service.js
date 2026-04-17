import { withTransaction } from '../../../common/db/transaction.js';
import { auditService } from '../audit/audit.service.js';
import { NotFoundError, ConflictError } from '../../../common/errors/AppError.js';
import knex from '../../../common/db/knex.js';

/**
 * Reviewer pool admin service.
 * Manages the roster of reviewers available for assignment.
 */
export const reviewerPoolService = {
  async list(filters = {}, pagination = {}) {
    const page = Number(pagination.page) || 1;
    const pageSize = Math.min(Number(pagination.pageSize) || 20, 100);

    const q = knex('reviewer_profiles as rp')
      .join('accounts as a', 'a.id', 'rp.account_id')
      .select(
        'rp.id',
        'rp.account_id',
        'a.username',
        'rp.available',
        'rp.active',
        'rp.max_load',
        'rp.active_assignments',
        'rp.expertise_tags',
        'rp.created_at',
      );

    if (filters.available != null) q.where('rp.available', filters.available === 'true');
    if (filters.active != null) q.where('rp.active', filters.active === 'true');

    const total = await q.clone().clearSelect().clearOrder().count('rp.id as count').first().then((r) => Number(r.count));
    const rows = await q.orderBy('a.username').limit(pageSize).offset((page - 1) * pageSize);
    return { rows, total };
  },

  async getById(reviewerId) {
    const profile = await knex('reviewer_profiles as rp')
      .join('accounts as a', 'a.id', 'rp.account_id')
      .where('rp.id', reviewerId)
      .select('rp.*', 'a.username')
      .first();
    if (!profile) throw new NotFoundError('Reviewer profile not found');
    return profile;
  },

  async create({ accountId, maxLoad, expertiseTags }, actorId, requestId) {
    const existing = await knex('reviewer_profiles').where({ account_id: accountId }).first();
    if (existing) throw new ConflictError('Reviewer profile already exists for this account');

    return withTransaction(async (trx) => {
      const [profile] = await trx('reviewer_profiles')
        .insert({
          account_id: accountId,
          max_load: maxLoad || 10,
          expertise_tags: JSON.stringify(expertiseTags || []),
        })
        .returning('*');

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'reviewer_profile.created',
        entityType: 'reviewer_profile',
        entityId: profile.id,
        requestId,
        afterSummary: { accountId, maxLoad: profile.max_load },
      }, trx);

      return profile;
    });
  },

  async update(reviewerId, patch, actorId, requestId) {
    // Accept camelCase fields from the validated API body (consistent with POST create)
    const update = {};
    if (patch.available != null) update.available = patch.available;
    if (patch.active != null) update.active = patch.active;
    if (patch.maxLoad != null) update.max_load = patch.maxLoad;
    if (patch.expertiseTags != null) update.expertise_tags = JSON.stringify(patch.expertiseTags);
    if (!Object.keys(update).length) return this.getById(reviewerId);

    return withTransaction(async (trx) => {
      const [profile] = await trx('reviewer_profiles')
        .where({ id: reviewerId })
        .update({ ...update, updated_at: new Date().toISOString() })
        .returning('*');

      if (!profile) throw new NotFoundError('Reviewer profile not found');

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'reviewer_profile.updated',
        entityType: 'reviewer_profile',
        entityId: reviewerId,
        requestId,
        afterSummary: update,
      }, trx);

      return profile;
    });
  },

  async addInstitutionHistory({ reviewerId, universityId, role, startDate, endDate }, actorId, requestId) {
    return withTransaction(async (trx) => {
      const [entry] = await trx('reviewer_institution_history')
        .insert({
          reviewer_id: reviewerId,
          university_id: universityId,
          role,
          start_date: startDate,
          end_date: endDate || null,
          verified: false,
          declared_at: new Date().toISOString(),
        })
        .returning('*');

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'reviewer_institution_history.added',
        entityType: 'reviewer_institution_history',
        entityId: entry.id,
        requestId,
        afterSummary: { reviewerId, universityId, role },
      }, trx);

      return entry;
    });
  },
};
