import knex from '../../../common/db/knex.js';
import { reviewPolicies } from '../../../config/review-policies.js';

/**
 * Conflict-of-Interest (COI) service.
 *
 * Enforces two rules:
 * 1. Institution window: reviewer cannot review an applicant from the same
 *    institution within the last 5 years (configurable window).
 * 2. Prior-cycle block: reviewer cannot review the same applicant they
 *    reviewed in the immediately preceding cycle.
 *
 * Central service — used by both random and rule-based assignment flows.
 */
export const coiService = {
  /**
   * Check for conflicts between a specific reviewer and application.
   *
   * @param {string} reviewerId  reviewer_profiles.id
   * @param {string} applicationId  applications.id
   * @param {object} [trx]
   * @returns {{ hasConflict: boolean, reasons: Array<{type: string, detail: string}> }}
   */
  async checkConflict(reviewerId, applicationId, trx) {
    const db = trx || knex;
    const windowYears = reviewPolicies.assignment.coiInstitutionWindowYears;

    const conflicts = await db.raw(
      `
      -- Rule 1: Same institution within the last N years
      SELECT
        rih.reviewer_id,
        rih.university_id,
        rih.role AS reviewer_role,
        aih.role AS applicant_role,
        'institution_affiliation' AS coi_type,
        rih.start_date,
        rih.end_date
      FROM reviewer_institution_history rih
      JOIN application_institution_history aih
        ON aih.university_id = rih.university_id
        AND aih.application_id = :applicationId
      WHERE rih.reviewer_id = :reviewerId
        AND (
          rih.end_date IS NULL
          OR rih.end_date >= CURRENT_DATE - INTERVAL '${windowYears} years'
        )

      UNION ALL

      -- Rule 2: Reviewed same applicant in the prior cycle
      SELECT
        ra.reviewer_id,
        NULL AS university_id,
        NULL AS reviewer_role,
        NULL AS applicant_role,
        'prior_cycle_review' AS coi_type,
        ra.assigned_at AS start_date,
        ra.submitted_at AS end_date
      FROM review_assignments ra
      JOIN applications prev_app ON prev_app.id = ra.application_id
      JOIN applications curr_app ON curr_app.id = :applicationId
        AND curr_app.account_id = prev_app.account_id
      JOIN application_cycles prev_cycle ON prev_cycle.id = prev_app.cycle_id
      JOIN application_cycles curr_cycle ON curr_cycle.id = curr_app.cycle_id
      WHERE ra.reviewer_id = :reviewerId
        AND ra.status = 'submitted'
        -- "Prior cycle" = the cycle with the highest year strictly before the current
        -- cycle's year. Using a subquery rather than (curr_cycle.year - 1) so that
        -- gap years (e.g. 2023 → 2025 with no 2024 cycle) are handled correctly.
        AND prev_cycle.year = (
          SELECT MAX(ac.year)
          FROM application_cycles ac
          WHERE ac.year < curr_cycle.year
        )
      `,
      { reviewerId, applicationId },
    ).then((r) => r.rows);

    const reasons = conflicts.map((c) => ({
      type: c.coi_type,
      detail:
        c.coi_type === 'institution_affiliation'
          ? `Reviewer affiliated with university ${c.university_id} (${c.reviewer_role})`
          : `Reviewer reviewed this applicant in the prior cycle`,
    }));

    return { hasConflict: reasons.length > 0, reasons };
  },

  /**
   * Batch COI check for N reviewers × M applications.
   * Returns the set of (reviewerId, applicationId) pairs that have a conflict.
   * More efficient than N*M individual checks.
   *
   * @param {Array<{reviewerId: string, applicationId: string}>} pairs
   * @param {object} [trx]
   * @returns {Set<string>}  Set of "{reviewerId}:{applicationId}" strings with conflicts
   */
  async batchCheck(pairs, trx) {
    if (!pairs.length) return new Set();

    const db = trx || knex;
    const windowYears = reviewPolicies.assignment.coiInstitutionWindowYears;

    // Build values list for the pairs
    const values = pairs.map(() => '(?::uuid, ?::uuid)').join(', ');
    const flatPairs = pairs.flatMap((p) => [p.reviewerId, p.applicationId]);

    const conflicts = await db.raw(
      `
      WITH candidate_pairs(reviewer_id, application_id) AS (
        VALUES ${values}
      )
      SELECT DISTINCT cp.reviewer_id, cp.application_id
      FROM candidate_pairs cp
      JOIN reviewer_institution_history rih ON rih.reviewer_id = cp.reviewer_id
      JOIN application_institution_history aih
        ON aih.university_id = rih.university_id
        AND aih.application_id = cp.application_id
      WHERE (
        rih.end_date IS NULL
        OR rih.end_date >= CURRENT_DATE - INTERVAL '${windowYears} years'
      )

      UNION

      SELECT DISTINCT cp.reviewer_id, cp.application_id
      FROM candidate_pairs cp
      JOIN review_assignments ra ON ra.reviewer_id = cp.reviewer_id
      JOIN applications prev_app ON prev_app.id = ra.application_id
      JOIN applications curr_app ON curr_app.id = cp.application_id
        AND curr_app.account_id = prev_app.account_id
      JOIN application_cycles prev_cycle ON prev_cycle.id = prev_app.cycle_id
      JOIN application_cycles curr_cycle ON curr_cycle.id = curr_app.cycle_id
      WHERE ra.status = 'submitted'
        -- Same cycle-adjacency predicate as checkConflict: most recent prior cycle by year.
        AND prev_cycle.year = (
          SELECT MAX(ac.year)
          FROM application_cycles ac
          WHERE ac.year < curr_cycle.year
        )
      `,
      flatPairs,
    ).then((r) => r.rows);

    return new Set(conflicts.map((c) => `${c.reviewer_id}:${c.application_id}`));
  },

  /**
   * Store a COI check record for audit purposes.
   * Called regardless of whether a conflict was found.
   */
  async recordCheck({ reviewerId, applicationId, hasConflict, reasons, checkedBy }, trx) {
    return (trx || knex)('coi_check_records').insert({
      reviewer_id: reviewerId,
      application_id: applicationId,
      has_conflict: hasConflict,
      conflict_reasons: JSON.stringify(reasons),
      checked_by: checkedBy,
    });
  },
};
