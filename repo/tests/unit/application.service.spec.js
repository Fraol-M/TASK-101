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

import { applicationService } from '../../src/modules/applications/application.service.js';
import knex from '../../src/common/db/knex.js';
import { withTransaction } from '../../src/common/db/transaction.js';
import { NotFoundError, AuthorizationError } from '../../src/common/errors/AppError.js';

function makeKnexChain(resolveWith) {
  const chain = {};
  const fns = ['where', 'orderBy', 'limit', 'offset', 'clone', 'count'];
  for (const f of fns) chain[f] = vi.fn().mockReturnValue(chain);
  chain.first = vi.fn().mockResolvedValue(resolveWith);
  chain.then = vi.fn((fn) => Promise.resolve(fn(resolveWith)));
  return chain;
}

function makeTrx(row) {
  const insertChain = {
    returning: vi.fn().mockResolvedValue([row]),
  };
  const chain = {};
  const fns = ['where', 'insert'];
  for (const f of fns) chain[f] = vi.fn().mockReturnValue(insertChain);
  const trx = vi.fn().mockReturnValue(chain);
  return { trx, chain, insertChain };
}

describe('applicationService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create', () => {
    it('creates application and returns it', async () => {
      const app = { id: 'app-1', cycle_id: 'cycle-1', status: 'submitted' };
      const { trx } = makeTrx(app);
      withTransaction.mockImplementation((fn) => fn(trx));

      const result = await applicationService.create(
        { cycleId: 'cycle-1', programChoices: [] },
        'actor-1',
        'req-1',
      );
      expect(result).toEqual(app);
    });

    it('inserts program choices when provided', async () => {
      const app = { id: 'app-2', cycle_id: 'cycle-1', status: 'submitted' };
      let callCount = 0;
      const trx = vi.fn((table) => {
        callCount++;
        if (callCount === 1) {
          return { insert: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([app]) }) };
        }
        return { insert: vi.fn().mockResolvedValue([]) };
      });
      withTransaction.mockImplementation((fn) => fn(trx));

      await applicationService.create(
        { cycleId: 'cycle-1', programChoices: [{ majorId: 'm-1', preferenceOrder: 1 }] },
        'actor-1',
        'req-1',
      );
      expect(trx).toHaveBeenCalledWith('applications');
      expect(trx).toHaveBeenCalledWith('application_program_choices');
    });
  });

  describe('getById', () => {
    it('throws NotFoundError when application not found', async () => {
      const chain = makeKnexChain(null);
      knex.mockReturnValue(chain);

      await expect(
        applicationService.getById('missing-id', { id: 'u-1', roles: ['APPLICANT'] }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws AuthorizationError when applicant accesses another user app', async () => {
      const chain = makeKnexChain({ id: 'app-1', account_id: 'other-user' });
      knex.mockReturnValue(chain);

      await expect(
        applicationService.getById('app-1', { id: 'u-1', roles: ['APPLICANT'] }),
      ).rejects.toThrow(AuthorizationError);
    });

    it('returns application for admin regardless of owner', async () => {
      const app = { id: 'app-1', account_id: 'other-user' };
      const chain = makeKnexChain(app);
      knex.mockReturnValue(chain);

      const result = await applicationService.getById('app-1', {
        id: 'admin-1',
        roles: ['SYSTEM_ADMIN'],
      });
      expect(result).toEqual(app);
    });
  });

  describe('list', () => {
    it('filters by account_id for non-admin', async () => {
      const chain = makeKnexChain({ count: '0' });
      knex.mockReturnValue(chain);

      await applicationService.list({ id: 'u-1', roles: ['APPLICANT'] }, {});
      expect(chain.where).toHaveBeenCalledWith('account_id', 'u-1');
    });

    it('does not filter by account_id for admin', async () => {
      const chain = makeKnexChain({ count: '2' });
      chain.then = vi.fn((fn) => Promise.resolve(fn({ count: '2' })));
      knex.mockReturnValue(chain);

      await applicationService.list({ id: 'admin-1', roles: ['SYSTEM_ADMIN'] }, {});
      const whereCallsWithAccountId = chain.where.mock.calls.filter(
        (c) => c[0] === 'account_id',
      );
      expect(whereCallsWithAccountId).toHaveLength(0);
    });
  });
});
