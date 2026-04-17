import Koa from 'koa';
import { koaBody } from 'koa-body';
import { requestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { metricsMiddleware } from './common/middleware/metrics.middleware.js';
import { errorHandlerMiddleware } from './common/errors/error-handler.middleware.js';
import { authMiddleware } from './modules/auth/auth.middleware.js';
import { idempotencyMiddleware } from './common/idempotency/idempotency.middleware.js';
import logger from './common/logging/logger.js';
import { registerRoutes } from './bootstrap/register-routes.js';
import { initMetrics } from './bootstrap/init-metrics.js';
import config from './config/env.js';

/**
 * Creates and configures the Koa application.
 *
 * Middleware stack order (matters):
 *   1. requestId     — assigns ID before anything else so all logs include it
 *   2. logger        — logs request start/end with request ID
 *   3. metrics       — records latency / counts (wraps everything below)
 *   4. errorHandler  — catches all errors from router and downstream middleware
 *   5. bodyParser    — parses body after logging starts (body not logged at entry)
 *   6. auth          — session lookup; sets ctx.state.user
 *   7. router        — dispatches to module handlers
 */
export function createApp() {
  initMetrics();

  const app = new Koa();

  // Trust proxy headers in production
  if (config.isProduction) {
    app.proxy = true;
  }

  // Global error handler for errors not caught by error-handler middleware
  app.on('error', (err, ctx) => {
    if (!ctx || ctx.status < 500) return; // Already logged by middleware
    logger.error({ err, requestId: ctx?.state?.requestId }, 'Koa app-level error');
  });

  // ── Middleware stack ──────────────────────────────────────────────────────
  app.use(requestIdMiddleware());

  // Request lifecycle logger — logs method, path, status, and latency for every request
  app.use(async (ctx, next) => {
    const start = Date.now();
    logger.info({ requestId: ctx.state.requestId, method: ctx.method, path: ctx.path }, 'request start');
    try {
      await next();
    } finally {
      logger.info(
        { requestId: ctx.state.requestId, method: ctx.method, path: ctx.path, status: ctx.status, ms: Date.now() - start },
        'request end',
      );
    }
  });

  app.use(metricsMiddleware());
  app.use(errorHandlerMiddleware(logger));

  app.use(
    koaBody({
      json: true,
      multipart: true,
      parsedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
      formidable: {
        maxFileSize: config.attachments.maxFileBytes,
        maxFields: 20,
      },
      jsonLimit: '1mb',
      textLimit: '1mb',
    }),
  );

  // Auth middleware — sets ctx.state.user; skips public routes
  app.use(authMiddleware());

  // Idempotency — deduplicate write requests by Idempotency-Key header
  app.use(idempotencyMiddleware());

  // Route dispatcher
  const router = registerRoutes();
  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
