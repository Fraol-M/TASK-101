/**
 * Migration 002 — Roles, permissions, and account-role assignments
 * Depends on: 001 (accounts)
 */

export async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name', 50).notNullable().unique();
    t.text('description').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('permissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    // capability string e.g. 'university-data:publish'
    t.string('capability', 100).notNullable().unique();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.uuid('permission_id').notNullable().references('id').inTable('permissions').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('account_roles', (t) => {
    t.uuid('account_id').notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    t.uuid('role_id').notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.timestamp('assigned_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('assigned_by').nullable().references('id').inTable('accounts');
    t.primary(['account_id', 'role_id']);
  });

  await knex.raw('CREATE INDEX idx_account_roles_account ON account_roles(account_id)');
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('account_roles');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
}
