/**
 * Migration 001 — Accounts and password history
 * Depends on: 000 (uuid-ossp extension)
 */

export async function up(knex) {
  await knex.schema.createTable('accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('username', 100).notNullable().unique();
    // bcrypt hash of the current password (never store plaintext)
    t.string('password_hash', 255).notNullable();
    t.timestamp('password_last_rotated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.string('status', 20).notNullable().defaultTo('active')
      .checkIn(['active', 'inactive', 'suspended']);
    // Encrypted sensitive fields (AES-256-GCM via field-encryption.js)
    t.text('email_encrypted').nullable();
    t.text('display_name_encrypted').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('account_password_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.string('password_hash', 255).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    'CREATE INDEX idx_pwd_history_account ON account_password_history(account_id, created_at DESC)',
  );
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('account_password_history');
  await knex.schema.dropTableIfExists('accounts');
}
