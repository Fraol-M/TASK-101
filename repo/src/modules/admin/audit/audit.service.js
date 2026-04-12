import knex from '../../../common/db/knex.js';
import { maskField } from '../../../common/crypto/field-encryption.js';

/**
 * Masks all string values in a summary object using maskField().
 * Non-string values (numbers, booleans, etc.) are left as-is.
 */
function maskSummary(summary) {
  if (!summary) return null;
  const obj = typeof summary === 'string' ? JSON.parse(summary) : summary;
  const masked = {};
  for (const [k, v] of Object.entries(obj)) {
    masked[k] = typeof v === 'string' ? maskField(v) : v;
  }
  return masked;
}

/**
 * Audit service — read and write audit events.
 * The audit_events table is append-only (enforced by PostgreSQL RULEs).
 */
export const auditService = {
  /**
   * Record an audit event.
   * Called from service modules after every create/update/publish/review action.
   *
   * @param {object} event
   * @param {string} event.actorAccountId
   * @param {string} event.actionType     e.g. 'version.published', 'review.submitted'
   * @param {string} event.entityType     e.g. 'university', 'review'
   * @param {string} event.entityId
   * @param {string} event.requestId
   * @param {object} [event.beforeSummary]   Redacted before-state
   * @param {object} [event.afterSummary]    Redacted after-state
   * @param {object} [trx]  Knex transaction (MUST use the same trx as the business operation)
   */
  async record(event, trx) {
    return (trx || knex)('audit_events').insert({
      actor_account_id: event.actorAccountId,
      action_type: event.actionType,
      entity_type: event.entityType,
      entity_id: event.entityId,
      request_id: event.requestId,
      before_summary: event.beforeSummary ? JSON.stringify(event.beforeSummary) : null,
      after_summary: event.afterSummary ? JSON.stringify(event.afterSummary) : null,
    });
  },

  /**
   * Query audit events with optional filters.
   * SYSTEM_ADMIN sees full records; others see redacted summaries.
   */
  async query(filters, viewer) {
    const isAdmin = viewer.roles?.includes('SYSTEM_ADMIN');
    let q = knex('audit_events').orderBy('occurred_at', 'desc');

    if (filters.actorId) q = q.where('actor_account_id', filters.actorId);
    if (filters.entityType) q = q.where('entity_type', filters.entityType);
    if (filters.entityId) q = q.where('entity_id', filters.entityId);
    if (filters.actionType) q = q.where('action_type', 'like', `${filters.actionType}%`);
    if (filters.from) q = q.where('occurred_at', '>=', filters.from);
    if (filters.to) q = q.where('occurred_at', '<=', filters.to);

    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));

    const offset = (filters.page - 1) * filters.pageSize;
    const rows = await q.limit(filters.pageSize).offset(offset);

    const events = rows.map((row) => {
      if (isAdmin) return row;
      // Mask string values in summaries for non-admin viewers (per security-model masked-view requirement)
      return {
        ...row,
        before_summary: maskSummary(row.before_summary),
        after_summary: maskSummary(row.after_summary),
      };
    });

    return { events, total };
  },
};
