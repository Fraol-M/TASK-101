import pino from 'pino';

/**
 * Pino structured logger.
 *
 * Redacts sensitive fields from all log output.
 * Never logs: raw passwords, session tokens, encryption keys, raw file content.
 *
 * Log format: JSON with time, level, requestId, accountId, msg, and context fields.
 */
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
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
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
