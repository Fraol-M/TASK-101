import { Registry, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

/**
 * Local metrics registry.
 * Exposed only to authorized admin users via GET /v1/admin/metrics.
 * No external telemetry endpoints.
 */
export const registry = new Registry();

// Collect default Node.js metrics (memory, CPU, GC, etc.)
collectDefaultMetrics({ register: registry });

// ── Custom counters and histograms ────────────────────────────────────────────

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0, 2.0],
  registers: [registry],
});

export const dbQueryDurationSeconds = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['table', 'operation'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.3, 1.0],
  registers: [registry],
});

export const authFailuresTotal = new Counter({
  name: 'auth_failures_total',
  help: 'Total number of authentication failures',
  labelNames: ['reason'],
  registers: [registry],
});

export const reviewSubmissionsTotal = new Counter({
  name: 'review_submissions_total',
  help: 'Total number of review submissions',
  labelNames: ['status'],
  registers: [registry],
});

export const searchQueriesTotal = new Counter({
  name: 'search_queries_total',
  help: 'Total number of search queries',
  registers: [registry],
});

export const recommendationGenerationsTotal = new Counter({
  name: 'recommendation_generations_total',
  help: 'Total number of recommendation generations',
  registers: [registry],
});

export const secondPassEscalationsTotal = new Counter({
  name: 'second_pass_escalations_total',
  help: 'Total number of second-pass review escalations',
  labelNames: ['trigger'],
  registers: [registry],
});

export const attachmentUploadFailuresTotal = new Counter({
  name: 'attachment_upload_failures_total',
  help: 'Total number of attachment upload failures',
  labelNames: ['reason'],
  registers: [registry],
});
