/**
 * Migration 000 — Baseline PostgreSQL extensions and search configuration.
 * Must run before all other migrations.
 * Enables: uuid-ossp, unaccent, pg_stat_statements, pg_trgm
 * Creates: grad_search text search configuration with thesaurus support
 */

export async function up(knex) {
  // ── Extensions ──────────────────────────────────────────────────────────────
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "unaccent"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"');

  // ── Custom full-text search configuration ────────────────────────────────────
  // grad_search uses English stemming as the base configuration.
  // Synonym expansion is handled via the synonyms table and application-level
  // query expansion (see search module) to avoid dependency on filesystem
  // thesaurus files across environments.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_ts_config WHERE cfgname = 'grad_search'
      ) THEN
        CREATE TEXT SEARCH CONFIGURATION grad_search (COPY = english);
        ALTER TEXT SEARCH CONFIGURATION grad_search
          -- Avoid non-standard token types (e.g., 'compound') for portability.
          ALTER MAPPING FOR asciiword, word, numword
          WITH unaccent, english_stem;
      END IF;
    END $$;
  `);

  // ── Idempotency keys table (created in Phase 0 so all migrations can use it) ──
  await knex.schema.createTable('idempotency_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().index();
    t.string('key', 255).notNullable();
    t.string('request_fingerprint', 64).notNullable();
    t.integer('response_status').notNullable();
    t.jsonb('response_body').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.unique(['account_id', 'key']);
  });
  await knex.raw(
    'CREATE INDEX idx_idempotency_expires ON idempotency_keys(expires_at)',
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('idempotency_keys');
  await knex.raw(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'grad_search') THEN
        DROP TEXT SEARCH CONFIGURATION grad_search;
      END IF;
    END $$;
  `);
}
