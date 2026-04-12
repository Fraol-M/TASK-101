/**
 * Migration 006 — Review assignments and COI policy config.
 * Depends on: 005 (applications, reviewer_profiles)
 */

export async function up(knex) {
  // ── Review assignments ────────────────────────────────────────────────────────
  await knex.schema.createTable('review_assignments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('application_id').notNullable().references('id').inTable('applications').onDelete('RESTRICT');
    t.uuid('reviewer_id').notNullable().references('id').inTable('reviewer_profiles').onDelete('RESTRICT');
    t.uuid('cycle_id').notNullable().references('id').inTable('application_cycles');
    t.string('assignment_mode', 20).notNullable().checkIn(['random', 'rule_based', 'manual']);
    t.string('blind_mode', 20).notNullable().defaultTo('blind').checkIn(['blind', 'semi_blind', 'full']);
    t.string('status', 20).notNullable().defaultTo('assigned')
      .checkIn(['assigned', 'accepted', 'submitted', 'declined', 'expired']);
    t.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('assigned_by').notNullable().references('id').inTable('accounts');
    t.timestamp('submitted_at', { useTz: true }).nullable();
    t.timestamp('due_at', { useTz: true }).nullable();
    t.unique(['application_id', 'reviewer_id', 'cycle_id']);
  });

  await knex.raw(`
    CREATE INDEX idx_assignments_reviewer ON review_assignments(reviewer_id, status);
    CREATE INDEX idx_assignments_application ON review_assignments(application_id);
    CREATE INDEX idx_assignments_cycle ON review_assignments(cycle_id);
  `);

  // ── COI records (audit trail for conflict checks) ─────────────────────────────
  await knex.schema.createTable('coi_check_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('reviewer_id').notNullable().references('id').inTable('reviewer_profiles');
    t.uuid('application_id').notNullable().references('id').inTable('applications');
    t.boolean('has_conflict').notNullable();
    t.jsonb('conflict_reasons').notNullable().defaultTo('[]');
    t.timestamp('checked_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('checked_by').notNullable().references('id').inTable('accounts');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('coi_check_records');
  await knex.schema.dropTableIfExists('review_assignments');
}
