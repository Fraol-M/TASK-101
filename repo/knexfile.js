// =============================================================================
// Knex configuration — three environments: development, test, production
// All schema changes must go through migrations. No manual schema drift.
// =============================================================================

const base = {
  client: 'pg',
  migrations: {
    directory: './db/migrations',
    extension: 'js',
    loadExtensions: ['.js'],
  },
  seeds: {
    directory: './db/seeds',
    loadExtensions: ['.js'],
  },
  pool: {
    min: 2,
    max: 10,
    afterCreate(conn, done) {
      // Enforce UTC and public search_path for every connection
      conn.query('SET timezone = "UTC"; SET search_path = public;', done);
    },
  },
};

export default {
  development: {
    ...base,
    connection: process.env.DATABASE_URL || 'postgresql://graduser:gradpass@localhost:5432/graddb',
  },

  test: {
    ...base,
    connection:
      process.env.DATABASE_URL_TEST ||
      'postgresql://graduser:gradpass@localhost:5432/graddb_test',
    pool: { min: 1, max: 5 },
  },

  production: {
    ...base,
    connection: process.env.DATABASE_URL,
    pool: { min: 2, max: 20 },
    acquireConnectionTimeout: 10000,
  },
};
