import knex from '../../../common/db/knex.js';
import { NotFoundError, AuthorizationError } from '../../../common/errors/AppError.js';
import { getColumnsForMode, resolveMode, projectRow } from '../blind-modes/projection.service.js';

/**
 * Review workbench service.
 *
 * Provides reviewers a "workbench view" of an assignment — the application
 * data they are permitted to see according to the assignment's blind mode.
 *
 * Column-level selection happens BEFORE the query.
 * Identity data is never fetched in blind/semi_blind mode.
 */
export const workbenchService = {
  /**
   * Get the workbench view for a specific assignment.
   * The returned data is shaped according to the assignment's blind mode.
   *
   * @param {string} assignmentId
   * @param {object} viewer  { id, roles }
   */
  async getWorkbench(assignmentId, viewer) {
    // Step 1: load assignment (no application data yet)
    const assignment = await knex('review_assignments')
      .where({ id: assignmentId })
      .first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    // Step 2: object-level access check
    const isAdmin =
      viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');

    if (!isAdmin) {
      const reviewerProfile = await knex('reviewer_profiles')
        .where({ account_id: viewer.id })
        .first('id');
      if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
        throw new NotFoundError('Assignment not found');
      }
    }

    // Step 3: resolve blind mode and select only permitted columns
    const mode = resolveMode(assignment, viewer);
    const columns = getColumnsForMode(mode);

    // Step 4: fetch application data with column-level selection
    const applicationData = await knex('review_assignments as ra')
      .join('applications as a', 'a.id', 'ra.application_id')
      .where('ra.id', assignmentId)
      .select(columns)
      .first();

    // Step 5: belt-and-suspenders projection (strips any identity fields that
    //         slipped through due to a future column addition)
    const safeData = projectRow(applicationData, mode);

    // Step 6: attach program choices (always safe — no personal data)
    const programChoices = await knex('application_program_choices as apc')
      .join('major_versions as mv', (join) => {
        join
          .on('mv.major_id', 'apc.major_id')
          .andOn(
            knex.raw("mv.lifecycle_status = 'active'"),
          );
      })
      .where('apc.application_id', assignment.application_id)
      .select(
        'apc.major_id',
        'apc.preference_order',
        knex.raw("mv.payload_json->>'name' as major_name"),
      )
      .orderBy('apc.preference_order');

    return {
      assignment,
      blindMode: mode,
      applicationData: safeData,
      programChoices,
    };
  },

  /**
   * List all pending assignments for the authenticated reviewer.
   */
  async listMyAssignments(viewer, filters = {}) {
    const reviewerProfile = await knex('reviewer_profiles')
      .where({ account_id: viewer.id })
      .first('id');
    if (!reviewerProfile) return { rows: [], total: 0 };

    const q = knex('review_assignments')
      .where({ reviewer_id: reviewerProfile.id })
      .whereIn('status', ['assigned', 'accepted'])
      .orderBy('assigned_at', 'asc');

    if (filters.cycleId) q.where('cycle_id', filters.cycleId);

    const total = await q.clone().count('id as count').first().then((r) => Number(r.count));
    const page = Number(filters.page) || 1;
    const pageSize = Math.min(Number(filters.pageSize) || 20, 100);
    const rows = await q.limit(pageSize).offset((page - 1) * pageSize);

    return { rows, total };
  },
};
