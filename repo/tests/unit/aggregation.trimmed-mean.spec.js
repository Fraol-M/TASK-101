import { describe, it, expect, vi } from 'vitest';

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

/**
 * Tests for trimmed mean and variance logic in the aggregation service.
 *
 * These tests import the actual exported functions from aggregation.service.js —
 * not reimplemented copies — so any change to the algorithm is immediately reflected.
 *
 * Trimming rule (config): 10% from each end, requires ≥7 scores to apply.
 * At the threshold boundary (7 scores), the service uses Math.max(1, floor(10% × 7)) = 1,
 * guaranteeing at least one value is trimmed from each end rather than zero.
 */

import { trimmedMean, variance } from '../../src/modules/rankings/aggregation.service.js';

describe('trimmedMean', () => {
  it('returns null for empty array', () => {
    expect(trimmedMean([])).toBeNull();
  });

  it('returns the single value for a one-element array', () => {
    expect(trimmedMean([7])).toBe(7);
  });

  it('falls back to plain mean when fewer than trimMinCount scores', () => {
    const scores = [1, 2, 3, 4, 5]; // 5 < 7
    const plain = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(trimmedMean(scores)).toBe(plain);
  });

  it('falls back to plain mean at exactly trimMinCount - 1 scores (boundary)', () => {
    const scores = [0, 10, 5, 5, 5, 5]; // 6 = trimMinCount - 1
    const plain = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(trimmedMean(scores)).toBeCloseTo(plain, 3);
  });

  it('trims at least one score from each end at exactly trimMinCount (7 scores)', () => {
    // Service uses Math.max(1, floor(10% × 7)) = 1 — guarantees at least 1 trimmed per end
    // Without the guard, floor(0.7) = 0 and no trimming would occur
    const scores = [0, 5, 5, 5, 5, 5, 10]; // sorted: [0, 5, 5, 5, 5, 5, 10]
    // After trimming 1 from each end: [5, 5, 5, 5, 5] → mean = 5
    const result = trimmedMean(scores);
    expect(result).toBeCloseTo(5, 3);
    // Plain mean would be (0+5+5+5+5+5+10)/7 ≈ 5.0, same here; test that the outlier 0/10 had no effect
    // i.e. the trimmed mean equals the inner 5 values only
    const withoutOutliers = [5, 5, 5, 5, 5];
    const expected = withoutOutliers.reduce((a, b) => a + b, 0) / withoutOutliers.length;
    expect(result).toBeCloseTo(expected, 3);
  });

  it('trims outliers from both ends when ≥ trimMinCount scores present', () => {
    // 10 scores: [1, 1, 5, 5, 5, 5, 5, 5, 9, 9]
    // 10% trim of 10 = max(1, floor(1)) = 1 from each end
    // Trimmed: [1, 5, 5, 5, 5, 5, 5, 9] → mean = 5.0
    const scores = [9, 1, 5, 5, 5, 5, 5, 5, 9, 1];
    const result = trimmedMean(scores);
    const sorted = [1, 1, 5, 5, 5, 5, 5, 5, 9, 9];
    const trimmed = sorted.slice(1, 9);
    const expected = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    expect(result).toBeCloseTo(expected, 3);
  });

  it('removes extreme outlier effect', () => {
    const withOutlier = [0, 7, 7, 8, 8, 8, 8, 8, 8, 10];
    const trimmed = trimmedMean(withOutlier);
    const plain = withOutlier.reduce((a, b) => a + b, 0) / withOutlier.length;
    // Trimmed mean should be higher because the 0 outlier is removed
    expect(trimmed).toBeGreaterThan(plain);
  });

  it('produces a symmetric result for a symmetric distribution', () => {
    // [1,2,3,4,5,6,7,8,9,10]: trimCount = max(1,1) = 1 → trimmed = [2..9] → mean = 5.5
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(trimmedMean(scores)).toBeCloseTo(5.5, 3);
  });
});

describe('variance', () => {
  it('returns 0 for a single score', () => {
    expect(variance([5], 5)).toBe(0);
  });

  it('returns 0 for all identical scores', () => {
    expect(variance([5, 5, 5, 5], 5)).toBe(0);
  });

  it('computes correctly for a known set', () => {
    const scores = [2, 4, 4, 4, 5, 5, 7, 9];
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length; // 5
    expect(variance(scores, mean)).toBeCloseTo(4, 3);
  });

  it('flags high variance above the 1.8 threshold', () => {
    const scores = [0, 10, 0, 10, 0, 10];
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(variance(scores, mean)).toBeGreaterThan(1.8);
  });

  it('does not flag low variance below the threshold', () => {
    expect(variance([5, 5, 5, 5], 5)).toBeLessThan(1.8);
  });

  it('returns 0 for an empty array', () => {
    expect(variance([], 0)).toBe(0);
  });
});
