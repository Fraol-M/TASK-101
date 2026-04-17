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
    verify: vi.fn(),
    validateComplexity: vi.fn(),
    enforceHistory: vi.fn().mockResolvedValue(undefined),
    hash: vi.fn().mockResolvedValue('new-hash'),
    archiveCurrentPassword: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/modules/auth/session.service.js', () => ({
  sessionService: {
    create: vi.fn(),
    invalidate: vi.fn().mockResolvedValue(undefined),
    invalidateAll: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../src/common/metrics/metrics.js', () => ({
  authFailuresTotal: { inc: vi.fn() },
}));

vi.mock('../../src/common/db/transaction.js', () => ({
  withTransaction: vi.fn((fn) => fn({})),
}));

vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn().mockResolvedValue(undefined) },
}));

import knex from '../../src/common/db/knex.js';
import { authService } from '../../src/modules/auth/auth.service.js';
import { passwordService } from '../../src/modules/auth/password.service.js';
import { sessionService } from '../../src/modules/auth/session.service.js';
import { authFailuresTotal } from '../../src/common/metrics/metrics.js';
import { AuthenticationError } from '../../src/common/errors/AppError.js';

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

describe('authService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('login', () => {
    it('throws AuthenticationError for unknown user', async () => {
      const chain = mockChain(null);
      knex.mockReturnValue(chain);
      passwordService.verify.mockResolvedValue(false);

      await expect(authService.login('unknown', 'pass123')).rejects.toThrow(AuthenticationError);
      expect(authFailuresTotal.inc).toHaveBeenCalledWith({ reason: 'unknown_username' });
    });

    it('throws AuthenticationError for inactive account', async () => {
      const chain = mockChain({ id: 'acc-1', password_hash: 'hash', status: 'suspended' });
      knex.mockReturnValue(chain);

      await expect(authService.login('user1', 'pass123')).rejects.toThrow(AuthenticationError);
      expect(authFailuresTotal.inc).toHaveBeenCalledWith({ reason: 'account_inactive' });
    });

    it('throws AuthenticationError for wrong password', async () => {
      const chain = mockChain({ id: 'acc-1', password_hash: 'hash', status: 'active' });
      knex.mockReturnValue(chain);
      passwordService.verify.mockResolvedValue(false);

      await expect(authService.login('user1', 'wrongpass')).rejects.toThrow(AuthenticationError);
      expect(authFailuresTotal.inc).toHaveBeenCalledWith({ reason: 'wrong_password' });
    });

    it('returns { token, accountId } on success', async () => {
      const chain = mockChain({ id: 'acc-1', password_hash: 'hash', status: 'active' });
      knex.mockReturnValue(chain);
      passwordService.verify.mockResolvedValue(true);
      sessionService.create.mockResolvedValue('token-abc');

      const result = await authService.login('user1', 'correctpass');

      expect(result).toEqual({ token: 'token-abc', accountId: 'acc-1' });
      expect(sessionService.create).toHaveBeenCalledWith('acc-1', {});
    });
  });

  describe('logout', () => {
    it('calls sessionService.invalidate with the token', async () => {
      await authService.logout('my-token');

      expect(sessionService.invalidate).toHaveBeenCalledWith('my-token');
    });
  });

  describe('rotatePassword', () => {
    it('throws AuthenticationError when current password is wrong', async () => {
      const chain = mockChain({ id: 'acc-1', password_hash: 'old-hash' });
      knex.mockReturnValue(chain);
      passwordService.verify.mockResolvedValue(false);

      await expect(
        authService.rotatePassword('acc-1', 'wrong-current', 'new-pass'),
      ).rejects.toThrow(AuthenticationError);
    });
  });
});
