/**
 * Entry point. Loads config (validates env), then starts the HTTP server.
 * Uses top-level await (requires Node 20+ with "type": "module").
 */
import { loadConfig } from './bootstrap/load-config.js';
import { createApp } from './app.js';
import logger from './common/logging/logger.js';
import knex from './common/db/knex.js';

const config = loadConfig();

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, env: config.nodeEnv },
    'GradAdmissions platform started',
  );
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal }, 'Received shutdown signal, closing gracefully...');

  server.close(async () => {
    try {
      await knex.destroy();
      logger.info('Database connections closed');
    } catch (err) {
      logger.error({ err }, 'Error closing database connections');
    }
    logger.info('Server shut down');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default server;
