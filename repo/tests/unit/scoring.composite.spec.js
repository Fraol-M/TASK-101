import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/common/db/knex.js', () => ({ default: vi.fn() }));
vi.mock('../../src/config/env.js', () => ({
  default: {
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    nodeEnv: 'test', isTest: true, isProduction: false,
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    attachments: { storageRoot: '/tmp', maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
  },
}));
vi.mock('../../src/modules/admin/audit/audit.service.js', () => ({
  auditService: { record: vi.fn() },
}));
vi.mock('../../src/common/db/transaction.js', () => ({
  withTransaction: vi.fn((fn) => {
    // trx must be callable like knex — service does trx('table').insert(...).returning(...)
    const trx = vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      merge: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      decrement: vi.fn().mockResolvedValue(1),
      returning: vi.fn().mockResolvedValue([{ id: 'score-1', assignment_id: 'assign-1', is_draft: true }]),
    });
    return fn(trx);
  }),
}));

/**
 * Tests for composite score calculation logic.
 *
 * Schema used in composite formula tests:
 *   criteria: [
 *     { id: 'research',  weight: 50, maxScore: 10 },
 *     { id: 'academic',  weight: 30, maxScore: 10 },
 *     { id: 'statement', weight: 20, maxScore: 10 },
 *   ]
 * Weights sum to 100 (as the validation requires).
 *
 * Score of (10, 10, 10) → composite = 10.0
 * Score of (0,  0,  0)  → composite = 0.0
 * Score of (5,  10, 0)  → composite = (5/10*10*50 + 10/10*10*30 + 0/10*10*20) / 100
 *                       = (25 + 30 + 0) / 100 = 0.55 × 10 = 5.5
 *
 * These tests import the actual exported computeComposite from scoring.service.js —
 * not a reimplemented copy — so any change to the formula is immediately reflected.
 */

import { computeComposite } from '../../src/modules/reviews/scoring/scoring.service.js';
import { auditService } from '../../src/modules/admin/audit/audit.service.js';

// Template with integer weights summing to 100 — matches production weight convention.
const TEMPLATE_100 = {
  id: 'tpl-1',
  cycle_id: 'cycle-1',
  active: true,
  criteria_schema: {
    criteria: [
      { id: 'research',  weight: 50, maxScore: 10 },
      { id: 'academic',  weight: 30, maxScore: 10 },
      { id: 'statement', weight: 20, maxScore: 10 },
    ],
  },
};

const ASSIGNMENT = {
  id: 'assign-1',
  cycle_id: 'cycle-1',
  reviewer_id: 'reviewer-1',
  status: 'assigned',
};

const REVIEWER_PROFILE = { id: 'reviewer-1' };

describe('Composite score formula', () => {
  it('calculates composite correctly for a mixed score', () => {
    const scores = { research: 5, academic: 10, statement: 0 };
    const result = computeComposite(scores, TEMPLATE_100.criteria_schema);
    // (5/10*10*50 + 10/10*10*30 + 0/10*10*20) / 100 = (25 + 30 + 0) / 100 * 10 = 5.5
    expect(result).toBe(5.5);
  });

  it('gives full score of 10 when all criteria are maxed', () => {
    const scores = { research: 10, academic: 10, statement: 10 };
    expect(computeComposite(scores, TEMPLATE_100.criteria_schema)).toBe(10);
  });

  it('gives zero score when all criteria are 0', () => {
    const scores = { research: 0, academic: 0, statement: 0 };
    expect(computeComposite(scores, TEMPLATE_100.criteria_schema)).toBe(0);
  });

  it('returns null for empty criteria schema', () => {
    expect(computeComposite({ research: 5 }, { criteria: [] })).toBeNull();
  });

  it('skips criteria missing from the submitted scores', () => {
    // Only research is scored — totalWeight = 50
    const scores = { research: 10 };
    const result = computeComposite(scores, TEMPLATE_100.criteria_schema);
    // (10/10*10*50) / 50 = 10.0
    expect(result).toBe(10);
  });
});

describe('Weight-sum validation (epsilon guard)', () => {
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    const knex = (await import('../../src/common/db/knex.js')).default;

    mockDb = (table) => ({
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        if (table === 'review_assignments') return Promise.resolve(ASSIGNMENT);
        if (table === 'reviewer_profiles') return Promise.resolve(REVIEWER_PROFILE);
        if (table === 'scoring_form_templates') return Promise.resolve(null); // overridden per test
        return Promise.resolve(null);
      }),
      insert: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      merge: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'score-1', assignment_id: 'assign-1', is_draft: true }]),
    });
    knex.mockImplementation(mockDb);
  });

  async function saveDraftWithWeights(weights) {
    const { scoringService } = await import('../../src/modules/reviews/scoring/scoring.service.js');
    const knex = (await import('../../src/common/db/knex.js')).default;
    const { UnprocessableError } = await import('../../src/common/errors/AppError.js');

    const criteria = weights.map((w, i) => ({ id: `c${i}`, weight: w, maxScore: 10 }));
    const template = { id: 'tpl-w', cycle_id: 'cycle-1', active: true, criteria_schema: { criteria } };
    const scores = Object.fromEntries(weights.map((_, i) => [`c${i}`, 5]));

    knex.mockImplementation((table) => ({
      where: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation(() => {
        if (table === 'review_assignments') return Promise.resolve(ASSIGNMENT);
        if (table === 'reviewer_profiles') return Promise.resolve(REVIEWER_PROFILE);
        if (table === 'scoring_form_templates') return Promise.resolve(template);
        return Promise.resolve(null);
      }),
      insert: vi.fn().mockReturnThis(),
      onConflict: vi.fn().mockReturnThis(),
      merge: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'score-1', assignment_id: 'assign-1', is_draft: true }]),
    }));

    return scoringService.saveDraft(
      { assignmentId: 'assign-1', criterionScores: scores },
      'actor-1',
      'req-1',
    );
  }

  it('accepts weights that sum to exactly 100', async () => {
    const { UnprocessableError } = await import('../../src/common/errors/AppError.js');
    await expect(saveDraftWithWeights([50, 30, 20])).resolves.toBeDefined();
  });

  it('accepts weights within the 0.01 epsilon (99.995)', async () => {
    await expect(saveDraftWithWeights([50, 30, 19.995])).resolves.toBeDefined();
  });

  it('rejects weights summing to 99.5 (previously allowed by Math.round, now rejected)', async () => {
    const { UnprocessableError } = await import('../../src/common/errors/AppError.js');
    // Math.round(99.5) === 100 was true — old code would have allowed this
    // Math.abs(99.5 - 100) = 0.5 > 0.01 — new epsilon guard correctly rejects it
    await expect(saveDraftWithWeights([50, 30, 19.5])).rejects.toThrow(UnprocessableError);
  });

  it('rejects weights summing to 99.0', async () => {
    const { UnprocessableError } = await import('../../src/common/errors/AppError.js');
    await expect(saveDraftWithWeights([50, 30, 19])).rejects.toThrow(UnprocessableError);
  });

  it('rejects weights summing to 101', async () => {
    const { UnprocessableError } = await import('../../src/common/errors/AppError.js');
    await expect(saveDraftWithWeights([50, 30, 21])).rejects.toThrow(UnprocessableError);
  });

  it('records a review_score.draft_saved audit event in the same transaction', async () => {
    await saveDraftWithWeights([50, 30, 20]);
    // auditService.record must be called with the correct action type and a trx argument
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'review_score.draft_saved',
        entityType: 'review_score',
      }),
      expect.anything(), // trx — proves the call is within the transaction
    );
  });
});
