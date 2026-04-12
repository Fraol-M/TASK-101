/**
 * Authentication configuration constants.
 * Session timeouts, password policy, and token rotation settings.
 */
import config from './env.js';

export const authConfig = Object.freeze({
  session: {
    idleTimeoutMs: config.session.idleTimeoutMinutes * 60 * 1000,
    absoluteTimeoutMs: config.session.absoluteTimeoutHours * 60 * 60 * 1000,
    // Grace window during token rotation (handles concurrent requests)
    rotationGraceMs: 30_000,
    // Rotate token if last_active_at is older than this
    rotationIntervalMs: 15 * 60 * 1000,
  },
  password: {
    minLength: 12,
    historyCount: 5,
    saltRounds: 12,
    // Minimum classes required (upper, lower, digit, symbol) — at least 3
    minClassCount: 3,
  },
  token: {
    // Raw token byte length (32 bytes = 64 hex chars = 256 bits entropy)
    byteLength: 32,
  },
});
