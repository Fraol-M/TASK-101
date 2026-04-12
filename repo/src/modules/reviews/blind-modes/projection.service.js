/**
 * Blind mode projection service.
 *
 * Column-level access control for review data.
 * Column selection happens in the service (before the SQL query),
 * not in a post-fetch serializer. This means identity data is NEVER
 * fetched in blind mode — a projection bug cannot cause a data leak.
 *
 * Modes:
 *   blind      — only score-related fields; no applicant identity whatsoever
 *   semi_blind — academic context (program, cycle) but no personal identifiers
 *   full       — all fields (SYSTEM_ADMIN and PROGRAM_ADMIN only)
 */

// Fields visible in each mode
const BLIND_COLUMNS = [
  'ra.id',
  'ra.application_id',
  'ra.status',
  'ra.assigned_at',
  'ra.submitted_at',
  'ra.blind_mode',
];

const SEMI_BLIND_COLUMNS = [
  ...BLIND_COLUMNS,
  'a.cycle_id',
  'a.status AS application_status',
  'a.research_fit_score',
  'a.submitted_at AS application_submitted_at',
];

const FULL_COLUMNS = [
  ...SEMI_BLIND_COLUMNS,
  'a.account_id AS applicant_account_id',
  'a.applicant_name_encrypted',
  'a.contact_email_encrypted',
];

/**
 * Returns the column list appropriate for the given blind mode.
 * @param {'blind'|'semi_blind'|'full'} mode
 * @returns {string[]}
 */
export function getColumnsForMode(mode) {
  switch (mode) {
    case 'full':
      return FULL_COLUMNS;
    case 'semi_blind':
      return SEMI_BLIND_COLUMNS;
    case 'blind':
    default:
      return BLIND_COLUMNS;
  }
}

/**
 * Determines the effective blind mode for a viewer.
 * Reviewers always get their assignment's configured blind mode.
 * Admins may request 'full' mode.
 *
 * @param {object} assignment  review_assignments row
 * @param {object} viewer      { id, roles }
 * @returns {'blind'|'semi_blind'|'full'}
 */
export function resolveMode(assignment, viewer) {
  const isAdmin =
    viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');

  if (isAdmin) return 'full';
  // Non-admins are capped to semi_blind at most — full mode is admin-only per security model
  const assignedMode = assignment.blind_mode || 'blind';
  return assignedMode === 'full' ? 'semi_blind' : assignedMode;
}

/**
 * Strips any identity fields from an already-fetched object as a safety net.
 * This is a belt-and-suspenders check — the primary protection is column-level selection.
 *
 * @param {object} row
 * @param {'blind'|'semi_blind'|'full'} mode
 * @returns {object}
 */
export function projectRow(row, mode) {
  if (mode === 'full') return row;

  const IDENTITY_FIELDS = ['applicant_account_id', 'applicant_name_encrypted', 'contact_email_encrypted'];
  const result = { ...row };

  if (mode === 'blind' || mode === 'semi_blind') {
    for (const field of IDENTITY_FIELDS) {
      delete result[field];
    }
  }

  if (mode === 'blind') {
    delete result.cycle_id;
    delete result.application_status;
    delete result.research_fit_score;
    delete result.application_submitted_at;
  }

  return result;
}
