import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock knex
vi.mock('../../src/common/db/knex.js', () => {
  const mockKnex = vi.fn();
  mockKnex.transaction = vi.fn();
  return { default: mockKnex };
});

vi.mock('../../src/config/env.js', () => ({
  default: {
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    nodeEnv: 'test', isTest: true, isProduction: false,
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
  },
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/common/db/transaction.js', () => {
  const mockTrx = vi.fn();
  return {
    withTransaction: vi.fn((fn) => fn(mockTrx)),
    __mockTrx: mockTrx,
  };
});

import knex from '../../src/common/db/knex.js';
import { reviewerPoolService } from '../../src/modules/admin/reviewer-pool/reviewer-pool.service.js';
import { NotFoundError, ConflictError } from '../../src/common/errors/AppError.js';

function mockChain(resolveWith) {
  const chain = {};
  for (const m of ['where','whereIn','whereNot','select','insert','update','delete','orderBy','limit','offset','join','clone','andOn','on','raw','clearOrder','clearSelect']) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.first = vi.fn().mockResolvedValue(resolveWith);
  chain.returning = vi.fn().mockResolvedValue(Array.isArray(resolveWith) ? resolveWith : [resolveWith]);
  chain.count = vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ count: 0 }) });
  chain.pluck = vi.fn().mockResolvedValue([]);
  chain.onConflict = vi.fn().mockReturnValue({ ignore: vi.fn().mockReturnValue(chain), merge: vi.fn().mockReturnValue(chain) });
  chain.increment = vi.fn().mockResolvedValue(1);
  chain.then = vi.fn((cb) => cb ? Promise.resolve(cb(Array.isArray(resolveWith) ? resolveWith : [resolveWith])) : Promise.resolve(resolveWith));
  return chain;
}

describe('reviewerPoolService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('list', () => {
    it('returns paginated results', async () => {
      const rows = [
        { id: 'rp-1', account_id: 'acc-1', username: 'alice', available: true },
        { id: 'rp-2', account_id: 'acc-2', username: 'bob', available: false },
      ];
      const chain = mockChain(rows);

      // count chain: q.clone().count('rp.id as count').first().then(...)
      const countChain = mockChain(undefined);
      countChain.count = vi.fn().mockReturnValue(countChain);
      countChain.first = vi.fn().mockReturnValue({ then: vi.fn((cb) => Promise.resolve(cb({ count: 2 }))) });
      chain.clone = vi.fn().mockReturnValue(countChain);

      // rows query: q.orderBy().limit().offset() resolves to array
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.offset = vi.fn().mockResolvedValue(rows);

      knex.mockReturnValue(chain);

      const result = await reviewerPoolService.list({}, { page: 1, pageSize: 20 });

      expect(result.rows).toEqual(rows);
      expect(result.total).toBe(2);
    });
  });

  describe('getById', () => {
    it('throws NotFoundError when not found', async () => {
      const chain = mockChain(null);
      knex.mockReturnValue(chain);

      await expect(reviewerPoolService.getById('missing-id')).rejects.toThrow(NotFoundError);
    });

    it('returns profile on success', async () => {
      const profile = { id: 'rp-1', account_id: 'acc-1', username: 'alice', max_load: 10 };
      const chain = mockChain(profile);
      knex.mockReturnValue(chain);

      const result = await reviewerPoolService.getById('rp-1');

      expect(result).toEqual(profile);
      expect(chain.where).toHaveBeenCalledWith('rp.id', 'rp-1');
      expect(chain.first).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('throws ConflictError when profile already exists for account', async () => {
      const existingProfile = { id: 'rp-existing', account_id: 'acc-1' };
      const chain = mockChain(existingProfile);
      knex.mockReturnValue(chain);

      await expect(
        reviewerPoolService.create(
          { accountId: 'acc-1', maxLoad: 10, expertiseTags: ['CS'] },
          'actor-1',
          'req-1',
        ),
      ).rejects.toThrow(ConflictError);
    });

    it('returns created profile', async () => {
      const createdProfile = { id: 'rp-new', account_id: 'acc-2', max_load: 5, expertise_tags: '["ML"]' };

      // First knex call: check for existing profile — returns null
      const existingChain = mockChain(null);
      knex.mockReturnValue(existingChain);

      // The trx from withTransaction
      const { __mockTrx } = await import('../../src/common/db/transaction.js');
      const trxChain = mockChain(createdProfile);
      trxChain.returning.mockResolvedValue([createdProfile]);
      __mockTrx.mockReturnValue(trxChain);

      const result = await reviewerPoolService.create(
        { accountId: 'acc-2', maxLoad: 5, expertiseTags: ['ML'] },
        'actor-1',
        'req-1',
      );

      expect(result).toEqual(createdProfile);
      expect(trxChain.insert).toHaveBeenCalledWith({
        account_id: 'acc-2',
        max_load: 5,
        expertise_tags: JSON.stringify(['ML']),
      });
    });
  });
});
