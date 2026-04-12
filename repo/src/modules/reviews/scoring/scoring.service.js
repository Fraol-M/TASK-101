import { withTransaction } from '../../../common/db/transaction.js';
import { auditService } from '../../admin/audit/audit.service.js';
import {
  NotFoundError,
  UnprocessableError,
  AuthorizationError,
} from '../../../common/errors/AppError.js';
import { reviewSubmissionsTotal } from '../../../common/metrics/metrics.js';
import knex from '../../../common/db/knex.js';

/**
 * Computes the weighted composite score from raw criterion scores.
 *
 * @param {object} criterionScores  { [criterionId]: number }
 * @param {object} criteriaSchema   Template schema with { criteria: [{ id, weight, maxScore }] }
 * @returns {number}  Composite score on a 0-10 scale
 */
/**
 * Exported for unit testing — tests should import this rather than reimplementing,
 * so any formula change stays in one place.
 */
export function computeComposite(criterionScores, criteriaSchema) {
  const criteria = criteriaSchema?.criteria ?? [];
  if (!criteria.length) return null;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const criterion of criteria) {
    const raw = criterionScores[criterion.id];
    if (raw == null) continue;
    const normalised = (raw / criterion.maxScore) * 10;
    weightedSum += normalised * criterion.weight;
    totalWeight += criterion.weight;
  }

  if (totalWeight === 0) return null;
  return Math.round((weightedSum / totalWeight) * 1000) / 1000; // 3 decimal places
}

export const scoringService = {
  /**
   * Upsert a draft score.
   * Validates that the reviewer owns the assignment and that
   * criterion IDs match the template schema.
   */
  async saveDraft({ assignmentId, criterionScores, narrativeComments, recommendation }, actorId, requestId) {
    const assignment = await knex('review_assignments')
      .where({ id: assignmentId })
      .first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Reviewer ownership check
    const reviewerProfile = await knex('reviewer_profiles')
      .where({ account_id: actorId })
      .first('id');
    const isAdmin = false; // Checked by RBAC middleware upstream
    if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
      throw new AuthorizationError('You are not assigned to this review');
    }

    if (!['assigned', 'accepted'].includes(assignment.status)) {
      throw new UnprocessableError('Assignment is not in a state that accepts scores');
    }

    // Load template for this cycle
    const template = await knex('scoring_form_templates')
      .where({ cycle_id: assignment.cycle_id, active: true })
      .first();
    if (!template) throw new NotFoundError('No active scoring template for this cycle');

    const templateCriteria = template.criteria_schema?.criteria ?? [];

    // Validate that template weights sum to 100 (guards against misconfigured templates)
    const weightSum = templateCriteria.reduce((s, c) => s + (c.weight ?? 0), 0);
    if (templateCriteria.length && Math.abs(weightSum - 100) > 0.01) {
      throw new UnprocessableError(
        `Scoring template is misconfigured: criterion weights sum to ${weightSum}, expected 100`,
      );
    }

    // Validate criterion IDs
    const validIds = new Set(templateCriteria.map((c) => c.id));
    for (const id of Object.keys(criterionScores)) {
      if (!validIds.has(id)) {
        throw new UnprocessableError(`Unknown criterion: ${id}`);
      }
    }

    const composite = computeComposite(criterionScores, template.criteria_schema);

    return withTransaction(async (trx) => {
      const [score] = await trx('review_scores')
        .insert({
          assignment_id: assignmentId,
          template_id: template.id,
          criterion_scores: JSON.stringify(criterionScores),
          composite_score: composite,
          narrative_comments: narrativeComments || null,
          recommendation: recommendation || null,
          is_draft: true,
        })
        .onConflict(['assignment_id'])
        .merge(['criterion_scores', 'composite_score', 'narrative_comments', 'recommendation', 'updated_at'])
        .returning('*');

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'review_score.draft_saved',
        entityType: 'review_score',
        entityId: score.id,
        requestId,
        afterSummary: { assignmentId, compositeScore: composite },
      }, trx);

      return score;
    });
  },

  /**
   * Submit a finalised score.
   * Transitions assignment status → 'submitted'.
   */
  async submit({ assignmentId, criterionScores, narrativeComments, recommendation }, actorId, requestId) {
    if (!recommendation) {
      throw new UnprocessableError('A recommendation is required before submitting');
    }

    const assignment = await knex('review_assignments')
      .where({ id: assignmentId })
      .first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    const reviewerProfile = await knex('reviewer_profiles')
      .where({ account_id: actorId })
      .first('id');
    if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
      throw new AuthorizationError('You are not assigned to this review');
    }

    if (!['assigned', 'accepted'].includes(assignment.status)) {
      throw new UnprocessableError('Assignment is not in a submittable state');
    }

    const template = await knex('scoring_form_templates')
      .where({ cycle_id: assignment.cycle_id, active: true })
      .first();
    if (!template) throw new NotFoundError('No active scoring template for this cycle');

    const submitCriteria = template.criteria_schema?.criteria ?? [];

    // Validate that template weights sum to 100
    const submitWeightSum = submitCriteria.reduce((s, c) => s + (c.weight ?? 0), 0);
    if (submitCriteria.length && Math.abs(submitWeightSum - 100) > 0.01) {
      throw new UnprocessableError(
        `Scoring template is misconfigured: criterion weights sum to ${submitWeightSum}, expected 100`,
      );
    }

    // All criteria must be scored before submission
    const requiredIds = submitCriteria.map((c) => c.id);
    const missing = requiredIds.filter((id) => criterionScores[id] == null);
    if (missing.length) {
      throw new UnprocessableError(
        `Missing scores for criteria: ${missing.join(', ')}`,
        missing.map((id) => ({ field: id, issue: 'required' })),
      );
    }

    const composite = computeComposite(criterionScores, template.criteria_schema);
    const now = new Date().toISOString();

    return withTransaction(async (trx) => {
      const [score] = await trx('review_scores')
        .insert({
          assignment_id: assignmentId,
          template_id: template.id,
          criterion_scores: JSON.stringify(criterionScores),
          composite_score: composite,
          narrative_comments: narrativeComments || null,
          recommendation,
          is_draft: false,
          submitted_at: now,
        })
        .onConflict(['assignment_id'])
        .merge([
          'criterion_scores',
          'composite_score',
          'narrative_comments',
          'recommendation',
          'is_draft',
          'submitted_at',
          'updated_at',
        ])
        .returning('*');

      // Transition assignment status
      await trx('review_assignments')
        .where({ id: assignmentId })
        .update({ status: 'submitted', submitted_at: now });

      // Decrement reviewer active load
      await trx('reviewer_profiles')
        .where({ id: reviewerProfile.id })
        .decrement('active_assignments', 1);

      await auditService.record({
        actorAccountId: actorId,
        actionType: 'review_score.submitted',
        entityType: 'review_score',
        entityId: score.id,
        requestId,
        afterSummary: {
          assignmentId,
          compositeScore: composite,
          recommendation,
        },
      }, trx);

      reviewSubmissionsTotal.inc({ status: 'success' });
      return score;
    });
  },

  async getByAssignment(assignmentId, actor) {
    const assignment = await knex('review_assignments').where({ id: assignmentId }).first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    const isAdmin = actor.roles?.includes('SYSTEM_ADMIN') || actor.roles?.includes('PROGRAM_ADMIN');
    if (!isAdmin) {
      // Non-admins must be the assigned reviewer
      const reviewerProfile = await knex('reviewer_profiles')
        .where({ account_id: actor.id })
        .first('id');
      if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
        throw new AuthorizationError('You are not assigned to this review');
      }
    }

    const score = await knex('review_scores').where({ assignment_id: assignmentId }).first();
    if (!score) throw new NotFoundError('No score found for this assignment');
    return score;
  },
};
