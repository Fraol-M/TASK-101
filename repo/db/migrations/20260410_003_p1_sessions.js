/**
 * Migration 003 — Sessions
 * Opaque token sessions with idle and absolute timeouts.
 * Raw tokens are never stored — only SHA-256(token) as BYTEA.
 * Depends on: 001 (accounts)
 */

export async function up(knex) {
  await knex.schema.createTable('sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    // SHA-256 hash of the raw session token (32 bytes)
    t.binary('token_hash', 32).notNullable();
    // Previous token hash valid during the 30s rotation grace window
    t.binary('previous_token_hash', 32).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_active_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('idle_expires_at', { useTz: true }).notNullable();
    t.timestamp('absolute_expires_at', { useTz: true }).notNullable();
    t.timestamp('rotated_at', { useTz: true }).nullable();
    t.timestamp('invalidated_at', { useTz: true }).nullable();
    t.string('invalidated_reason', 50).nullable();
    t.string('ip_address', 45).nullable();
    t.text('user_agent').nullable();
  });

  // Primary lookup: active sessions by token hash
  await knex.raw(`
    CREATE UNIQUE INDEX idx_sessions_token_hash
      ON sessions(token_hash)
      WHERE invalidated_at IS NULL
  `);

  // Previous token hash lookup (rotation grace window)
  await knex.raw(`
    CREATE INDEX idx_sessions_prev_token
      ON sessions(previous_token_hash)
      WHERE invalidated_at IS NULL AND previous_token_hash IS NOT NULL
  `);

  // Account's active sessions
  await knex.raw(`
    CREATE INDEX idx_sessions_account
      ON sessions(account_id)
      WHERE invalidated_at IS NULL
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sessions');
}
