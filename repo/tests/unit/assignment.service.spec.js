import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/common/db/knex.js', () => {
  const mockKnex = vi.fn();
  return { default: mockKnex };
});

vi.mock('../../src/common/db/transaction.js', () => ({
  withTransaction: vi.fn(),
}));

vi.mock('../../src/modules/reviews/assignments/coi.service.js', () => ({
  coiService: {
    checkConflict: vi.fn().mockResolvedValue({ hasConflict: false, reasons: [] }),
    recordCheck: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/config/review-policies.js', () => ({
  reviewPolicies: { defaultBlindMode: 'semi_blind', defaultDueDays: 14 },
}));

import { assignmentService } from '../../src/modules/reviews/assignments/assignment.service.js';
import knex from '../../src/common/db/knex.js';
import { NotFoundError, UnprocessableError } from '../../src/common/errors/AppError.js';

function makeChain(result) {
  const chain = {};
  const methods = ['where', 'whereIn', 'select', 'orderBy', 'limit', 'offset', 'clone', 'count', 'update', 'insert'];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.first = vi.fn().mockResolvedValue(result);
  chain.then = vi.fn((fn) => Promise.resolve(fn(result)));
  chain.returning = vi.fn().mockResolvedValue([result]);
  return chain;
}

describe('assignmentService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create', () => {
    it('throws NotFoundError when application not found', async () => {
      knex.mockImplementation((table) => {
        if (table === 'applications') return makeChain(null);
        return makeChain({ id: 'rp-1', active: true, available: true, active_assignments: 0, max_load: 10 });
      });

      await expect(
        assignmentService.create({ applicationId: 'app-1', reviewerId: 'rp-1' }, 'req-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when reviewer not found', async () => {
      knex.mockImplementation((table) => {
        if (table === 'applications') return makeChain({ id: 'app-1', cycle_id: 'cyc-1' });
        return makeChain(null);
      });

      await expect(
        assignmentService.create({ applicationId: 'app-1', reviewerId: 'rp-1' }, 'req-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws UnprocessableError when reviewer unavailable', async () => {
      knex.mockImplementation((table) => {
        if (table === 'applications') return makeChain({ id: 'app-1', cycle_id: 'cyc-1' });
        return makeChain({ id: 'rp-1', active: true, available: false, active_assignments: 0, max_load: 10 });
      });

      await expect(
        assignmentService.create({ applicationId: 'app-1', reviewerId: 'rp-1' }, 'req-1'),
      ).rejects.toThrow(UnprocessableError);
    });

    it('throws UnprocessableError when reviewer at max load', async () => {
      knex.mockImplementation((table) => {
        if (table === 'applications') return makeChain({ id: 'app-1', cycle_id: 'cyc-1' });
        return makeChain({ id: 'rp-1', active: true, available: true, active_assignments: 10, max_load: 10 });
      });

      await expect(
        assignmentService.create({ applicationId: 'app-1', reviewerId: 'rp-1' }, 'req-1'),
      ).rejects.toThrow(UnprocessableError);
    });
  });

  describe('list', () => {
    it('returns paginated assignments for reviewer', async () => {
      const chain = makeChain({ count: '2' });
      chain.then = vi.fn((fn) => Promise.resolve(fn({ count: '2' })));
      knex.mockReturnValue(chain);

      const result = await assignmentService.list({ id: 'acc-1', roles: ['REVIEWER'] }, {});
      expect(result).toBeDefined();
    });
  });

  describe('getById', () => {
    it('throws NotFoundError when assignment not found', async () => {
      const chain = makeChain(null);
      knex.mockReturnValue(chain);

      await expect(
        assignmentService.getById('missing-id', { id: 'acc-1', roles: ['REVIEWER'] }),
      ).rejects.toThrow(NotFoundError);
    });
  });
});
