import { randomBytes } from 'crypto';
import { withTransaction } from '../../../common/db/transaction.js';
import { coiService } from './coi.service.js';
import { auditService } from '../../admin/audit/audit.service.js';
import { UnprocessableError, NotFoundError, ConflictError } from '../../../common/errors/AppError.js';
import { reviewPolicies } from '../../../config/review-policies.js';
import knex from '../../../common/db/knex.js';

/**
 * Fisher-Yates shuffle using crypto.getRandomValues() for cryptographic randomness.
 * Required for blind review integrity.
 */
function secureShuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const bytes = randomBytes(4);
    const j = Math.floor((bytes.readUInt32BE(0) / 0xFFFFFFFF) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const assignmentService = {
  /**
   * Create a single assignment (manual or direct).
   */
  async create({ applicationId, reviewerId, cycleId, mode, blindMode, assignedBy, dueAt }, requestId) {
    // Validate application and reviewer exist
    const [app, reviewer] = await Promise.all([
      knex('applications').where({ id: applicationId }).first(),
      knex('reviewer_profiles').where({ id: reviewerId }).first(),
    ]);
    if (!app) throw new NotFoundError('Application not found');
    if (!reviewer) throw new NotFoundError('Reviewer not found');
    if (!reviewer.active || !reviewer.available) {
      throw new UnprocessableError('Reviewer is not available for assignment');
    }
    if (reviewer.active_assignments >= reviewer.max_load) {
      throw new UnprocessableError('Reviewer has reached maximum assignment load');
    }

    // Derive cycle_id from the application record — never trust the client value
    const resolvedCycleId = app.cycle_id;
    if (!resolvedCycleId) throw new UnprocessableError('Application is not associated with a review cycle');
    if (cycleId && cycleId !== resolvedCycleId) {
      throw new UnprocessableError(
        'Supplied cycleId does not match the application\'s review cycle',
      );
    }

    const { hasConflict, reasons } = await coiService.checkConflict(reviewerId, applicationId);
    await coiService.recordCheck({
      reviewerId, applicationId, hasConflict, reasons, checkedBy: assignedBy,
    });

    if (hasConflict) {
      throw new UnprocessableError(
        'Assignment blocked due to conflict of interest',
        reasons.map((r) => ({ field: 'reviewer', issue: r.detail })),
      );
    }

    return withTransaction(async (trx) => {
      let assignment;
      try {
        [assignment] = await trx('review_assignments')
          .insert({
            application_id: applicationId,
            reviewer_id: reviewerId,
            cycle_id: resolvedCycleId,
            assignment_mode: mode || 'manual',
            blind_mode: blindMode || 'blind',
            assigned_by: assignedBy,
            due_at: dueAt || null,
          })
          .returning('*');
      } catch (err) {
        if (err.code === '23505') {
          throw new ConflictError(
            'A review assignment for this application, reviewer, and cycle already exists',
          );
        }
        throw err;
      }

      // Update reviewer load counter
      await trx('reviewer_profiles')
        .where({ id: reviewerId })
        .increment('active_assignments', 1);

      await auditService.record({
        actorAccountId: assignedBy,
        actionType: 'review_assignment.created',
        entityType: 'review_assignment',
        entityId: assignment.id,
        requestId,
        afterSummary: { applicationId, reviewerId, mode: assignment.assignment_mode },
      }, trx);

      return assignment;
    });
  },

  /**
   * Batch assignment — randomly or by rules.
   * Assigns the minimum required number of reviewers to each application,
   * filtered by COI and load balance.
   *
   * @param {object} params
   * @param {string[]} params.applicationIds
   * @param {string} params.cycleId
   * @param {string} params.mode  'random' | 'rule_based'
   * @param {string} params.blindMode
   * @param {number} params.reviewersPerApplication
   * @param {string} params.assignedBy  Actor account ID
   */
  async batchAssign({ applicationIds, cycleId, mode, blindMode, reviewersPerApplication, assignedBy }, requestId) {
    const minReviewers = reviewersPerApplication || reviewPolicies.assignment.minReviewersPerApplication;

    // Load all applications to derive cycle_id server-side
    const applications = await knex('applications')
      .whereIn('id', applicationIds)
      .select('id', 'cycle_id');

    const foundIds = new Set(applications.map((a) => a.id));
    const missing = applicationIds.filter((id) => !foundIds.has(id));
    if (missing.length) throw new NotFoundError(`Applications not found: ${missing.join(', ')}`);

    // Build per-application cycle_id map and validate all belong to the same cycle
    const appCycleMap = new Map(applications.map((a) => [a.id, a.cycle_id]));
    const distinctCycles = new Set(applications.map((a) => a.cycle_id).filter(Boolean));
    if (distinctCycles.size === 0) throw new UnprocessableError('Applications are not associated with any review cycle');
    if (distinctCycles.size > 1) {
      throw new UnprocessableError('All applications in a batch must belong to the same review cycle');
    }
    const resolvedCycleId = [...distinctCycles][0];

    // If client supplied cycleId, validate it matches
    if (cycleId && cycleId !== resolvedCycleId) {
      throw new UnprocessableError(
        'Supplied cycleId does not match the applications\' review cycle',
      );
    }

    // Load eligible reviewers
    const eligibleReviewers = await knex('reviewer_profiles')
      .where({ available: true, active: true })
      .whereRaw('active_assignments < max_load')
      .select('id', 'expertise_tags', 'max_load', 'active_assignments');

    if (eligibleReviewers.length === 0) {
      throw new UnprocessableError('No eligible reviewers available for assignment');
    }

    // ── Rule-based: rank reviewers by expertise match per application ─────────
    // ── Random: shuffle pool once and apply uniformly ─────────────────────────
    let reviewerOrderByApp = null; // Map<appId, reviewer[]> — only set for rule_based

    if (mode === 'rule_based') {
      // Load the program choices (major→field) for each application so we can
      // match against reviewer expertise_tags.
      const programRows = await knex('application_program_choices as apc')
        .join('major_versions as mv', function () {
          this.on('mv.major_id', '=', 'apc.major_id').andOn(
            'mv.lifecycle_status', '=', knex.raw("'active'"),
          );
        })
        .whereIn('apc.application_id', applicationIds)
        .select(
          'apc.application_id',
          knex.raw("LOWER(mv.payload_json->>'name') AS program_name"),
          knex.raw("LOWER(mv.payload_json->>'field') AS program_field"),
        );

      // Build per-application keyword set
      const appKeywords = new Map(applicationIds.map((id) => [id, new Set()]));
      for (const row of programRows) {
        const kw = appKeywords.get(row.application_id);
        if (kw) {
          if (row.program_name) kw.add(row.program_name);
          if (row.program_field) kw.add(row.program_field);
        }
      }

      // Score reviewers per application
      reviewerOrderByApp = new Map();
      for (const appId of applicationIds) {
        const keywords = appKeywords.get(appId) || new Set();
        const scored = eligibleReviewers.map((r) => {
          const tags = (r.expertise_tags || []).map((t) => String(t).toLowerCase());
          const matchCount = tags.filter((t) => keywords.has(t)).length;
          // Secondary sort: prefer reviewers with more available capacity
          const capacity = r.max_load - r.active_assignments;
          return { reviewer: r, matchCount, capacity };
        });
        // Sort: most expertise matches first, then most available capacity
        scored.sort((a, b) => b.matchCount - a.matchCount || b.capacity - a.capacity);
        reviewerOrderByApp.set(appId, scored.map((s) => s.reviewer));
      }
    }

    const shuffledReviewers = secureShuffle(eligibleReviewers);

    // Build candidate pairs for batch COI check
    const candidatePairs = [];
    for (const appId of applicationIds) {
      const reviewerList = reviewerOrderByApp ? reviewerOrderByApp.get(appId) : shuffledReviewers;
      for (const reviewer of (reviewerList || shuffledReviewers)) {
        candidatePairs.push({ reviewerId: reviewer.id, applicationId: appId });
      }
    }

    // Batch COI check — returns set of conflicted pairs
    const conflictedPairs = await coiService.batchCheck(candidatePairs);

    // Filter valid assignments per application.
    // reservedCounts tracks how many assignments have been planned for each reviewer
    // within this batch so we don't exceed max_load across multiple applications.
    const assignments = [];
    const errors = [];
    const reservedCounts = new Map();

    for (const appId of applicationIds) {
      const orderedReviewers = reviewerOrderByApp
        ? (reviewerOrderByApp.get(appId) || shuffledReviewers)
        : shuffledReviewers;

      const validReviewers = orderedReviewers.filter(
        (r) =>
          !conflictedPairs.has(`${r.id}:${appId}`) &&
          r.active_assignments + (reservedCounts.get(r.id) || 0) < r.max_load,
      );

      if (validReviewers.length < minReviewers) {
        errors.push({ applicationId: appId, issue: 'Insufficient eligible reviewers after COI filtering' });
        continue;
      }

      for (const reviewer of validReviewers.slice(0, minReviewers)) {
        assignments.push({
          application_id: appId,
          reviewer_id: reviewer.id,
          cycle_id: appCycleMap.get(appId) || resolvedCycleId,
          assignment_mode: mode || 'random',
          blind_mode: blindMode || 'blind',
          assigned_by: assignedBy,
        });
        // Reserve capacity so subsequent applications in this batch see the updated load
        reservedCounts.set(reviewer.id, (reservedCounts.get(reviewer.id) || 0) + 1);
      }
    }

    if (assignments.length === 0) {
      throw new UnprocessableError('No valid assignments could be created', errors);
    }

    return withTransaction(async (trx) => {
      const created = await trx('review_assignments')
        .insert(assignments)
        .onConflict(['application_id', 'reviewer_id', 'cycle_id'])
        .ignore()
        .returning('*');

      // Update reviewer load counters
      const reviewerCounts = {};
      for (const a of created) {
        reviewerCounts[a.reviewer_id] = (reviewerCounts[a.reviewer_id] || 0) + 1;
      }
      for (const [reviewerId, count] of Object.entries(reviewerCounts)) {
        await trx('reviewer_profiles')
          .where({ id: reviewerId })
          .increment('active_assignments', count);
      }

      await auditService.record({
        actorAccountId: assignedBy,
        actionType: 'review_assignment.batch_created',
        entityType: 'review_assignment',
        entityId: resolvedCycleId,
        requestId,
        afterSummary: { count: created.length, mode, errors: errors.length },
      }, trx);

      return { created, errors };
    });
  },

  async getById(assignmentId, viewer) {
    const assignment = await knex('review_assignments').where({ id: assignmentId }).first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Object-level check: reviewers can only see their own assignments
    const isAdmin = viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');
    if (!isAdmin) {
      const reviewerProfile = await knex('reviewer_profiles')
        .where({ account_id: viewer.id })
        .first('id');
      if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
        throw new NotFoundError('Assignment not found'); // Use 404 to avoid information leak
      }
    }

    return assignment;
  },

  async list(filters, viewer) {
    const isAdmin = viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');
    let q = knex('review_assignments').orderBy('assigned_at', 'desc');

    if (!isAdmin) {
      const reviewerProfile = await knex('reviewer_profiles')
        .where({ account_id: viewer.id })
        .first('id');
      if (!reviewerProfile) return { rows: [], total: 0 };
      q = q.where('reviewer_id', reviewerProfile.id);
    }

    if (filters.cycleId) q = q.where('cycle_id', filters.cycleId);
    if (filters.status) q = q.where('status', filters.status);

    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));
    const page = Number(filters.page) || 1;
    const pageSize = Math.min(Number(filters.pageSize) || 20, 100);
    const rows = await q.limit(pageSize).offset((page - 1) * pageSize);

    return { rows, total };
  },
};
