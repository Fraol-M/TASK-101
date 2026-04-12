/**
 * Migration 011 — Audit events table and append-only rules.
 * NOTE: idempotency_keys is created in migration 000 (baseline).
 *       This migration only handles audit_events.
 * Depends on: 001 (accounts)
 */

export async function up(knex) {
  // ── Audit events table (used by audit service) ────────────────────────────
  // createTableIfNotExists guards against re-runs and future merges.
  await knex.schema.createTableIfNotExists('audit_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('actor_account_id').nullable().references('id').inTable('accounts').onDelete('SET NULL');
    t.string('action_type', 100).notNullable();
    t.string('entity_type', 50).notNullable();
    t.uuid('entity_id').nullable();
    t.text('request_id').nullable(); // TEXT not UUID — request IDs are ULIDs (26 chars), not UUID format
    t.jsonb('before_summary').nullable();
    t.jsonb('after_summary').nullable();
    t.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_account_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_events(occurred_at DESC);
  `);

  // PostgreSQL RULE to prevent UPDATE/DELETE on audit_events (append-only)
  await knex.raw(`
    CREATE OR REPLACE RULE audit_events_no_update AS
      ON UPDATE TO audit_events DO INSTEAD NOTHING;
    CREATE OR REPLACE RULE audit_events_no_delete AS
      ON DELETE TO audit_events DO INSTEAD NOTHING;
  `);
}

export async function down(knex) {
  await knex.raw(`
    DROP RULE IF EXISTS audit_events_no_update ON audit_events;
    DROP RULE IF EXISTS audit_events_no_delete ON audit_events;
  `);
  await knex.schema.dropTableIfExists('audit_events');
  // idempotency_keys is owned by migration 000 — not dropped here.
}
