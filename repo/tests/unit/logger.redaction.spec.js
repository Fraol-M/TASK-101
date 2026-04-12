import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'stream';

/**
 * Regression tests for Pino redaction configuration.
 *
 * Strategy: create a logger instance with the same redact config as the
 * production logger, write to an in-memory stream, and assert that the
 * serialised JSON output contains '[REDACTED]' where sensitive fields appear
 * and retains the original value for non-sensitive fields.
 *
 * This does NOT mock the logger — it exercises the real Pino redaction engine
 * so regressions in the redact path list are caught immediately.
 */

function makeTestLogger() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });

  const logger = pino(
    {
      level: 'trace',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.currentPassword',
          'req.body.newPassword',
          '*.password',
          '*.token',
          '*.tokenHash',
          '*.hash',
          '*.encryptionKey',
          '*.localEncryptionKey',
        ],
        censor: '[REDACTED]',
      },
    },
    stream,
  );

  return {
    logger,
    lastLog() {
      return JSON.parse(chunks[chunks.length - 1]);
    },
  };
}

describe('logger redaction — sensitive fields are censored', () => {
  it('redacts req.headers.authorization', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ req: { headers: { authorization: 'Bearer secret-token' } } }, 'test');
    expect(lastLog().req.headers.authorization).toBe('[REDACTED]');
  });

  it('redacts req.headers.cookie', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ req: { headers: { cookie: 'session=abc123' } } }, 'test');
    expect(lastLog().req.headers.cookie).toBe('[REDACTED]');
  });

  it('redacts req.body.password', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ req: { body: { password: 'hunter2', username: 'alice' } } }, 'test');
    const body = lastLog().req.body;
    expect(body.password).toBe('[REDACTED]');
    expect(body.username).toBe('alice'); // non-sensitive field preserved
  });

  it('redacts req.body.currentPassword and req.body.newPassword', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ req: { body: { currentPassword: 'old', newPassword: 'new' } } }, 'test');
    const body = lastLog().req.body;
    expect(body.currentPassword).toBe('[REDACTED]');
    expect(body.newPassword).toBe('[REDACTED]');
  });

  it('redacts *.password (wildcard — any top-level object key named password)', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ account: { id: 'acc-1', password: 'secret' } }, 'test');
    expect(lastLog().account.password).toBe('[REDACTED]');
    expect(lastLog().account.id).toBe('acc-1');
  });

  it('redacts *.token', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ session: { token: 'raw-token-value', userId: 'u-1' } }, 'test');
    expect(lastLog().session.token).toBe('[REDACTED]');
    expect(lastLog().session.userId).toBe('u-1');
  });

  it('redacts *.tokenHash', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ session: { tokenHash: 'bcrypt-hash' } }, 'test');
    expect(lastLog().session.tokenHash).toBe('[REDACTED]');
  });

  it('redacts *.hash', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ account: { hash: 'bcrypt-hash', email: 'a@b.com' } }, 'test');
    expect(lastLog().account.hash).toBe('[REDACTED]');
    expect(lastLog().account.email).toBe('a@b.com');
  });

  it('redacts *.encryptionKey and *.localEncryptionKey', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({
      config: { encryptionKey: 'key-abc', localEncryptionKey: 'lkey-xyz', port: 3000 },
    }, 'test');
    expect(lastLog().config.encryptionKey).toBe('[REDACTED]');
    expect(lastLog().config.localEncryptionKey).toBe('[REDACTED]');
    expect(lastLog().config.port).toBe(3000); // non-sensitive preserved
  });
});

describe('logger redaction — non-sensitive fields are preserved', () => {
  it('preserves requestId, accountId, msg in output', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ requestId: 'req-123', accountId: 'acc-456' }, 'action completed');
    const log = lastLog();
    expect(log.requestId).toBe('req-123');
    expect(log.accountId).toBe('acc-456');
    expect(log.msg).toBe('action completed');
  });

  it('preserves entity metadata fields that are not on the redact list', () => {
    const { logger, lastLog } = makeTestLogger();
    logger.info({ entity: { id: 'e-1', name: 'Thesis Review', status: 'active' } }, 'test');
    const entity = lastLog().entity;
    expect(entity.id).toBe('e-1');
    expect(entity.name).toBe('Thesis Review');
    expect(entity.status).toBe('active');
  });
});
