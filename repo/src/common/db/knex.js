/**
 * Knex singleton.
 * Imported by all repositories. Uses the environment-appropriate config.
 * The afterCreate hook (in knexfile.js) enforces UTC and public search_path.
 */
import Knex from 'knex';
import knexConfig from '../../../knexfile.js';

const env = process.env.NODE_ENV || 'development';
const config = knexConfig[env];

if (!config) {
  throw new Error(`No Knex configuration found for environment: ${env}`);
}

const knex = Knex(config);

export default knex;
