/**
 * Migration 012 — Search saved queries and subscriptions.
 * Depends on: 001 (accounts), 009 (search infrastructure)
 */

export async function up(knex) {
  // ── Saved search queries ───────────────────────────────────────────────────
  await knex.schema.createTable('search_saved_queries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.text('query_text').notNullable();
    // Serialised filter state — entity type filters, date ranges, etc.
    t.jsonb('filters').notNullable().defaultTo('{}');
    // Subscription: if true, user receives notifications when new matching results appear
    t.boolean('subscribed').notNullable().defaultTo(false);
    t.timestamp('last_run_at', { useTz: true }).nullable();
    t.integer('last_result_count').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'name']);
  });

  await knex.raw(`
    CREATE INDEX idx_saved_queries_account ON search_saved_queries(account_id, updated_at DESC);
    CREATE INDEX idx_saved_queries_subscribed ON search_saved_queries(account_id) WHERE subscribed = true;
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('search_saved_queries');
}
