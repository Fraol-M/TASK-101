/**
 * Migration 005 — Applications, reviewer pool, and institution history.
 * This data drives conflict-of-interest checks.
 * Depends on: 001 (accounts), 004 (university entities for program choices)
 */

export async function up(knex) {
  // ── Application cycles ───────────────────────────────────────────────────────
  await knex.schema.createTable('application_cycles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name', 200).notNullable();
    t.integer('year').notNullable();
    t.string('status', 20).notNullable().defaultTo('open')
      .checkIn(['open', 'closed', 'archived']);
    t.date('open_date').nullable();
    t.date('close_date').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── Applications ─────────────────────────────────────────────────────────────
  // Internal identifiers only — no external applicant identifiers in plaintext
  await knex.schema.createTable('applications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('cycle_id').notNullable().references('id').inTable('application_cycles');
    // Applicant account — linked but kept separate for blind review
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('RESTRICT');
    t.string('status', 30).notNullable().defaultTo('submitted')
      .checkIn(['draft', 'submitted', 'under_review', 'decided', 'withdrawn']);
    // Submission timestamp — used for tie-breaking in rankings
    t.timestamp('submitted_at', { useTz: true }).nullable();
    // Research fit score (0-10) — used as second tie-breaker
    t.decimal('research_fit_score', 4, 2).nullable();
    // Encrypted sensitive fields
    t.text('applicant_name_encrypted').nullable();
    t.text('contact_email_encrypted').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw('CREATE INDEX idx_applications_cycle ON applications(cycle_id)');
  await knex.raw('CREATE INDEX idx_applications_account ON applications(account_id)');
  await knex.raw('CREATE INDEX idx_applications_submitted_at ON applications(submitted_at)');

  // ── Application program choices ──────────────────────────────────────────────
  await knex.schema.createTable('application_program_choices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('application_id').notNullable().references('id').inTable('applications').onDelete('CASCADE');
    t.uuid('major_id').notNullable().references('id').inTable('majors').onDelete('RESTRICT');
    t.integer('preference_order').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['application_id', 'major_id']);
  });

  // ── Applicant institution history (for COI checks) ───────────────────────────
  // Tracks which institutions an applicant has been affiliated with
  await knex.schema.createTable('application_institution_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('application_id').notNullable().references('id').inTable('applications').onDelete('CASCADE');
    // References universities stable ID (not a version row)
    t.uuid('university_id').notNullable().references('id').inTable('universities');
    t.string('role', 50).notNullable().checkIn(['enrolled', 'employed', 'visiting', 'other']);
    t.date('start_date').notNullable();
    t.date('end_date').nullable(); // NULL = currently affiliated
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_app_inst_hist_app ON application_institution_history(application_id);
    CREATE INDEX idx_app_inst_hist_univ ON application_institution_history(university_id);
  `);

  // ── Reviewer profiles ─────────────────────────────────────────────────────────
  // Separate from accounts — a reviewer has additional professional metadata
  await knex.schema.createTable('reviewer_profiles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE').unique();
    t.boolean('available').notNullable().defaultTo(true);
    t.boolean('active').notNullable().defaultTo(true);
    t.integer('max_load').notNullable().defaultTo(10); // max concurrent assignments
    t.integer('active_assignments').notNullable().defaultTo(0);
    t.jsonb('expertise_tags').notNullable().defaultTo('[]');
    t.text('bio_encrypted').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // ── Reviewer institution history (for COI checks) ────────────────────────────
  await knex.schema.createTable('reviewer_institution_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('reviewer_id').notNullable().references('id').inTable('reviewer_profiles').onDelete('CASCADE');
    t.uuid('university_id').notNullable().references('id').inTable('universities');
    t.string('role', 50).notNullable().checkIn(['employed', 'enrolled', 'visiting', 'adjunct', 'other']);
    t.date('start_date').notNullable();
    t.date('end_date').nullable(); // NULL = currently affiliated
    t.boolean('verified').notNullable().defaultTo(false);
    t.timestamp('declared_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Optimised indexes for COI lookups.
  // NOTE: index predicates must be immutable in PostgreSQL, so we cannot use
  // CURRENT_DATE in a partial index predicate.
  await knex.raw(`
    CREATE INDEX idx_rev_inst_hist_reviewer ON reviewer_institution_history(reviewer_id);
    CREATE INDEX idx_rev_inst_hist_coi
      ON reviewer_institution_history(reviewer_id, university_id, end_date);
    CREATE INDEX idx_rev_inst_hist_current
      ON reviewer_institution_history(reviewer_id, university_id)
      WHERE end_date IS NULL;
  `);
}

export async function down(knex) {
  for (const tbl of [
    'reviewer_institution_history',
    'reviewer_profiles',
    'application_institution_history',
    'application_program_choices',
    'applications',
    'application_cycles',
  ]) {
    await knex.schema.dropTableIfExists(tbl);
  }
}
