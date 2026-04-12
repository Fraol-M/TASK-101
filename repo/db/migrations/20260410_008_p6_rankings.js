/**
 * Migration 008 — Rankings, aggregated scores, and escalation flags.
 * Depends on: 007 (review_scores), 005 (applications)
 */

export async function up(knex) {
  // ── Aggregated score cache (refreshed by aggregation job) ─────────────────
  await knex.schema.createTable('application_score_aggregates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('application_id').notNullable().references('id').inTable('applications').onDelete('CASCADE').unique();
    t.uuid('cycle_id').notNullable().references('id').inTable('application_cycles');
    // How many submitted reviews contributed to this aggregate
    t.integer('reviewer_count').notNullable().defaultTo(0);
    t.decimal('mean_score', 6, 3).nullable();
    t.decimal('trimmed_mean_score', 6, 3).nullable(); // After outlier trim
    t.decimal('score_variance', 8, 4).nullable();
    // Distribution of recommendations: { strong_admit: N, admit: N, ... }
    t.jsonb('recommendation_counts').notNullable().defaultTo('{}');
    // Rank within the cycle (computed by ranking query; NULL until computed)
    t.integer('rank').nullable();
    t.boolean('high_variance_flag').notNullable().defaultTo(false);
    t.boolean('escalation_flag').notNullable().defaultTo(false);
    t.text('escalation_reason').nullable();
    t.timestamp('computed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_score_agg_cycle ON application_score_aggregates(cycle_id, trimmed_mean_score DESC NULLS LAST);
    CREATE INDEX idx_score_agg_rank ON application_score_aggregates(cycle_id, rank NULLS LAST);
    CREATE INDEX idx_score_agg_escalation ON application_score_aggregates(cycle_id) WHERE escalation_flag = true;
  `);

  // ── Escalation event log ───────────────────────────────────────────────────
  await knex.schema.createTable('escalation_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('application_id').notNullable().references('id').inTable('applications').onDelete('CASCADE');
    t.uuid('cycle_id').notNullable().references('id').inTable('application_cycles');
    t.string('trigger', 50).notNullable()
      .checkIn(['high_variance', 'missing_reviews', 'borderline_tie', 'manual']);
    t.text('notes').nullable();
    t.string('resolution', 30).nullable()
      .checkIn(['additional_review', 'committee_vote', 'overridden', 'dismissed']);
    t.uuid('resolved_by').nullable().references('id').inTable('accounts');
    t.timestamp('resolved_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('created_by').notNullable().references('id').inTable('accounts');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('escalation_events');
  await knex.schema.dropTableIfExists('application_score_aggregates');
}
