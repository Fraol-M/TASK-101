import { withTransaction } from '../../common/db/transaction.js';
import { auditService } from '../admin/audit/audit.service.js';
import { NotFoundError, UnprocessableError } from '../../common/errors/AppError.js';
import { reviewPolicies } from '../../config/review-policies.js';
import { secondPassEscalationsTotal } from '../../common/metrics/metrics.js';
import knex from '../../common/db/knex.js';

const { trimEnabled, trimPercent, trimMinCount, varianceThreshold } = reviewPolicies.aggregation;

/**
 * Compute the trimmed mean of an array of numbers.
 * Removes the top and bottom `trimPercent`% of values before averaging.
 * Returns null if fewer than `trimMinCount` scores are present.
 *
 * Exported for unit testing — tests should import this function rather than
 * reimplementing the algorithm, so any future change stays in one place.
 *
 * @param {number[]} scores
 * @returns {number|null}
 */
export function trimmedMean(scores) {
  if (!trimEnabled || scores.length < trimMinCount) {
    // Fall back to plain mean
    if (!scores.length) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  const sorted = [...scores].sort((a, b) => a - b);
  // Guarantee at least 1 score trimmed from each end once trimMinCount is reached.
  // Without the Math.max(1, ...) guard, floor(10% × 7) = 0 and no trimming occurs
  // at exactly the threshold count, defeating the outlier-removal intent.
  const trimCount = Math.max(1, Math.floor((trimPercent / 100) * sorted.length));
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  if (!trimmed.length) return null;
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}

/**
 * Compute variance of an array.
 * Exported for unit testing — same rationale as trimmedMean above.
 */
export function variance(scores, mean) {
  if (scores.length < 2) return 0;
  const squareDiffs = scores.map((s) => Math.pow(s - mean, 2));
  return squareDiffs.reduce((a, b) => a + b, 0) / scores.length;
}

export const aggregationService = {
  /**
   * Aggregate scores for all applications in a cycle.
   * Idempotent — upserts into application_score_aggregates.
   *
   * @param {string} cycleId
   * @param {string} actorId
   * @param {string} requestId
   */
  async aggregateCycle(cycleId, actorId, requestId) {
    // Fetch all submitted scores for the cycle in one query
    const rows = await knex('review_scores as rs')
      .join('review_assignments as ra', 'ra.id', 'rs.assignment_id')
      .join('applications as a', 'a.id', 'ra.application_id')
      .where('a.cycle_id', cycleId)
      .where('rs.is_draft', false)
      .select(
        'a.id as application_id',
        'rs.composite_score',
        'rs.recommendation',
      );

    if (!rows.length) return { aggregated: 0 };

    // Group by application
    const byApp = new Map();
    for (const row of rows) {
      if (!byApp.has(row.application_id)) {
        byApp.set(row.application_id, { scores: [], recommendations: {} });
      }
      const entry = byApp.get(row.application_id);
      if (row.composite_score != null) entry.scores.push(Number(row.composite_score));
      entry.recommendations[row.recommendation] =
        (entry.recommendations[row.recommendation] || 0) + 1;
    }

    const aggregates = [];
    for (const [applicationId, { scores, recommendations }] of byApp) {
      const mean = scores.length
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : null;
      const trimmed = trimmedMean(scores);
      const scoreVariance = mean != null ? variance(scores, mean) : 0;
      const stddev = Math.sqrt(scoreVariance);
      const highVariance = stddev > varianceThreshold;

      aggregates.push({
        application_id: applicationId,
        cycle_id: cycleId,
        reviewer_count: scores.length,
        mean_score: mean != null ? Math.round(mean * 1000) / 1000 : null,
        trimmed_mean_score: trimmed != null ? Math.round(trimmed * 1000) / 1000 : null,
        score_variance: Math.round(scoreVariance * 10000) / 10000,
        recommendation_counts: JSON.stringify(recommendations),
        high_variance_flag: highVariance,
        escalation_flag: highVariance,
        escalation_reason: highVariance
          ? `Score stddev ${stddev.toFixed(4)} exceeds threshold ${varianceThreshold}`
          : null,
        computed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    const highVarianceApps = aggregates.filter((a) => a.high_variance_flag);

    await withTransaction(async (trx) => {
      // Upsert all aggregates in chunks of 100
      const chunkSize = 100;
      for (let i = 0; i < aggregates.length; i += chunkSize) {
        const chunk = aggregates.slice(i, i + chunkSize);
        await trx('application_score_aggregates')
          .insert(chunk)
          .onConflict(['application_id'])
          .merge([
            'reviewer_count', 'mean_score', 'trimmed_mean_score', 'score_variance',
            'recommendation_counts', 'high_variance_flag', 'escalation_flag',
            'escalation_reason', 'computed_at', 'updated_at',
          ]);
      }

      // Auto-create escalation events for high-variance applications.
      // Skip if an identical high_variance escalation already exists for this cycle
      // (aggregateCycle is idempotent — re-running must not duplicate events).
      for (const agg of highVarianceApps) {
        const existing = await trx('escalation_events')
          .where({
            application_id: agg.application_id,
            cycle_id: cycleId,
            trigger: 'high_variance',
          })
          .first();

        if (!existing) {
          await trx('escalation_events').insert({
            application_id: agg.application_id,
            cycle_id: cycleId,
            trigger: 'high_variance',
            notes: agg.escalation_reason,
            created_by: actorId,
          });
          secondPassEscalationsTotal.inc({ trigger: 'high_variance' });
        }
      }

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'aggregation.cycle_computed',
        entityType: 'application_cycle',
        entityId: cycleId,
        requestId,
        afterSummary: { aggregated: aggregates.length, escalated: highVarianceApps.length, cycleId },
      }, trx);
    });

    return { aggregated: aggregates.length, escalated: highVarianceApps.length };
  },

  /**
   * Compute and store rankings for a cycle.
   * Must be called after aggregateCycle().
   * Rankings are ordered by trimmed_mean_score DESC, then submitted_at ASC.
   */
  async rankCycle(cycleId, actorId, requestId) {
    const ranked = await knex('application_score_aggregates as agg')
      .join('applications as a', 'a.id', 'agg.application_id')
      .where('agg.cycle_id', cycleId)
      .whereNotNull('agg.trimmed_mean_score')
      .orderBy('agg.trimmed_mean_score', 'desc')
      .orderBy('a.research_fit_score', 'desc')
      .orderBy('a.submitted_at', 'asc')
      .select('agg.application_id');

    await withTransaction(async (trx) => {
      for (let i = 0; i < ranked.length; i++) {
        await trx('application_score_aggregates')
          .where({ application_id: ranked[i].application_id })
          .update({ rank: i + 1, updated_at: new Date().toISOString() });
      }

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'ranking.cycle_computed',
        entityType: 'application_cycle',
        entityId: cycleId,
        requestId,
        afterSummary: { ranked: ranked.length, cycleId },
      }, trx);
    });

    return { ranked: ranked.length };
  },

  /**
   * Get the ranked list for a cycle.
   */
  async getRankings(cycleId, filters = {}) {
    const q = knex('application_score_aggregates as agg')
      .where('agg.cycle_id', cycleId)
      .orderBy('agg.rank', 'asc')
      .select(
        'agg.application_id',
        'agg.rank',
        'agg.mean_score',
        'agg.trimmed_mean_score',
        'agg.reviewer_count',
        'agg.recommendation_counts',
        'agg.high_variance_flag',
        'agg.escalation_flag',
        'agg.computed_at',
      );

    if (filters.escalationOnly) {
      q.where('agg.escalation_flag', true);
    }

    const page = Number(filters.page) || 1;
    const pageSize = Math.min(Number(filters.pageSize) || 50, 200);
    const total = await q.clone().count('agg.application_id as count').first().then((r) => Number(r.count));
    const rows = await q.limit(pageSize).offset((page - 1) * pageSize);

    return { rows, total };
  },

  /**
   * Create a manual escalation event.
   * Validates that the application belongs to the given cycle before inserting.
   */
  async escalate({ applicationId, cycleId, trigger, notes }, actorId, requestId) {
    return withTransaction(async (trx) => {
      // Server-side integrity: verify the application exists and belongs to the given cycle.
      // Accepting client-supplied cycleId without validation can corrupt audit/reporting.
      const app = await trx('applications').where({ id: applicationId }).first('cycle_id');
      if (!app) throw new NotFoundError('Application not found');
      if (app.cycle_id !== cycleId) {
        throw new UnprocessableError('Application does not belong to the specified cycle');
      }

      const [event] = await trx('escalation_events')
        .insert({
          application_id: applicationId,
          cycle_id: cycleId,
          trigger: trigger || 'manual',
          notes: notes || null,
          created_by: actorId,
        })
        .returning('*');

      await trx('application_score_aggregates')
        .where({ application_id: applicationId })
        .update({ escalation_flag: true, escalation_reason: notes || 'Manual escalation', updated_at: new Date().toISOString() });

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'escalation.created',
        entityType: 'application',
        entityId: applicationId,
        requestId,
        afterSummary: { trigger, cycleId },
      }, trx);

      secondPassEscalationsTotal.inc({ trigger: trigger || 'manual' });

      return event;
    });
  },
};
