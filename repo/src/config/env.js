import { z } from 'zod';

/**
 * Environment configuration.
 * Validated at startup using Zod — the server refuses to start if any
 * required variable is missing or malformed.
 * This prevents the "starts fine, crashes on first use" failure mode.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),

  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().min(1).default(12),

  ATTACHMENT_STORAGE_ROOT: z.string().default('./storage/attachments'),
  ATTACHMENT_MAX_FILE_BYTES: z.coerce.number().int().min(1).default(10485760),
  ATTACHMENT_MAX_FILES_PER_REVIEW: z.coerce.number().int().min(1).default(5),

  LOCAL_ENCRYPTION_KEY: z.string().length(64, 'Must be a 64-char hex string (32 bytes)'),

  SEARCH_DEFAULT_LANGUAGE: z.string().default('english'),
  HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),

  REVIEW_TRIM_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),
  REVIEW_TRIM_PERCENT: z.coerce.number().min(0).max(50).default(10),
  REVIEW_TRIM_MIN_COUNT: z.coerce.number().int().min(1).default(7),
  REVIEW_VARIANCE_THRESHOLD: z.coerce.number().min(0).default(1.8),

  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

const env = parsed.data;

/**
 * Frozen config object exported to all modules.
 * Access via: import config from './config/env.js'
 */
const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  databaseUrl: env.DATABASE_URL,
  databaseUrlTest: env.DATABASE_URL_TEST,

  session: {
    idleTimeoutMinutes: env.SESSION_IDLE_TIMEOUT_MINUTES,
    absoluteTimeoutHours: env.SESSION_ABSOLUTE_TIMEOUT_HOURS,
  },

  attachments: {
    storageRoot: env.ATTACHMENT_STORAGE_ROOT,
    maxFileBytes: env.ATTACHMENT_MAX_FILE_BYTES,
    maxFilesPerReview: env.ATTACHMENT_MAX_FILES_PER_REVIEW,
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
  },

  localEncryptionKey: env.LOCAL_ENCRYPTION_KEY,

  search: {
    defaultLanguage: env.SEARCH_DEFAULT_LANGUAGE,
  },

  personalization: {
    historyRetentionDays: env.HISTORY_RETENTION_DAYS,
  },

  review: {
    trimEnabled: env.REVIEW_TRIM_ENABLED,
    trimPercent: env.REVIEW_TRIM_PERCENT,
    trimMinCount: env.REVIEW_TRIM_MIN_COUNT,
    varianceThreshold: env.REVIEW_VARIANCE_THRESHOLD,
  },

  logLevel: env.LOG_LEVEL,
});

export default config;
