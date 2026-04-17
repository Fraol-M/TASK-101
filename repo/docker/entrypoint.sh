#!/bin/sh
# =============================================================================
# Production entrypoint.
# 1. Waits for the database to accept connections (belt-and-suspenders on top
#    of compose depends_on: service_healthy).
# 2. Runs pending migrations.
# 3. Execs the Node.js server (replaces this shell process so dumb-init's
#    signal forwarding reaches Node directly).
# =============================================================================

set -e

echo "[entrypoint] NODE_ENV=${NODE_ENV}"

# ── Wait for database ─────────────────────────────────────────────────────────
# The depends_on healthcheck in compose should cover this, but when the
# container is restarted independently this guard prevents connection errors
# before migrations run.
DB_RETRIES=30
DB_DELAY=2

i=0
until node --input-type=module -e "
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.end();
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge "$DB_RETRIES" ]; then
    echo "[entrypoint] ERROR: Database did not become ready after $((DB_RETRIES * DB_DELAY))s" >&2
    exit 1
  fi
  echo "[entrypoint] Waiting for database... (attempt $i/$DB_RETRIES)"
  sleep "$DB_DELAY"
done

echo "[entrypoint] Database is ready."

# ── Run migrations ────────────────────────────────────────────────────────────
echo "[entrypoint] Running database migrations..."
node node_modules/.bin/knex migrate:latest --knexfile knexfile.js
echo "[entrypoint] Migrations complete."

# ── Seed demo data ────────────────────────────────────────────────────────────
echo "[entrypoint] Seeding demo data..."
node node_modules/.bin/knex seed:run --knexfile knexfile.js
echo "[entrypoint] Seeding complete."

# ── Start server ──────────────────────────────────────────────────────────────
echo "[entrypoint] Starting server..."
exec node src/server.js
