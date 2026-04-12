/**
 * Migration 004 — University master data: all 8 versioned entities.
 * Each entity has a stable-identity row + version rows (immutable snapshots).
 *
 * Pattern for every entity:
 *   stable table: holds the permanent UUID identifier
 *   versions table: holds immutable published snapshots
 *
 * Partial unique index enforces only-one-active-version-per-entity.
 * Depends on: 001 (accounts for published_by FK)
 */

// Helper to build consistent version table for any entity
function buildVersionTable(knex, tableName, idEntityColumn, extraColumns) {
  return knex.schema.createTable(tableName, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid(idEntityColumn).notNullable(); // FK to stable table set below
    t.integer('version_number').notNullable().defaultTo(1);
    t.string('lifecycle_status', 20).notNullable().defaultTo('draft')
      .checkIn(['draft', 'scheduled', 'active', 'superseded', 'archived']);
    t.date('effective_from').notNullable();
    t.timestamp('published_at', { useTz: true }).nullable();
    t.uuid('published_by').nullable().references('id').inTable('accounts');
    t.text('change_summary').nullable();
    t.jsonb('payload_json').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');

    // Extra entity-specific columns
    if (extraColumns) extraColumns(t);

    t.unique([idEntityColumn, 'version_number']);
  });
}

export async function up(knex) {
  // ── Universities ────────────────────────────────────────────────────────────
  await knex.schema.createTable('universities', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name_normalized', 500).notNullable(); // unaccent(lower(name))
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'university_versions', 'university_id');
  await knex.schema.table('university_versions', (t) => {
    t.foreign('university_id').references('id').inTable('universities').onDelete('RESTRICT');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX idx_univ_ver_active
      ON university_versions(university_id)
      WHERE lifecycle_status = 'active'
  `);
  await knex.raw(`
    CREATE INDEX idx_univ_ver_scheduled
      ON university_versions(university_id, effective_from)
      WHERE lifecycle_status = 'scheduled'
  `);

  // ── Schools / Colleges ───────────────────────────────────────────────────────
  await knex.schema.createTable('schools', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('university_id').notNullable().references('id').inTable('universities').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'school_versions', 'school_id');
  await knex.schema.table('school_versions', (t) => {
    t.foreign('school_id').references('id').inTable('schools').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_school_ver_active ON school_versions(school_id) WHERE lifecycle_status = 'active'`);

  // ── Majors ────────────────────────────────────────────────────────────────────
  await knex.schema.createTable('majors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('school_id').notNullable().references('id').inTable('schools').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'major_versions', 'major_id');
  await knex.schema.table('major_versions', (t) => {
    t.foreign('major_id').references('id').inTable('majors').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_major_ver_active ON major_versions(major_id) WHERE lifecycle_status = 'active'`);

  // ── Research Tracks ───────────────────────────────────────────────────────────
  await knex.schema.createTable('research_tracks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('major_id').notNullable().references('id').inTable('majors').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'research_track_versions', 'research_track_id');
  await knex.schema.table('research_track_versions', (t) => {
    t.foreign('research_track_id').references('id').inTable('research_tracks').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_rt_ver_active ON research_track_versions(research_track_id) WHERE lifecycle_status = 'active'`);

  // ── Enrollment Plans ──────────────────────────────────────────────────────────
  await knex.schema.createTable('enrollment_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('major_id').notNullable().references('id').inTable('majors').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'enrollment_plan_versions', 'enrollment_plan_id');
  await knex.schema.table('enrollment_plan_versions', (t) => {
    t.foreign('enrollment_plan_id').references('id').inTable('enrollment_plans').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_ep_ver_active ON enrollment_plan_versions(enrollment_plan_id) WHERE lifecycle_status = 'active'`);

  // ── Transfer Quotas ───────────────────────────────────────────────────────────
  await knex.schema.createTable('transfer_quotas', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('major_id').notNullable().references('id').inTable('majors').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'transfer_quota_versions', 'transfer_quota_id');
  await knex.schema.table('transfer_quota_versions', (t) => {
    t.foreign('transfer_quota_id').references('id').inTable('transfer_quotas').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_tq_ver_active ON transfer_quota_versions(transfer_quota_id) WHERE lifecycle_status = 'active'`);

  // ── Application Requirements ──────────────────────────────────────────────────
  await knex.schema.createTable('application_requirements', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('major_id').notNullable().references('id').inTable('majors').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'application_requirement_versions', 'application_requirement_id');
  await knex.schema.table('application_requirement_versions', (t) => {
    t.foreign('application_requirement_id').references('id').inTable('application_requirements').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_ar_ver_active ON application_requirement_versions(application_requirement_id) WHERE lifecycle_status = 'active'`);

  // ── Retest Rules ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('retest_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('major_id').notNullable().references('id').inTable('majors').onDelete('RESTRICT');
    t.string('name_normalized', 500).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });
  await buildVersionTable(knex, 'retest_rule_versions', 'retest_rule_id');
  await knex.schema.table('retest_rule_versions', (t) => {
    t.foreign('retest_rule_id').references('id').inTable('retest_rules').onDelete('RESTRICT');
  });
  await knex.raw(`CREATE UNIQUE INDEX idx_rr_ver_active ON retest_rule_versions(retest_rule_id) WHERE lifecycle_status = 'active'`);

  // ── Search tsvector columns (added after tables exist) ────────────────────────
  // University search vector
  await knex.raw(`
    ALTER TABLE university_versions ADD COLUMN IF NOT EXISTS search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('grad_search', COALESCE((payload_json->>'name')::text, '')), 'A') ||
        setweight(to_tsvector('grad_search', COALESCE((payload_json->>'description')::text, '')), 'C')
      ) STORED
  `);
  await knex.raw(`CREATE INDEX idx_univ_ver_search ON university_versions USING GIN(search_vector)`);
}

export async function down(knex) {
  for (const tbl of [
    'retest_rule_versions', 'retest_rules',
    'application_requirement_versions', 'application_requirements',
    'transfer_quota_versions', 'transfer_quotas',
    'enrollment_plan_versions', 'enrollment_plans',
    'research_track_versions', 'research_tracks',
    'major_versions', 'majors',
    'school_versions', 'schools',
    'university_versions', 'universities',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
}
