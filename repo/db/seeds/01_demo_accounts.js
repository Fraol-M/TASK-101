import bcrypt from 'bcrypt';

/**
 * Seed demo accounts for local development and audit walkthroughs.
 * Password: ChangeMe@Demo2026!
 * Idempotent — safe to re-run.
 */
export async function seed(knex) {
  const hash = await bcrypt.hash('ChangeMe@Demo2026!', 12);

  const DEMO_ACCOUNTS = [
    { username: 'admin',      roleName: 'SYSTEM_ADMIN' },
    { username: 'reviewer1',  roleName: 'REVIEWER'     },
    { username: 'reviewer2',  roleName: 'REVIEWER'     },
    { username: 'applicant1', roleName: 'APPLICANT'    },
  ];

  for (const { username, roleName } of DEMO_ACCOUNTS) {
    // Upsert account — on conflict preserve existing hash, only refresh status
    const [account] = await knex('accounts')
      .insert({ username, password_hash: hash, status: 'active' })
      .onConflict('username')
      .merge(['status'])
      .returning('*');

    const role = await knex('roles').where({ name: roleName }).first();
    if (role) {
      await knex('account_roles')
        .insert({ account_id: account.id, role_id: role.id })
        .onConflict(['account_id', 'role_id'])
        .ignore();
    }
  }
}
