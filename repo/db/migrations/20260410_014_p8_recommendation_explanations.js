/**
 * Migration 014 — Recommendation explanation persistence.
 * Stores each recommendation run so explanations are auditable and
 * reproducible outside the request lifecycle.
 * Depends on: 001 (accounts)
 */

export async function up(knex) {
  await knex.schema.createTable('recommendation_explanations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('entity_type', 50).notNullable();
    t.uuid('stable_id').notNullable();
    // Numeric score produced by the scoring pass (0 = cold-start)
    t.integer('score').notNullable().defaultTo(0);
    // Ordered list of scoring rule contributions, e.g.
    // [{"type":"frequently_viewed","viewCount":3},{"type":"bookmarked"}]
    t.jsonb('reasons').notNullable().defaultTo('[]');
    t.timestamp('generated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_rec_exp_account ON recommendation_explanations(account_id, generated_at DESC);
    CREATE INDEX idx_rec_exp_entity  ON recommendation_explanations(entity_type, stable_id);
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('recommendation_explanations');
}
