import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the Conflict-of-Interest (COI) service.
 * Verifies the 5-year institution window rule and prior-cycle block.
 */

vi.mock('../../src/common/db/knex.js', () => ({ default: vi.fn() }));
vi.mock('../../src/config/env.js', () => ({
  default: {
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    nodeEnv: 'test', isTest: true, isProduction: false,
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    attachments: { maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
  },
}));

import { coiService } from '../../src/modules/reviews/assignments/coi.service.js';

describe('coiService.checkConflict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports institution conflict when reviewer shares same university within 5 years', async () => {
    const knex = (await import('../../src/common/db/knex.js')).default;
    knex.raw = vi.fn().mockResolvedValue({
      rows: [{
        reviewer_id: 'reviewer-1',
        university_id: 'univ-1',
        reviewer_role: 'employed',
        applicant_role: 'enrolled',
        coi_type: 'institution_affiliation',
        start_date: '2023-01-01',
        end_date: null,
      }],
    });

    const result = await coiService.checkConflict('reviewer-1', 'app-1');
    expect(result.hasConflict).toBe(true);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].type).toBe('institution_affiliation');
  });

  it('reports no conflict when no shared institutions', async () => {
    const knex = (await import('../../src/common/db/knex.js')).default;
    knex.raw = vi.fn().mockResolvedValue({ rows: [] });

    const result = await coiService.checkConflict('reviewer-2', 'app-2');
    expect(result.hasConflict).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it('reports prior-cycle conflict when reviewer reviewed same applicant previously', async () => {
    const knex = (await import('../../src/common/db/knex.js')).default;
    knex.raw = vi.fn().mockResolvedValue({
      rows: [{
        reviewer_id: 'reviewer-1',
        university_id: null,
        reviewer_role: null,
        applicant_role: null,
        coi_type: 'prior_cycle_review',
        start_date: '2025-01-01',
        end_date: '2025-06-01',
      }],
    });

    const result = await coiService.checkConflict('reviewer-1', 'app-3');
    expect(result.hasConflict).toBe(true);
    expect(result.reasons[0].type).toBe('prior_cycle_review');
  });

  it('uses 5-year window from review policies config', async () => {
    const { reviewPolicies } = await import('../../src/config/review-policies.js');
    expect(reviewPolicies.assignment.coiInstitutionWindowYears).toBe(5);
  });
});

describe('coiService.batchCheck', () => {
  it('returns empty set when no pairs have conflicts', async () => {
    const knex = (await import('../../src/common/db/knex.js')).default;
    knex.raw = vi.fn().mockResolvedValue({ rows: [] });

    const result = await coiService.batchCheck([
      { reviewerId: 'r1', applicationId: 'a1' },
      { reviewerId: 'r2', applicationId: 'a1' },
    ]);

    expect(result.size).toBe(0);
  });

  it('returns empty set for empty input', async () => {
    const result = await coiService.batchCheck([]);
    expect(result.size).toBe(0);
  });
});
