#!/usr/bin/env bash
# =============================================================================
# Usage: ./run_tests.sh [suite] [options]
#
# Suites (default: all):
#   unit          Run unit tests only
#   api           Run API tests only
#   integration   Run integration tests only
#   coverage      Run all tests with coverage report
#   all           Run all suites (default)
#
# Options:
#   --build       Force rebuild of Docker images before running
#   --keep        Keep test container after run (skip --rm)
#   --no-color    Disable ANSI colour output
#   --help        Show this help message
#
# Examples:
#   ./run_tests.sh                         # run all suites
#   ./run_tests.sh unit                    # unit tests only
#   ./run_tests.sh integration --build     # rebuild, then run integration
#   ./run_tests.sh coverage                # generate coverage report
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

use_color=true

info()    { $use_color && printf "${CYAN}[run_tests]${RESET} %s\n" "$*" || echo "[run_tests] $*"; }
success() { $use_color && printf "${GREEN}[run_tests]${RESET} %s\n" "$*" || echo "[run_tests] $*"; }
warn()    { $use_color && printf "${YELLOW}[run_tests]${RESET} %s\n" "$*" || echo "[run_tests] $*"; }
error()   { $use_color && printf "${RED}[run_tests]${RESET} %s\n" "$*" || echo "[run_tests] $*"; }

# ── Default flags ──────────────────────────────────────────────────────────────
suite="all"
force_build=false
keep_containers=false

# ── Argument parsing ───────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    unit|api|integration|coverage)
      suite="$arg" ;;
    all)
      suite="all" ;;
    --build)
      force_build=true ;;
    --keep)
      keep_containers=true ;;
    --no-color)
      use_color=false ;;
    -h|--help)
      sed -n '3,24p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *)
      error "Unknown argument: $arg"
      error "Run '$0 --help' for usage."
      exit 1 ;;
  esac
done

# ── Map suite name → npm script ────────────────────────────────────────────────
case "$suite" in
  all)        npm_cmd="npm run test" ;;
  unit)       npm_cmd="npm run test:unit" ;;
  api)        npm_cmd="npm run test:api" ;;
  integration) npm_cmd="npm run test:integration" ;;
  coverage)   npm_cmd="npm run test:coverage" ;;
esac

# ── Sanity checks ──────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  error "Docker is not installed or not on PATH."
  exit 1
fi

if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start Docker Desktop and try again."
  exit 1
fi

COMPOSE="docker compose"
if ! $COMPOSE version &>/dev/null 2>&1; then
  # Fall back to legacy docker-compose
  if command -v docker-compose &>/dev/null; then
    COMPOSE="docker-compose"
  else
    error "docker compose / docker-compose not found."
    exit 1
  fi
fi

# ── Resolve project root (directory containing this script) ───────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Build ──────────────────────────────────────────────────────────────────────
if $force_build; then
  info "Rebuilding Docker images (--build flag set)..."
  $COMPOSE --profile test build test
else
  info "Building Docker images if needed..."
  $COMPOSE --profile test build --quiet test
fi

# ── Start Postgres and wait for healthy ────────────────────────────────────────
info "Starting database service..."
$COMPOSE up -d db

info "Waiting for database to be healthy..."
attempts=0
max_attempts=30
until $COMPOSE exec -T db pg_isready -U graduser -d graddb &>/dev/null; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$max_attempts" ]; then
    error "Database did not become healthy after ${max_attempts} attempts."
    $COMPOSE logs db | tail -20
    exit 1
  fi
  sleep 2
done
success "Database is healthy."

# ── Determine --rm flag ────────────────────────────────────────────────────────
rm_flag="--rm"
$keep_containers && rm_flag=""

# ── Run tests ──────────────────────────────────────────────────────────────────
info "Running suite: ${BOLD}${suite}${RESET}"
info "Command      : ${npm_cmd}"
printf '\n'

# Override the default CMD to run only the requested suite.
# Migrations are always run first (same as the default compose command).
set +e
$COMPOSE --profile test run $rm_flag \
  -e "NODE_ENV=test" \
  test \
  sh -c "node node_modules/.bin/knex migrate:latest \
           --knexfile knexfile.js \
           --env test \
         && ${npm_cmd}"
EXIT_CODE=$?
set -e

printf '\n'
if [ "$EXIT_CODE" -eq 0 ]; then
  success "Tests passed (suite: ${suite})."
else
  error "Tests FAILED with exit code ${EXIT_CODE} (suite: ${suite})."
fi

# ── Optional: print coverage location ─────────────────────────────────────────
if [ "$suite" = "coverage" ] && [ "$EXIT_CODE" -eq 0 ]; then
  info "Coverage report written to: coverage/index.html"
fi

exit "$EXIT_CODE"
