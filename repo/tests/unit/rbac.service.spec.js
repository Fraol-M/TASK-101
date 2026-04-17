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

vi.mock('../../src/common/db/transaction.js', () => ({
  withTransaction: vi.fn((fn) => fn({})),
}));

import knex from '../../src/common/db/knex.js';
import { rbacService } from '../../src/modules/rbac/rbac.service.js';

function mockChain(resolveWith) {
  const chain = {};
  for (const m of ['where','whereIn','whereNot','select','insert','update','delete','orderBy','limit','offset','join','clone','andOn','on','raw']) {
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

describe('rbacService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('can', () => {
    it('returns true when permission found in DB', async () => {
      const chain = mockChain({ id: 'perm-1' });
      knex.mockReturnValue(chain);

      const result = await rbacService.can('acc-1', 'university-data:publish');

      expect(result).toBe(true);
      expect(chain.join).toHaveBeenCalledTimes(2);
      expect(chain.where).toHaveBeenCalledWith('account_roles.account_id', 'acc-1');
    });

    it('returns false when permission not found', async () => {
      const chain = mockChain(null);
      knex.mockReturnValue(chain);

      const result = await rbacService.can('acc-1', 'university-data:publish');

      expect(result).toBe(false);
    });
  });

  describe('listRoles', () => {
    it('returns ordered role list', async () => {
      const roles = [{ id: 'r-1', name: 'ADMIN' }, { id: 'r-2', name: 'REVIEWER' }];
      const chain = mockChain(roles);
      // listRoles awaits the chain directly (no .first()), so we need .then behavior
      chain.then = vi.fn((cb) => cb ? Promise.resolve(cb(roles)) : Promise.resolve(roles));
      knex.mockReturnValue(chain);

      const result = await rbacService.listRoles();

      expect(result).toEqual(roles);
      expect(chain.orderBy).toHaveBeenCalledWith('name');
    });
  });

  describe('createRole', () => {
    it('returns created role', async () => {
      const newRole = { id: 'r-new', name: 'EDITOR', description: 'Can edit' };
      const chain = mockChain(newRole);
      chain.returning.mockResolvedValue([newRole]);
      knex.mockReturnValue(chain);

      const result = await rbacService.createRole(
        { name: 'EDITOR', description: 'Can edit' },
        'actor-1',
        'req-1',
      );

      expect(result).toEqual(newRole);
      expect(chain.insert).toHaveBeenCalledWith({ name: 'EDITOR', description: 'Can edit' });
    });
  });

  describe('assignRole', () => {
    it('throws Error when role not found', async () => {
      const chain = mockChain(null); // role not found
      knex.mockReturnValue(chain);

      await expect(
        rbacService.assignRole('acc-1', 'NONEXISTENT', 'actor-1', 'req-1'),
      ).rejects.toThrow('Role NONEXISTENT not found');
    });
  });

  describe('listPermissions', () => {
    it('returns permission list', async () => {
      const permissions = [
        { id: 'p-1', capability: 'university-data:publish' },
        { id: 'p-2', capability: 'university-data:read' },
      ];
      const chain = mockChain(permissions);
      chain.then = vi.fn((cb) => cb ? Promise.resolve(cb(permissions)) : Promise.resolve(permissions));
      knex.mockReturnValue(chain);

      const result = await rbacService.listPermissions();

      expect(result).toEqual(permissions);
      expect(chain.orderBy).toHaveBeenCalledWith('capability');
    });
  });
});
