import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock knex before importing password service
vi.mock('../../src/common/db/knex.js', () => ({
  default: vi.fn(),
}));

// Mock config
vi.mock('../../src/config/env.js', () => ({
  default: {
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    nodeEnv: 'test',
    isProduction: false,
    isTest: true,
  },
}));

import { passwordService } from '../../src/modules/auth/password.service.js';
import { UnprocessableError } from '../../src/common/errors/AppError.js';

describe('passwordService.validateComplexity', () => {
  it('accepts a valid complex password', () => {
    expect(() => passwordService.validateComplexity('Secur3P@ssword!')).not.toThrow();
  });

  it('rejects passwords shorter than 12 characters', () => {
    expect(() => passwordService.validateComplexity('Short1!')).toThrow(UnprocessableError);
  });

  it('rejects passwords with only 2 character classes', () => {
    // lowercase + uppercase only
    expect(() => passwordService.validateComplexity('abcABCdefGHI')).toThrow(UnprocessableError);
  });

  it('accepts passwords with 3 of 4 classes (missing symbol)', () => {
    // uppercase + lowercase + digit = 3 classes ✓
    expect(() => passwordService.validateComplexity('SecurePass123')).not.toThrow();
  });

  it('accepts passwords with 3 of 4 classes (missing digit)', () => {
    // uppercase + lowercase + symbol = 3 classes ✓
    expect(() => passwordService.validateComplexity('SecurePassw@rd')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => passwordService.validateComplexity('')).toThrow(UnprocessableError);
  });

  it('rejects non-string input', () => {
    expect(() => passwordService.validateComplexity(null)).toThrow(UnprocessableError);
  });

  it('rejects a password with exactly 11 characters but right classes', () => {
    expect(() => passwordService.validateComplexity('SecureP@ss1')).toThrow(UnprocessableError);
  });

  it('accepts exactly 12 characters with 3 classes', () => {
    expect(() => passwordService.validateComplexity('SecurePass12')).not.toThrow();
  });
});

describe('passwordService.enforceHistory', () => {
  it('rejects a password that matches a recent hash', async () => {
    const mockKnex = await import('../../src/common/db/knex.js');
    const fakeHash = await import('bcrypt').then((b) => b.hash('OldPass@123456', 12));

    mockKnex.default.mockImplementation(() => ({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue([{ password_hash: fakeHash }]),
      first: vi.fn().mockResolvedValue({ password_hash: fakeHash }),
    }));

    await expect(
      passwordService.enforceHistory('some-account-id', 'OldPass@123456'),
    ).rejects.toThrow(UnprocessableError);
  });
});
