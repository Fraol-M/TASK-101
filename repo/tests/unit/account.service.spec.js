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

vi.mock('../../src/modules/auth/password.service.js', () => ({
  passwordService: {
    validateComplexity: vi.fn(),
    hash: vi.fn().mockResolvedValue('hashed-pw'),
  },
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/common/crypto/field-encryption.js', () => ({
  encrypt: vi.fn((val) => 'encrypted_' + val),
}));

vi.mock('../../src/common/db/transaction.js', () => {
  const mockTrx = vi.fn();
  return {
    withTransaction: vi.fn((fn) => fn(mockTrx)),
    __mockTrx: mockTrx,
  };
});

import knex from '../../src/common/db/knex.js';
import { accountService } from '../../src/modules/accounts/account.service.js';
import { NotFoundError } from '../../src/common/errors/AppError.js';

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

describe('accountService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getById', () => {
    it('throws NotFoundError when account not found', async () => {
      const chain = mockChain(null);
      knex.mockReturnValue(chain);

      await expect(accountService.getById('missing-id')).rejects.toThrow(NotFoundError);
      expect(chain.where).toHaveBeenCalledWith({ id: 'missing-id' });
    });

    it('returns account data on success', async () => {
      const account = { id: 'acc-1', username: 'alice', status: 'active', created_at: '2025-01-01' };
      const chain = mockChain(account);
      knex.mockReturnValue(chain);

      const result = await accountService.getById('acc-1');

      expect(result).toEqual(account);
      expect(chain.first).toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('returns created account', async () => {
      const createdAccount = { id: 'new-1', username: 'bob', status: 'active', created_at: '2025-01-01' };

      // First call: knex('accounts').where({ username }).first('id') for duplicate check
      const duplicateChain = mockChain(null); // no existing user
      knex.mockReturnValue(duplicateChain);

      // The trx returned by withTransaction needs to work as a function too
      const { __mockTrx } = await import('../../src/common/db/transaction.js');
      const trxChain = mockChain(createdAccount);
      __mockTrx.mockReturnValue(trxChain);

      const result = await accountService.create(
        { username: 'bob', password: 'Str0ng!Pass', email: 'bob@test.com', displayName: 'Bob' },
        'actor-1',
        'req-1',
      );

      expect(result).toEqual(createdAccount);
    });
  });

  describe('updateStatus', () => {
    it('throws NotFoundError when account not found', async () => {
      const chain = mockChain(null);
      // first() returns { status: 'active' } for the before lookup, but returning resolves to [null]
      chain.first.mockResolvedValue({ status: 'active' });
      chain.returning.mockResolvedValue([undefined]);
      knex.mockReturnValue(chain);

      await expect(
        accountService.updateStatus('missing-id', 'suspended', 'actor-1', 'req-1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('returns updated account', async () => {
      const updatedAccount = { id: 'acc-1', username: 'alice', status: 'suspended' };
      let callCount = 0;
      knex.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // before lookup: (trx || knex)('accounts').where({ id }).first('status')
          return mockChain({ status: 'active' });
        }
        // update call: (trx || knex)('accounts').where({ id }).update(...).returning(...)
        const chain = mockChain(updatedAccount);
        chain.returning.mockResolvedValue([updatedAccount]);
        return chain;
      });

      const result = await accountService.updateStatus('acc-1', 'suspended', 'actor-1', 'req-1');

      expect(result).toEqual(updatedAccount);
      expect(result.status).toBe('suspended');
    });
  });
});
