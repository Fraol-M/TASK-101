import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';

/**
 * API test for the public health check endpoint.
 */

vi.mock('../../src/config/env.js', () => ({
  default: {
    port: 3030, nodeEnv: 'test', isProduction: false, isTest: true,
    localEncryptionKey: '0000000000000000000000000000000000000000000000000000000000000000',
    session: { idleTimeoutMinutes: 30, absoluteTimeoutHours: 12 },
    attachments: { storageRoot: '/tmp', maxFileBytes: 10485760, maxFilesPerReview: 5, allowedMimeTypes: [] },
    review: { trimEnabled: true, trimPercent: 10, trimMinCount: 7, varianceThreshold: 1.8 },
    personalization: { historyRetentionDays: 180 },
    search: { defaultLanguage: 'english' },
    logLevel: 'error',
  },
}));

import { createApp } from '../../src/app.js';

let server;

beforeAll(() => {
  server = createApp().callback();
});

describe('GET /health', () => {
  it('returns 200 with status ok and timestamp', async () => {
    const res = await request(server).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  it('does not require authentication', async () => {
    const res = await request(server).get('/health');
    expect(res.status).toBe(200);
  });
});
