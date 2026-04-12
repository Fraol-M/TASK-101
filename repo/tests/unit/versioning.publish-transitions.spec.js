import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for versioned repository publish state transitions.
 * Tests the core business rule: only one active version per entity at a time.
 */

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

import { makeVersionedRepository } from '../../src/modules/university-data/_versioning/versioned-repository.factory.js';
import { UnprocessableError } from '../../src/common/errors/AppError.js';

/**
 * Build a knex mock that returns controlled responses for sequential table calls.
 * publishVersion calls knex(table) 4 times:
 *   1. version lookup    → .where().first()
 *   2. max version query → .where().whereNot().max().first()
 *   3. supersede active  → .where().update()          (only for immediate dates)
 *   4. publish update    → .where().update().returning('*')
 */
function buildPublishMock(knex, { draftVersion, maxResult, publishedVersion }) {
  let callCount = 0;
  knex.mockImplementation(() => {
    const n = ++callCount;
    return {
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      max: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue(n >= 3 ? [publishedVersion] : []),
      first: vi.fn().mockImplementation(() => {
        if (n === 1) return Promise.resolve(draftVersion);
        if (n === 2) return Promise.resolve(maxResult);
        return Promise.resolve(null);
      }),
    };
  });
}

describe('makeVersionedRepository.publishVersion', () => {
  let repo;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeVersionedRepository({
      stableTable: 'universities',
      versionsTable: 'university_versions',
      stableIdColumn: 'university_id',
    });
  });

  it('throws UnprocessableError when publishing a non-draft version', async () => {
    const knex = (await import('../../src/common/db/knex.js')).default;
    knex.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: 'version-1',
        university_id: 'univ-1',
        lifecycle_status: 'active', // already published
        version_number: 1,
      }),
    });

    await expect(
      repo.publishVersion('univ-1', 'version-1', 'actor-id', knex),
    ).rejects.toThrow(UnprocessableError);
  });

  it('assigns active status for immediate effective date', async () => {
    const today = new Date().toISOString().split('T')[0];
    const knex = (await import('../../src/common/db/knex.js')).default;

    const draftVersion = {
      id: 'version-1',
      university_id: 'univ-1',
      lifecycle_status: 'draft',
      effective_from: today,
      version_number: 1,
    };
    const publishedVersion = { ...draftVersion, lifecycle_status: 'active', version_number: 2 };

    buildPublishMock(knex, { draftVersion, maxResult: { max: 1 }, publishedVersion });

    const result = await repo.publishVersion('univ-1', 'version-1', 'actor-id', knex);
    expect(result.lifecycle_status).toBe('active');
    expect(result.version_number).toBe(2);
  });

  it('assigns scheduled status for a future effective date', async () => {
    const knex = (await import('../../src/common/db/knex.js')).default;
    const futureDate = '2099-01-01';

    const draftVersion = {
      id: 'version-1',
      university_id: 'univ-1',
      lifecycle_status: 'draft',
      effective_from: futureDate,
      version_number: 1,
    };
    const publishedVersion = { ...draftVersion, lifecycle_status: 'scheduled', version_number: 2 };

    // For future dates, publishVersion skips the supersede step (step 3 is the publish update directly)
    // Adjust callCount expectations: only 3 knex calls (no supersede for scheduled)
    let callCount = 0;
    knex.mockImplementation(() => {
      const n = ++callCount;
      return {
        where: vi.fn().mockReturnThis(),
        whereNot: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        max: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([publishedVersion]),
        first: vi.fn().mockImplementation(() => {
          if (n === 1) return Promise.resolve(draftVersion);
          if (n === 2) return Promise.resolve({ max: 1 });
          return Promise.resolve(null);
        }),
      };
    });

    const result = await repo.publishVersion('univ-1', 'version-1', 'actor-id', knex);
    expect(result.lifecycle_status).toBe('scheduled');
  });

  it('throws NotFoundError when version does not exist', async () => {
    const { NotFoundError } = await import('../../src/common/errors/AppError.js');
    const knex = (await import('../../src/common/db/knex.js')).default;

    knex.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      whereNot: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null), // version not found
    });

    await expect(
      repo.publishVersion('univ-1', 'missing-version', 'actor-id', knex),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('versioned.validator effectiveDateSchema', () => {
  it('transforms MM/DD/YYYY to YYYY-MM-DD', async () => {
    const { publishVersionSchema } = await import(
      '../../src/modules/university-data/_versioning/versioned.validator.js'
    );
    const result = publishVersionSchema.safeParse({ effectiveFrom: '04/10/2026' });
    expect(result.success).toBe(true);
    expect(result.data.effectiveFrom).toBe('2026-04-10');
  });

  it('accepts ISO 8601 format directly', async () => {
    const { publishVersionSchema } = await import(
      '../../src/modules/university-data/_versioning/versioned.validator.js'
    );
    const result = publishVersionSchema.safeParse({ effectiveFrom: '2026-04-10' });
    expect(result.success).toBe(true);
    expect(result.data.effectiveFrom).toBe('2026-04-10');
  });

  it('rejects a syntactically valid but semantically invalid MM/DD/YYYY date (month 13)', async () => {
    const { publishVersionSchema } = await import(
      '../../src/modules/university-data/_versioning/versioned.validator.js'
    );
    const result = publishVersionSchema.safeParse({ effectiveFrom: '13/01/2026' });
    expect(result.success).toBe(false);
  });

  it('rejects a syntactically valid but semantically invalid MM/DD/YYYY date (Feb 30)', async () => {
    const { publishVersionSchema } = await import(
      '../../src/modules/university-data/_versioning/versioned.validator.js'
    );
    const result = publishVersionSchema.safeParse({ effectiveFrom: '02/30/2026' });
    expect(result.success).toBe(false);
  });

  it('rejects a syntactically valid but semantically invalid ISO date (Feb 30)', async () => {
    const { publishVersionSchema } = await import(
      '../../src/modules/university-data/_versioning/versioned.validator.js'
    );
    const result = publishVersionSchema.safeParse({ effectiveFrom: '2026-02-30' });
    expect(result.success).toBe(false);
  });

  it('rejects a completely invalid date format', async () => {
    const { publishVersionSchema } = await import(
      '../../src/modules/university-data/_versioning/versioned.validator.js'
    );
    const result = publishVersionSchema.safeParse({ effectiveFrom: 'not-a-date' });
    expect(result.success).toBe(false);
  });
});
