import knex from '../../../common/db/knex.js';
import { NotFoundError, ConflictError, UnprocessableError } from '../../../common/errors/AppError.js';

/**
 * Versioned repository factory.
 *
 * Creates a repository with consistent CRUD + versioning operations for any
 * of the 8 university-data entities. Eliminates 8× code duplication.
 *
 * @param {object} config
 * @param {string} config.stableTable       e.g. 'universities'
 * @param {string} config.versionsTable     e.g. 'university_versions'
 * @param {string} config.stableIdColumn    e.g. 'university_id'
 * @returns {object}  Repository with standard versioning operations
 */
export function makeVersionedRepository(config) {
  const { stableTable, versionsTable, stableIdColumn } = config;

  return {
    /**
     * Create a stable entity record + initial draft version.
     */
    async create(stableData, versionPayload, actorId, trx) {
      const db = trx || knex;

      const [stable] = await db(stableTable)
        .insert({ ...stableData, created_by: actorId })
        .returning('*');

      const [version] = await db(versionsTable)
        .insert({
          [stableIdColumn]: stable.id,
          version_number: 1,
          lifecycle_status: 'draft',
          effective_from: versionPayload.effectiveFrom || new Date().toISOString().split('T')[0],
          payload_json: JSON.stringify(versionPayload),
          created_by: actorId,
        })
        .returning('*');

      return { stable, version };
    },

    /**
     * Get the current active version of an entity.
     */
    async findCurrent(stableId, trx) {
      const db = trx || knex;
      const version = await db(versionsTable)
        .where({ [stableIdColumn]: stableId, lifecycle_status: 'active' })
        .first();
      if (!version) throw new NotFoundError(`${stableTable} not found or has no active version`);
      return version;
    },

    /**
     * Find a specific version by its ID, scoped to a stable entity.
     * Prevents cross-entity version leakage via UUID guessing.
     */
    async findVersionById(stableId, versionId, trx) {
      const db = trx || knex;
      const version = await db(versionsTable)
        .where({ id: versionId, [stableIdColumn]: stableId })
        .first();
      if (!version) throw new NotFoundError('Version not found');
      return version;
    },

    /**
     * Get the active or most recent version as of a specific date.
     */
    async findAtPointInTime(stableId, asOf, trx) {
      const db = trx || knex;
      return db(versionsTable)
        .where({ [stableIdColumn]: stableId })
        .where('effective_from', '<=', asOf)
        .whereIn('lifecycle_status', ['active', 'superseded'])
        .orderBy('version_number', 'desc')
        .first();
    },

    /**
     * List all versions for an entity (history).
     */
    async findHistory(stableId, trx) {
      const db = trx || knex;
      return db(versionsTable)
        .where({ [stableIdColumn]: stableId })
        .orderBy('version_number', 'desc');
    },

    /**
     * Update a draft version. Published versions are immutable.
     * stableId is required to prevent cross-entity write via UUID guessing.
     */
    async updateDraft(stableId, versionId, payload, actorId, trx) {
      const db = trx || knex;

      const existing = await db(versionsTable)
        .where({ id: versionId, [stableIdColumn]: stableId })
        .first();
      if (!existing) throw new NotFoundError('Version not found');
      if (existing.lifecycle_status !== 'draft') {
        throw new UnprocessableError(
          'Only draft versions can be updated. Published versions are immutable.',
        );
      }

      const [updated] = await db(versionsTable)
        .where({ id: versionId })
        .update({
          payload_json: JSON.stringify(payload),
          effective_from: payload.effectiveFrom || existing.effective_from,
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      return updated;
    },

    /**
     * Publish a draft version.
     * Must be called inside withTransaction() from the service layer.
     *
     * Transitions:
     *   - Immediate effective date → new version becomes 'active', prior active becomes 'superseded'
     *   - Future effective date → new version becomes 'scheduled'
     */
    async publishVersion(stableId, versionId, actorId, trx, effectiveFrom) {
      const db = trx || knex;

      const version = await db(versionsTable)
        .where({ id: versionId, [stableIdColumn]: stableId })
        .first();
      if (!version) throw new NotFoundError('Version not found');
      if (version.lifecycle_status !== 'draft') {
        throw new UnprocessableError('Only draft versions can be published');
      }

      // Determine next version number.
      // Exclude drafts: draft version_numbers are provisional placeholders and must not
      // shift the published sequence. Only committed (non-draft) rows anchor the counter.
      const maxRow = await db(versionsTable)
        .where({ [stableIdColumn]: version[stableIdColumn] })
        .whereNot('lifecycle_status', 'draft')
        .max('version_number as max')
        .first();
      const nextVersionNumber = (maxRow?.max || 0) + 1;

      const today = new Date().toISOString().split('T')[0];
      // effectiveFrom from publish request takes precedence over the stored draft value
      const effectiveDate = effectiveFrom || version.effective_from;
      const isImmediate = effectiveDate <= today;
      const newStatus = isImmediate ? 'active' : 'scheduled';

      if (isImmediate) {
        // Retire current active version to 'superseded'
        await db(versionsTable)
          .where({ [stableIdColumn]: version[stableIdColumn], lifecycle_status: 'active' })
          .update({ lifecycle_status: 'superseded', updated_at: new Date().toISOString() });
      }

      const [published] = await db(versionsTable)
        .where({ id: versionId })
        .update({
          lifecycle_status: newStatus,
          version_number: nextVersionNumber,
          effective_from: effectiveDate, // persist the resolved date (may override draft value)
          published_at: new Date().toISOString(),
          published_by: actorId,
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      return published;
    },

    /**
     * Archive an entity and its active version.
     * Returns the number of rows updated (0 if entity not found or already archived).
     */
    async archive(stableId, actorId, trx) {
      const db = trx || knex;
      const count = await db(versionsTable)
        .where({ [stableIdColumn]: stableId })
        .whereIn('lifecycle_status', ['active', 'draft', 'scheduled'])
        .update({ lifecycle_status: 'archived', updated_at: new Date().toISOString() });
      return count;
    },

    /**
     * List all stable entities with their current active version.
     */
    async listCurrent(filters = {}, pagination = {}, trx) {
      const db = trx || knex;
      const { page = 1, pageSize = 20 } = pagination;
      const offset = (page - 1) * pageSize;

      const q = db(stableTable)
        .join(versionsTable, `${versionsTable}.${stableIdColumn}`, `${stableTable}.id`)
        .where(`${versionsTable}.lifecycle_status`, 'active');

      const total = await q.clone().count(`${stableTable}.id as count`).first().then((r) => Number(r.count));
      const rows = await q
        .select(`${stableTable}.*`, `${versionsTable}.*`, `${stableTable}.id as stable_id`)
        .limit(pageSize)
        .offset(offset)
        .orderBy(`${stableTable}.created_at`, 'desc');

      return { rows, total };
    },

    /**
     * Promote all due scheduled versions to active for a given entity.
     *
     * Called either:
     *   a) by the POST /:stableId/versions/:versionId/activate endpoint (manual), or
     *   b) by the scheduled-version promotion script (automated).
     *
     * Transactional guarantee: supersedes the current active version first,
     * then promotes the scheduled version — same enforcement as publishVersion.
     *
     * Only promotes if effective_from <= today. Returns the promoted version
     * or null if no promotion was due.
     */
    /**
     * @param {string}  stableId
     * @param {string}  actorId
     * @param {object}  [trx]       Knex transaction (optional)
     * @param {string}  [versionId] When supplied (manual activate endpoint), promote only
     *                              that specific version; reject if it is not yet due.
     *                              When omitted (cron script), promote the earliest due version.
     */
    async promoteScheduled(stableId, actorId, trx, versionId) {
      const db = trx || knex;
      const today = new Date().toISOString().split('T')[0];

      let candidate;
      if (versionId) {
        // Manual activation: target the exact version and validate it is due
        candidate = await db(versionsTable)
          .where({ id: versionId, [stableIdColumn]: stableId, lifecycle_status: 'scheduled' })
          .first();
        if (!candidate) return null; // Not found, wrong entity, or not scheduled
        if (candidate.effective_from > today) {
          const err = new Error(
            `Version effective_from ${candidate.effective_from} is not yet due (today is ${today})`,
          );
          err.code = 'NOT_DUE';
          throw err;
        }
      } else {
        // Automated: find the scheduled version with the earliest due effective_from
        candidate = await db(versionsTable)
          .where({ [stableIdColumn]: stableId, lifecycle_status: 'scheduled' })
          .where('effective_from', '<=', today)
          .orderBy('effective_from', 'asc')
          .first();
      }

      if (!candidate) return null;

      // Supersede the currently active version (if any)
      await db(versionsTable)
        .where({ [stableIdColumn]: stableId, lifecycle_status: 'active' })
        .update({ lifecycle_status: 'superseded', updated_at: new Date().toISOString() });

      // Promote the scheduled candidate
      const [promoted] = await db(versionsTable)
        .where({ id: candidate.id })
        .update({
          lifecycle_status: 'active',
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      return promoted;
    },

    /**
     * Create a new draft version from the current state.
     */
    async createNewDraft(stableId, payload, actorId, trx) {
      const db = trx || knex;

      // Derive the next version number from the published sequence only.
      // Excluding drafts keeps the numbering single-source: the same counter
      // used by publishVersion, so a draft's provisional number matches what
      // publish will assign and no reassignment occurs at publish time.
      const maxRow = await db(versionsTable)
        .where({ [stableIdColumn]: stableId })
        .whereNot('lifecycle_status', 'draft')
        .max('version_number as max')
        .first();
      const nextVersionNumber = (maxRow?.max || 0) + 1;

      const [version] = await db(versionsTable)
        .insert({
          [stableIdColumn]: stableId,
          version_number: nextVersionNumber,
          lifecycle_status: 'draft',
          effective_from: payload.effectiveFrom || new Date().toISOString().split('T')[0],
          payload_json: JSON.stringify(payload),
          created_by: actorId,
        })
        .returning('*');

      return version;
    },
  };
}
