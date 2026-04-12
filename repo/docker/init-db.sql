-- =============================================================================
-- PostgreSQL initialisation script.
-- Runs once on first container start (via /docker-entrypoint-initdb.d/).
-- Creates the test database alongside the main database.
-- Also installs the extensions both databases need.
-- =============================================================================

-- Main database is already created by POSTGRES_DB env var.
-- Create the test database for Vitest integration tests.
SELECT 'CREATE DATABASE graddb_test OWNER graduser'
  WHERE NOT EXISTS (
    SELECT FROM pg_database WHERE datname = 'graddb_test'
  )\gexec

-- Extensions for main database
\connect graddb
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Extensions for test database
\connect graddb_test
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
