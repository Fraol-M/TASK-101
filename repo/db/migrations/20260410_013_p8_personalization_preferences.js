/**
 * Migration 013 — User preferences and tag subscriptions for personalization.
 * Depends on: 001 (accounts), 010 (personalization baseline)
 */

export async function up(knex) {
  // ── User preferences (key/value store) ───────────────────────────────────
  await knex.schema.createTable('user_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // Preference key e.g. 'notify.new_results', 'display.language', 'review.default_sort'
    t.string('pref_key', 100).notNullable();
    t.jsonb('pref_value').notNullable().defaultTo('null');
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'pref_key']);
  });

  // ── Tag / topic subscriptions ─────────────────────────────────────────────
  // Users can subscribe to entity tags (e.g., 'field:AI', 'degree:PhD')
  // to receive recommendations in those areas.
  await knex.schema.createTable('tag_subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('tag', 200).notNullable();
    t.string('tag_type', 50).notNullable().defaultTo('topic')
      .checkIn(['topic', 'field', 'entity_type', 'custom']);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'tag']);
  });

  await knex.raw(`
    CREATE INDEX idx_tag_subs_account ON tag_subscriptions(account_id);
    CREATE INDEX idx_tag_subs_tag ON tag_subscriptions(tag);
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('tag_subscriptions');
  await knex.schema.dropTableIfExists('user_preferences');
}
