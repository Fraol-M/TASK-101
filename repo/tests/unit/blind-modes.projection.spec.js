import { describe, it, expect } from 'vitest';
import {
  getColumnsForMode,
  resolveMode,
  projectRow,
} from '../../src/modules/reviews/blind-modes/projection.service.js';

describe('getColumnsForMode', () => {
  it('blind mode includes only non-identity columns', () => {
    const cols = getColumnsForMode('blind');
    expect(cols.some((c) => c.includes('applicant_name'))).toBe(false);
    expect(cols.some((c) => c.includes('contact_email'))).toBe(false);
    expect(cols.some((c) => c.includes('account_id'))).toBe(false);
  });

  it('semi_blind mode includes academic context but not personal identifiers', () => {
    const cols = getColumnsForMode('semi_blind');
    expect(cols.some((c) => c.includes('cycle_id'))).toBe(true);
    expect(cols.some((c) => c.includes('research_fit_score'))).toBe(true);
    expect(cols.some((c) => c.includes('applicant_name'))).toBe(false);
    expect(cols.some((c) => c.includes('account_id'))).toBe(false);
  });

  it('full mode includes all fields including identity', () => {
    const cols = getColumnsForMode('full');
    expect(cols.some((c) => c.includes('applicant_name'))).toBe(true);
    expect(cols.some((c) => c.includes('account_id'))).toBe(true);
  });
});

describe('resolveMode', () => {
  it('returns full mode for SYSTEM_ADMIN', () => {
    const mode = resolveMode(
      { blind_mode: 'blind' },
      { id: 'admin-1', roles: ['SYSTEM_ADMIN'] },
    );
    expect(mode).toBe('full');
  });

  it('returns full mode for PROGRAM_ADMIN', () => {
    const mode = resolveMode(
      { blind_mode: 'semi_blind' },
      { id: 'admin-2', roles: ['PROGRAM_ADMIN'] },
    );
    expect(mode).toBe('full');
  });

  it('returns assignment blind_mode for REVIEWER', () => {
    const mode = resolveMode(
      { blind_mode: 'semi_blind' },
      { id: 'reviewer-1', roles: ['REVIEWER'] },
    );
    expect(mode).toBe('semi_blind');
  });

  it('defaults to blind for REVIEWER with no blind_mode set', () => {
    const mode = resolveMode(
      { blind_mode: null },
      { id: 'reviewer-1', roles: ['REVIEWER'] },
    );
    expect(mode).toBe('blind');
  });
});

describe('projectRow — belt-and-suspenders safety net', () => {
  const fullRow = {
    id: 'assignment-1',
    application_id: 'app-1',
    applicant_account_id: 'account-secret',
    applicant_name_encrypted: 'enc:name',
    contact_email_encrypted: 'enc:email',
    cycle_id: 'cycle-1',
    research_fit_score: 8.5,
    status: 'submitted',
  };

  it('blind mode strips all identity and academic context fields', () => {
    const result = projectRow(fullRow, 'blind');
    expect(result.applicant_account_id).toBeUndefined();
    expect(result.applicant_name_encrypted).toBeUndefined();
    expect(result.contact_email_encrypted).toBeUndefined();
    expect(result.cycle_id).toBeUndefined();
    expect(result.research_fit_score).toBeUndefined();
    // Core fields remain
    expect(result.id).toBe('assignment-1');
    expect(result.status).toBe('submitted');
  });

  it('semi_blind mode strips identity but keeps academic context', () => {
    const result = projectRow(fullRow, 'semi_blind');
    expect(result.applicant_account_id).toBeUndefined();
    expect(result.applicant_name_encrypted).toBeUndefined();
    expect(result.contact_email_encrypted).toBeUndefined();
    expect(result.cycle_id).toBe('cycle-1');
    expect(result.research_fit_score).toBe(8.5);
  });

  it('full mode returns all fields untouched', () => {
    const result = projectRow(fullRow, 'full');
    expect(result).toEqual(fullRow);
  });
});
