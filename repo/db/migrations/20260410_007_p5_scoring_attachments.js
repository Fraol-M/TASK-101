/**
 * Migration 007 — Scoring forms, score submissions, and file attachments.
 * Depends on: 006 (review_assignments)
 */

export async function up(knex) {
  // ── Scoring form templates (versioned per cycle) ──────────────────────────
  await knex.schema.createTable('scoring_form_templates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('cycle_id').notNullable().references('id').inTable('application_cycles');
    t.string('name', 200).notNullable();
    t.boolean('active').notNullable().defaultTo(true);
    // JSON schema that defines criteria, weights, and field types
    t.jsonb('criteria_schema').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').nullable().references('id').inTable('accounts');
  });

  // ── Review score submissions ───────────────────────────────────────────────
  await knex.schema.createTable('review_scores', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('assignment_id').notNullable().references('id').inTable('review_assignments').onDelete('RESTRICT');
    t.uuid('template_id').notNullable().references('id').inTable('scoring_form_templates');
    // Raw criterion scores as entered by reviewer
    t.jsonb('criterion_scores').notNullable().defaultTo('{}');
    // Weighted composite — computed by service, stored for ranking queries
    t.decimal('composite_score', 6, 3).nullable();
    t.text('narrative_comments').nullable();
    t.string('recommendation', 20).nullable()
      .checkIn(['strong_admit', 'admit', 'borderline', 'reject', 'strong_reject']);
    t.boolean('is_draft').notNullable().defaultTo(true);
    t.timestamp('submitted_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['assignment_id']); // One score per assignment
  });

  await knex.raw(`
    CREATE INDEX idx_review_scores_assignment ON review_scores(assignment_id);
    CREATE INDEX idx_review_scores_composite ON review_scores(composite_score) WHERE is_draft = false;
  `);

  // ── File attachments ───────────────────────────────────────────────────────
  await knex.schema.createTable('review_attachments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('assignment_id').notNullable().references('id').inTable('review_assignments').onDelete('CASCADE');
    t.uuid('uploaded_by').notNullable().references('id').inTable('accounts');
    t.string('original_filename', 500).notNullable();
    // Storage path relative to storageRoot — never store absolute paths
    t.string('storage_path', 1000).notNullable();
    t.string('mime_type', 200).notNullable();
    t.bigint('file_size_bytes').notNullable();
    // SHA-256 hex of the raw file bytes — used for deduplication and integrity checks
    t.string('content_hash', 64).notNullable();
    t.string('virus_scan_status', 20).notNullable().defaultTo('pending')
      .checkIn(['pending', 'clean', 'infected', 'error']);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_attachments_assignment ON review_attachments(assignment_id);
    CREATE UNIQUE INDEX idx_attachments_hash_assignment
      ON review_attachments(assignment_id, content_hash);
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('review_attachments');
  await knex.schema.dropTableIfExists('review_scores');
  await knex.schema.dropTableIfExists('scoring_form_templates');
}
