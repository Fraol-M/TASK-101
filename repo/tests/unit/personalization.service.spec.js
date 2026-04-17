import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/common/db/knex.js', () => {
  const mockKnex = vi.fn();
  mockKnex.transaction = vi.fn();
  return { default: mockKnex };
});

vi.mock('../../src/common/db/transaction.js', () => ({
  withTransaction: vi.fn(),
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/common/metrics/metrics.js', () => ({
  recommendationGenerationsTotal: { inc: vi.fn() },
}));

vi.mock('../../src/config/env.js', () => ({
  default: { personalization: { historyRetentionDays: 30 } },
}));

vi.mock('../../src/common/logging/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { personalizationService } from '../../src/modules/personalization/personalization.service.js';
import knex from '../../src/common/db/knex.js';
import { withTransaction } from '../../src/common/db/transaction.js';
import { NotFoundError, ConflictError } from '../../src/common/errors/AppError.js';

function makeKnexChain(resolveWith) {
  const chain = {};
  const fns = ['where', 'orderBy', 'limit', 'offset', 'clone', 'count', 'select', 'groupBy'];
  for (const f of fns) chain[f] = vi.fn().mockReturnValue(chain);
  chain.first = vi.fn().mockResolvedValue(resolveWith);
  chain.then = vi.fn((fn) => Promise.resolve(fn(resolveWith)));
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue([resolveWith]);
  return chain;
}

function makeTrx({ returnRow = null, deleteResult = 0 } = {}) {
  const chain = {};
  for (const m of ['where', 'onConflict', 'merge', 'update', 'select']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.delete = vi.fn().mockResolvedValue(deleteResult);
  chain.first = vi.fn().mockResolvedValue(returnRow);
  chain.insert = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([returnRow]),
  });
  chain.returning = vi.fn().mockResolvedValue([returnRow]);
  return vi.fn().mockReturnValue(chain);
}

describe('personalizationService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('recordView', () => {
    it('inserts view record into entity_view_history', async () => {
      const chain = makeKnexChain({ id: 'v-1' });
      knex.mockReturnValue(chain);

      await personalizationService.recordView({
        accountId: 'acct-1',
        entityType: 'university',
        stableId: 'uni-1',
      });
      expect(knex).toHaveBeenCalledWith('entity_view_history');
      expect(chain.insert).toHaveBeenCalled();
    });
  });

  describe('getHistory', () => {
    it('returns paginated view history for account', async () => {
      const chain = makeKnexChain({ count: '3' });
      chain.then = vi.fn((fn) => Promise.resolve(fn({ count: '3' })));
      knex.mockReturnValue(chain);

      const result = await personalizationService.getHistory('acct-1', {});
      expect(knex).toHaveBeenCalledWith('entity_view_history');
      expect(result).toBeDefined();
    });
  });

  describe('addBookmark', () => {
    it('creates bookmark and returns it', async () => {
      const bookmark = { id: 'bm-1', account_id: 'acct-1' };
      const trx = makeTrx({ returnRow: bookmark });
      withTransaction.mockImplementation((fn) => fn(trx));

      const result = await personalizationService.addBookmark({
        accountId: 'acct-1',
        entityType: 'university',
        stableId: 'uni-1',
      });
      expect(result).toEqual(bookmark);
    });

    it('throws ConflictError on duplicate bookmark (23505)', async () => {
      const err = new Error('unique constraint');
      err.code = '23505';
      withTransaction.mockRejectedValue(err);

      await expect(
        personalizationService.addBookmark({ accountId: 'a-1', entityType: 'university', stableId: 'u-1' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('removeBookmark', () => {
    it('throws NotFoundError when bookmark does not exist', async () => {
      const trx = makeTrx({ deleteResult: 0 });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(
        personalizationService.removeBookmark({ accountId: 'a-1', entityType: 'university', stableId: 'u-1' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('deletePreference', () => {
    it('throws NotFoundError when preference does not exist', async () => {
      const trx = makeTrx({ deleteResult: 0 });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(
        personalizationService.deletePreference('acct-1', 'theme'),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('removeTagSubscription', () => {
    it('throws NotFoundError when subscription does not exist', async () => {
      const trx = makeTrx({ deleteResult: 0 });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(
        personalizationService.removeTagSubscription({ accountId: 'a-1', tag: 'cs' }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('addTagSubscription', () => {
    it('throws ConflictError on duplicate tag subscription (23505)', async () => {
      const err = new Error('unique constraint');
      err.code = '23505';
      withTransaction.mockRejectedValue(err);

      await expect(
        personalizationService.addTagSubscription({ accountId: 'a-1', tag: 'cs' }),
      ).rejects.toThrow(ConflictError);
    });
  });
});
