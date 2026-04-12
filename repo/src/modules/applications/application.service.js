import { withTransaction } from '../../common/db/transaction.js';
import { NotFoundError, AuthorizationError } from '../../common/errors/AppError.js';
import { auditService } from '../admin/audit/audit.service.js';
import knex from '../../common/db/knex.js';

export const applicationService = {
  async create(data, actorId, requestId) {
    return withTransaction(async (trx) => {
      const [app] = await trx('applications')
        .insert({
          cycle_id: data.cycleId,
          account_id: actorId,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .returning('*');

      if (data.programChoices?.length) {
        await trx('application_program_choices').insert(
          data.programChoices.map((c) => ({
            application_id: app.id,
            major_id: c.majorId,
            preference_order: c.preferenceOrder,
          })),
        );
      }

      if (data.institutionHistory?.length) {
        await trx('application_institution_history').insert(
          data.institutionHistory.map((h) => ({
            application_id: app.id,
            university_id: h.universityId,
            role: h.role,
            start_date: h.startDate,
            end_date: h.endDate || null,
          })),
        );
      }

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'application.created',
        entityType: 'application',
        entityId: app.id,
        requestId,
      }, trx);

      return app;
    });
  },

  async getById(applicationId, viewer) {
    const app = await knex('applications').where({ id: applicationId }).first();
    if (!app) throw new NotFoundError('Application not found');

    // Applicants can only see their own applications
    const isAdmin = viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');
    if (!isAdmin && app.account_id !== viewer.id) {
      throw new AuthorizationError('Access denied');
    }
    return app;
  },

  async list(viewer, filters = {}) {
    const isAdmin = viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');
    let q = knex('applications');

    if (!isAdmin) {
      q = q.where('account_id', viewer.id);
    }

    if (filters.cycleId) q = q.where('cycle_id', filters.cycleId);

    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));
    const page = Number(filters.page) || 1;
    const pageSize = Math.min(Number(filters.pageSize) || 20, 100);
    const rows = await q
      .clone()
      .orderBy('submitted_at', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { rows, total };
  },
};
