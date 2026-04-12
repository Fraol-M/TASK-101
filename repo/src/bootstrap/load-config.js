/**
 * Config bootstrap.
 * Importing this module triggers Zod validation of all environment variables.
 * The process exits immediately if configuration is invalid.
 * Import this before any other application module in server.js.
 */
import config from '../config/env.js';

export function loadConfig() {
  // Config is validated on import; this function just surfaces it for logging
  return config;
}
