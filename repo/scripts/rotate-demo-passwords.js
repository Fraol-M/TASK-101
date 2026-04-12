#!/usr/bin/env node
/**
 * Rotate passwords for demo / seed accounts.
 * Only runs in non-production environments.
 *
 * Run: node scripts/rotate-demo-passwords.js
 */

import knex from '../src/common/db/knex.js';
import config from '../src/config/env.js';
import { passwordService } from '../src/modules/auth/password.service.js';

if (config.isProduction) {
  console.error('[rotate-demo-passwords] Refusing to run in production.');
  process.exit(1);
}

const DEMO_USERNAMES = ['admin', 'reviewer1', 'reviewer2', 'applicant1'];
const NEW_PASSWORD = process.env.DEMO_PASSWORD || 'ChangeMe@Demo2026!';

async function run() {
  passwordService.validateComplexity(NEW_PASSWORD);
  const hash = await passwordService.hash(NEW_PASSWORD);

  const updated = await knex('accounts')
    .whereIn('username', DEMO_USERNAMES)
    .update({
      password_hash: hash,
      password_last_rotated_at: new Date().toISOString(),
    });

  console.log(`[rotate-demo-passwords] Updated ${updated} account(s).`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => knex.destroy());
