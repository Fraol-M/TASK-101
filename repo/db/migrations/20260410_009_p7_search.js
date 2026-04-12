/**
 * Migration 009 — Full-text search: search configuration and search history.
 * The tsvector columns were added to university_versions in migration 004.
 * This migration adds the text-search config and a search query log.
 * Depends on: 004
 */

export async function up(knex) {
  // Create the custom text search configuration (uses unaccent + pg default)
  // This was already referenced in migration 004 as 'grad_search'.
  // Idempotent: skip if it already exists.
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_ts_config WHERE cfgname = 'grad_search'
      ) THEN
        CREATE TEXT SEARCH CONFIGURATION grad_search (COPY = pg_catalog.english);
        ALTER TEXT SEARCH CONFIGURATION grad_search
          ALTER MAPPING FOR hword, hword_part, word
          WITH unaccent, english_stem;
      END IF;
    END;
    $$;
  `);

  // ── Search query log (for analytics / personalization) ────────────────────
  await knex.schema.createTable('search_query_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.text('query_text').notNullable();
    t.string('entity_type', 50).notNullable().defaultTo('all');
    t.integer('result_count').notNullable().defaultTo(0);
    t.integer('duration_ms').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_search_log_account ON search_query_log(account_id, created_at DESC);
    CREATE INDEX idx_search_log_created ON search_query_log(created_at DESC);
  `);

  // Add tsvector search columns to the other versioned entities
  const entityVersionTables = [
    'school_versions',
    'major_versions',
    'research_track_versions',
    'enrollment_plan_versions',
    'transfer_quota_versions',
    'application_requirement_versions',
    'retest_rule_versions',
  ];

  for (const table of entityVersionTables) {
    await knex.raw(`
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('grad_search', COALESCE((payload_json->>'name')::text, '')), 'A') ||
          setweight(to_tsvector('grad_search', COALESCE((payload_json->>'description')::text, '')), 'C')
        ) STORED
    `);
    await knex.raw(`CREATE INDEX IF NOT EXISTS idx_${table}_search ON ${table} USING GIN(search_vector)`);
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('search_query_log');
  // Note: DROP TEXT SEARCH CONFIGURATION is omitted — it would break other objects.
}
