/**
 * Migration 010 — Personalization: view history and preference signals.
 * Depends on: 004 (university entity stable tables), 001 (accounts)
 */

export async function up(knex) {
  // ── Entity view history ───────────────────────────────────────────────────
  await knex.schema.createTable('entity_view_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('entity_type', 50).notNullable();
    t.uuid('stable_id').notNullable();
    // Capture the version that was viewed (for audit / reproducibility)
    t.uuid('version_id').nullable();
    t.timestamp('viewed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_view_history_account ON entity_view_history(account_id, viewed_at DESC);
    CREATE INDEX idx_view_history_entity ON entity_view_history(entity_type, stable_id);
  `);

  // ── Saved / bookmarked entities ───────────────────────────────────────────
  await knex.schema.createTable('entity_bookmarks', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('entity_type', 50).notNullable();
    t.uuid('stable_id').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(['account_id', 'entity_type', 'stable_id']);
  });

  await knex.raw(`
    CREATE INDEX idx_bookmarks_account ON entity_bookmarks(account_id, created_at DESC);
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('entity_bookmarks');
  await knex.schema.dropTableIfExists('entity_view_history');
}
