import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock knex
vi.mock('../../../src/common/db/knex.js', () => {
  const mockKnex = vi.fn();
  mockKnex.transaction = vi.fn();
  return { default: mockKnex };
});

// Use the correct relative path from tests/unit/ to src/
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

vi.mock('../../src/common/crypto/field-encryption.js', () => ({
  maskField: vi.fn().mockReturnValue('[MASKED]'),
  encrypt: vi.fn((val) => 'encrypted_' + val),
}));

// NOTE: Do NOT mock auditService — that is what we are testing.

import knex from '../../src/common/db/knex.js';
import { auditService } from '../../src/modules/admin/audit/audit.service.js';

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

describe('auditService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('record', () => {
    it('inserts event with serialized summaries', async () => {
      const chain = mockChain(undefined);
      knex.mockReturnValue(chain);

      await auditService.record({
        actorAccountId: 'actor-1',
        actionType: 'version.published',
        entityType: 'university',
        entityId: 'ent-1',
        requestId: 'req-1',
        beforeSummary: { status: 'draft' },
        afterSummary: { status: 'active' },
      });

      expect(chain.insert).toHaveBeenCalledWith({
        actor_account_id: 'actor-1',
        action_type: 'version.published',
        entity_type: 'university',
        entity_id: 'ent-1',
        request_id: 'req-1',
        before_summary: JSON.stringify({ status: 'draft' }),
        after_summary: JSON.stringify({ status: 'active' }),
      });
    });
  });

  describe('query', () => {
    it('returns events for SYSTEM_ADMIN (full data, no masking)', async () => {
      const rawRow = {
        id: 'evt-1',
        actor_account_id: 'actor-1',
        action_type: 'version.published',
        before_summary: '{"status":"draft"}',
        after_summary: '{"status":"active"}',
        occurred_at: '2025-06-01T00:00:00Z',
      };
      const chain = mockChain([rawRow]);

      // count query: q.clone().count().first().then(...)
      const countChain = mockChain(undefined);
      countChain.count = vi.fn().mockReturnValue(countChain);
      countChain.first = vi.fn().mockReturnValue({ then: vi.fn((cb) => Promise.resolve(cb({ count: 1 }))) });
      chain.clone = vi.fn().mockReturnValue(countChain);

      // rows query: q.limit().offset() resolves to array
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.offset = vi.fn().mockResolvedValue([rawRow]);

      knex.mockReturnValue(chain);

      const result = await auditService.query(
        { page: 1, pageSize: 10 },
        { roles: ['SYSTEM_ADMIN'] },
      );

      expect(result.events).toHaveLength(1);
      // Admin sees raw data — no masking applied
      expect(result.events[0]).toEqual(rawRow);
    });

    it('masks string values in summaries for non-SYSTEM_ADMIN viewers', async () => {
      const rawRow = {
        id: 'evt-1',
        actor_account_id: 'actor-1',
        action_type: 'version.published',
        before_summary: '{"status":"draft","count":5}',
        after_summary: '{"status":"active"}',
        occurred_at: '2025-06-01T00:00:00Z',
      };
      const chain = mockChain([rawRow]);

      const countChain = mockChain(undefined);
      countChain.count = vi.fn().mockReturnValue(countChain);
      countChain.first = vi.fn().mockReturnValue({ then: vi.fn((cb) => Promise.resolve(cb({ count: 1 }))) });
      chain.clone = vi.fn().mockReturnValue(countChain);

      chain.limit = vi.fn().mockReturnValue(chain);
      chain.offset = vi.fn().mockResolvedValue([rawRow]);

      knex.mockReturnValue(chain);

      const result = await auditService.query(
        { page: 1, pageSize: 10 },
        { roles: ['REVIEWER'] },
      );

      expect(result.events).toHaveLength(1);
      // String values are masked, numbers are left as-is
      expect(result.events[0].before_summary).toEqual({ status: '[MASKED]', count: 5 });
      expect(result.events[0].after_summary).toEqual({ status: '[MASKED]' });
    });
  });
});
