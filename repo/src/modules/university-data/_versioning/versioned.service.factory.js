import { withTransaction } from '../../../common/db/transaction.js';
import { auditService } from '../../admin/audit/audit.service.js';
import { makeVersionedRepository } from './versioned-repository.factory.js';

/**
 * Creates a standard versioned entity service for a given entity type.
 * All 8 university-data entities use this factory.
 *
 * @param {object} config
 * @param {string} config.stableTable
 * @param {string} config.versionsTable
 * @param {string} config.stableIdColumn
 * @param {string} config.entityType   For audit events e.g. 'university'
 */
export function makeVersionedService(config) {
  const repo = makeVersionedRepository(config);
  const { entityType } = config;

  return {
    async create(stableData, versionPayload, actorId, requestId) {
      return withTransaction(async (trx) => {
        const result = await repo.create(stableData, versionPayload, actorId, trx);
        await auditService.record({
          actorAccountId: actorId,
          actionType: `${entityType}.created`,
          entityType,
          entityId: result.stable.id,
          requestId,
          afterSummary: { name: versionPayload.name, status: 'draft' },
        }, trx);
        return result;
      });
    },

    async createNewDraft(stableId, payload, actorId, requestId) {
      return withTransaction(async (trx) => {
        const version = await repo.createNewDraft(stableId, payload, actorId, trx);
        await auditService.record({
          actorAccountId: actorId,
          actionType: `${entityType}.draft_created`,
          entityType,
          entityId: stableId,
          requestId,
          afterSummary: { versionNumber: version.version_number },
        }, trx);
        return version;
      });
    },

    async updateDraft(stableId, versionId, payload, actorId, requestId) {
      return withTransaction(async (trx) => {
        const version = await repo.updateDraft(stableId, versionId, payload, actorId, trx);
        await auditService.record({
          actorAccountId: actorId,
          actionType: `${entityType}.draft_updated`,
          entityType,
          entityId: stableId,
          requestId,
          afterSummary: { versionId },
        }, trx);
        return version;
      });
    },

    async publish(stableId, versionId, actorId, requestId, effectiveFrom) {
      return withTransaction(async (trx) => {
        const version = await repo.publishVersion(stableId, versionId, actorId, trx, effectiveFrom);
        await auditService.record({
          actorAccountId: actorId,
          actionType: `${entityType}.version_published`,
          entityType,
          entityId: stableId,
          requestId,
          afterSummary: {
            versionId,
            versionNumber: version.version_number,
            lifecycleStatus: version.lifecycle_status,
            effectiveFrom: version.effective_from,
          },
        }, trx);
        return version;
      });
    },

    async archive(stableId, actorId, requestId) {
      return withTransaction(async (trx) => {
        const count = await repo.archive(stableId, actorId, trx);
        if (count) {
          await auditService.record({
            actorAccountId: actorId,
            actionType: `${entityType}.archived`,
            entityType,
            entityId: stableId,
            requestId,
          }, trx);
        }
        return count;
      });
    },

    async promoteScheduled(stableId, actorId, requestId, versionId) {
      return withTransaction(async (trx) => {
        const version = await repo.promoteScheduled(stableId, actorId, trx, versionId);
        if (version) {
          await auditService.record({
            actorAccountId: actorId,
            actionType: `${entityType}.scheduled_promoted`,
            entityType,
            entityId: stableId,
            requestId,
            afterSummary: {
              versionId: version.id,
              versionNumber: version.version_number,
              effectiveFrom: version.effective_from,
            },
          }, trx);
        }
        return version;
      });
    },

    findCurrent: (stableId, trx) => repo.findCurrent(stableId, trx),
    findVersionById: (stableId, versionId, trx) => repo.findVersionById(stableId, versionId, trx),
    findHistory: (stableId, trx) => repo.findHistory(stableId, trx),
    findAtPointInTime: (stableId, asOf, trx) => repo.findAtPointInTime(stableId, asOf, trx),
    listCurrent: (filters, pagination, trx) => repo.listCurrent(filters, pagination, trx),
  };
}
