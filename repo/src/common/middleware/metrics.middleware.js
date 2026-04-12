import { httpRequestsTotal, httpRequestDurationSeconds } from '../metrics/metrics.js';

/**
 * Middleware that records HTTP request count and duration metrics.
 * Uses a normalised route label to prevent cardinality explosion.
 */
export function metricsMiddleware() {
  return async function metricsRecorder(ctx, next) {
    const start = Date.now();
    try {
      await next();
    } finally {
      const durationSecs = (Date.now() - start) / 1000;
      // Use matched route pattern (e.g. /v1/universities/:stableId) if available
      const route = ctx._matchedRoute || ctx.path;
      const labels = {
        method: ctx.method,
        route,
        status_code: String(ctx.status),
      };
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSecs);
    }
  };
}
