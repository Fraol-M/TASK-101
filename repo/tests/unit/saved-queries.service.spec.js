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

vi.mock('../../src/modules/search/search.service.js', () => ({
  searchService: { search: vi.fn().mockResolvedValue({ rows: [], total: 0 }) },
}));

import { savedQueriesService } from '../../src/modules/search/saved-queries.service.js';
import knex from '../../src/common/db/knex.js';
import { withTransaction } from '../../src/common/db/transaction.js';
import { NotFoundError, AuthorizationError, ConflictError } from '../../src/common/errors/AppError.js';

function makeKnexChain(resolveWith) {
  const chain = {};
  const fns = ['where', 'orderBy', 'limit', 'offset', 'clone', 'count', 'update', 'select'];
  for (const f of fns) chain[f] = vi.fn().mockReturnValue(chain);
  chain.first = vi.fn().mockResolvedValue(resolveWith);
  chain.then = vi.fn((fn) => Promise.resolve(fn(resolveWith)));
  return chain;
}

function makeTrx({ firstResult = null, deleteResult = 0, returnRow = null } = {}) {
  const chain = {};
  for (const m of ['where', 'update', 'select']) chain[m] = vi.fn().mockReturnValue(chain);
  chain.first = vi.fn().mockResolvedValue(firstResult);
  chain.delete = vi.fn().mockResolvedValue(deleteResult);
  chain.insert = vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([returnRow]),
  });
  chain.returning = vi.fn().mockResolvedValue([returnRow]);
  return vi.fn().mockReturnValue(chain);
}

describe('savedQueriesService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('list', () => {
    it('lists saved queries for account', async () => {
      const chain = makeKnexChain({ count: '1' });
      chain.then = vi.fn((fn) => Promise.resolve(fn({ count: '1' })));
      knex.mockReturnValue(chain);

      const result = await savedQueriesService.list('acct-1', {});
      expect(knex).toHaveBeenCalledWith('search_saved_queries');
      expect(result).toBeDefined();
    });
  });

  describe('create', () => {
    it('creates saved query and returns it', async () => {
      const sq = { id: 'sq-1', name: 'Test Query', account_id: 'acct-1' };
      const trx = makeTrx({ returnRow: sq });
      withTransaction.mockImplementation((fn) => fn(trx));

      const result = await savedQueriesService.create({
        accountId: 'acct-1',
        name: 'Test Query',
        queryText: 'computer science',
      });
      expect(result).toEqual(sq);
    });

    it('throws ConflictError on duplicate name (23505)', async () => {
      const err = new Error('unique constraint');
      err.code = '23505';
      withTransaction.mockRejectedValue(err);

      await expect(
        savedQueriesService.create({ accountId: 'a-1', name: 'dup', queryText: 'q' }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('update', () => {
    it('throws NotFoundError when query not found', async () => {
      const trx = makeTrx({ firstResult: null });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(
        savedQueriesService.update('sq-missing', 'acct-1', { name: 'New' }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws AuthorizationError when account does not own query', async () => {
      const trx = makeTrx({ firstResult: { id: 'sq-1', account_id: 'other-acct' } });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(
        savedQueriesService.update('sq-1', 'acct-1', { name: 'New' }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('delete', () => {
    it('throws NotFoundError when query not found', async () => {
      const trx = makeTrx({ firstResult: null });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(savedQueriesService.delete('sq-missing', 'acct-1')).rejects.toThrow(NotFoundError);
    });

    it('throws AuthorizationError when account does not own query', async () => {
      const trx = makeTrx({ firstResult: { id: 'sq-1', account_id: 'other-acct' } });
      withTransaction.mockImplementation((fn) => fn(trx));

      await expect(savedQueriesService.delete('sq-1', 'acct-1')).rejects.toThrow(AuthorizationError);
    });
  });

  describe('run', () => {
    it('throws NotFoundError for missing query', async () => {
      const chain = makeKnexChain(null);
      knex.mockReturnValue(chain);

      await expect(savedQueriesService.run('sq-missing', 'acct-1')).rejects.toThrow(NotFoundError);
    });

    it('throws AuthorizationError when account does not own query', async () => {
      const chain = makeKnexChain({ id: 'sq-1', account_id: 'other-acct', query_text: 'q', filters: {} });
      knex.mockReturnValue(chain);

      await expect(savedQueriesService.run('sq-1', 'acct-1')).rejects.toThrow(AuthorizationError);
    });
  });
});
