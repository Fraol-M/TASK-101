import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/common/db/knex.js', () => {
  const mockKnex = vi.fn();
  return { default: mockKnex };
});

vi.mock('../../src/modules/reviews/blind-modes/projection.service.js', () => ({
  getColumnsForMode: vi.fn().mockReturnValue(['id', 'status']),
  resolveMode: vi.fn().mockReturnValue('semi_blind'),
  projectRow: vi.fn((row) => row),
}));

import { workbenchService } from '../../src/modules/reviews/workbench/workbench.service.js';
import knex from '../../src/common/db/knex.js';
import { NotFoundError } from '../../src/common/errors/AppError.js';

function makeChain(result) {
  const chain = {};
  const methods = ['where', 'whereIn', 'select', 'orderBy', 'limit', 'offset', 'clone', 'count', 'join'];
  for (const m of methods) chain[m] = vi.fn().mockReturnValue(chain);
  chain.first = vi.fn().mockResolvedValue(result);
  chain.then = vi.fn((fn) => Promise.resolve(fn(result)));
  return chain;
}

describe('workbenchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    knex.raw = vi.fn().mockReturnValue('raw-fragment');
  });

  describe('getWorkbench', () => {
    it('throws NotFoundError when assignment not found', async () => {
      const chain = makeChain(null);
      knex.mockReturnValue(chain);

      await expect(
        workbenchService.getWorkbench('missing-id', { id: 'acc-1', roles: ['REVIEWER'] }),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws NotFoundError when reviewer does not own assignment', async () => {
      let callCount = 0;
      knex.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeChain({ id: 'asgn-1', reviewer_id: 'rp-other', blind_mode: 'semi_blind' });
        return makeChain({ id: 'rp-mine' });
      });

      await expect(
        workbenchService.getWorkbench('asgn-1', { id: 'acc-1', roles: ['REVIEWER'] }),
      ).rejects.toThrow(NotFoundError);
    });

    it('returns workbench data for admin without reviewer check', async () => {
      const assignment = { id: 'asgn-1', reviewer_id: 'rp-1', blind_mode: 'full', application_id: 'app-1' };
      const application = { id: 'app-1', status: 'submitted' };
      let callCount = 0;
      knex.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeChain(assignment);
        return makeChain(application);
      });

      const result = await workbenchService.getWorkbench('asgn-1', { id: 'admin-1', roles: ['SYSTEM_ADMIN'] });
      expect(result).toBeDefined();
    });
  });

  describe('listMyAssignments', () => {
    it('returns paginated pending assignments for reviewer', async () => {
      const chain = makeChain({ count: '1' });
      chain.then = vi.fn((fn) => Promise.resolve(fn({ count: '1' })));
      knex.mockReturnValue(chain);

      const result = await workbenchService.listMyAssignments({ id: 'acc-1', roles: ['REVIEWER'] }, {});
      expect(result).toBeDefined();
    });
  });
});
