# GradAdmissions Operations & Review Platform

> **Project type:** backend

A fully offline, backend-only graduate admissions platform built with Node.js, Koa, and PostgreSQL.

## Quick Start

### Prerequisites

- Docker and Docker Compose installed

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env — set LOCAL_ENCRYPTION_KEY (see below)
```

#### Generate encryption key

```bash
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Start all services

```bash
docker-compose up -d
```

This starts PostgreSQL, runs migrations, seeds demo data, and starts the application server on port 3000.

### 3. Verify the system is running

```bash
# Health check
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"..."}

# Login with demo credentials
curl -s -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username": "admin", "password": "ChangeMe@Demo2026!"}' | head -c 200

# List universities (use the token from the login response)
curl -s http://localhost:3000/v1/universities \
  -H 'Authorization: Bearer <token-from-login>'
```

### Demo Credentials

After seeding, the following accounts are available for testing and audit walkthroughs:

| Username | Password | Role |
|---|---|---|
| `admin` | `ChangeMe@Demo2026!` | SYSTEM_ADMIN |
| `progadmin` | `ChangeMe@Demo2026!` | PROGRAM_ADMIN |
| `reviewer1` | `ChangeMe@Demo2026!` | REVIEWER |
| `reviewer2` | `ChangeMe@Demo2026!` | REVIEWER |
| `applicant1` | `ChangeMe@Demo2026!` | APPLICANT |
| `auditor` | `ChangeMe@Demo2026!` | READ_ONLY |

### Development (with live reload)

```bash
docker-compose --profile dev up -d
```

### Run tests

```bash
docker-compose --profile test run --rm test
```

## Project Structure

```
.
├── src/
│   ├── app.js                    # Koa app + middleware stack
│   ├── server.js                 # Entry point with graceful shutdown
│   ├── bootstrap/                # Startup wiring
│   ├── config/                   # Zod-validated environment config
│   ├── common/                   # Cross-cutting utilities
│   │   ├── errors/               # AppError hierarchy
│   │   ├── middleware/           # request-id, validate, metrics
│   │   ├── crypto/               # tokens, field-encryption, sha256
│   │   ├── logging/              # Pino logger with redact list
│   │   ├── metrics/              # prom-client registry
│   │   ├── db/                   # Knex singleton + transaction wrapper
│   │   └── idempotency/          # Idempotency-key middleware
│   └── modules/
│       ├── auth/                 # Login, logout, password rotation, session middleware
│       ├── accounts/             # Account management (admin)
│       ├── rbac/                 # Roles, permissions, requirePermission() factory
│       ├── admin/                # Audit events, metrics endpoint, reviewer pool
│       ├── university-data/      # 8 versioned entities
│       ├── applications/         # Application records
│       ├── reviews/              # Assignment, scoring, workbench, blind modes
│       ├── rankings/             # Aggregation, tie-break, escalation
│       ├── search/               # Full-text search, saved queries
│       └── personalization/      # Bookmarks, history, recommendations, preferences
├── db/
│   ├── migrations/               # Knex migration files (40+)
│   └── seeds/                    # Reference data + demo accounts
├── storage/attachments/          # Local review attachment storage
├── tests/
│   ├── unit/                     # Business logic tests
│   ├── api/                      # HTTP endpoint tests
│   └── integration/              # DB-level tests
├── scripts/                      # Maintenance scripts
└── docs/                         # Architecture and security documentation
```

## Available Scripts

All commands below can be run inside Docker. For convenience, `npm run docker:*` wrappers are provided.

| Command | Description |
|---|---|
| `docker-compose up -d` | Start all services (DB + app) |
| `docker-compose --profile dev up -d` | Start with live reload |
| `docker-compose --profile test run --rm test` | Run all tests |
| `npm run docker:test:unit` | Unit tests only (via Docker) |
| `npm run docker:test:integration` | Integration tests only (via Docker) |
| `npm run docker:migrate` | Apply pending migrations |
| `npm run docker:logs` | Tail application logs |
| `npm run docker:shell` | Open shell in app container |

## Technology Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js >=20 (ESM) |
| HTTP | Koa + @koa/router |
| Database | PostgreSQL 17 + Knex |
| Validation | Zod |
| Testing | Vitest + Supertest |
| Logging | Pino |
| Metrics | prom-client |
| Auth | bcrypt + opaque rotating sessions |
| Crypto | Node.js `crypto` (AES-256-GCM, SHA-256) |
| Deployment | Single-node Docker |

## Documentation

- [`docs/security-model.md`](docs/security-model.md) — Auth, session, encryption, audit, blind mode
- [`docs/permission-matrix.md`](docs/permission-matrix.md) — Role-to-capability mapping

## Non-Functional Targets

| Area | Target |
|---|---|
| Deployment | Single-node Docker, no external network |
| p95 API latency | < 300 ms for common queries at 50 req/s |
| Session idle timeout | 30 minutes |
| Session absolute timeout | 12 hours |
| Browsing history retention | 180 days |
| Attachment size | 10 MB max per file, 5 max per review |
| Audit trail | All create/update/publish/review actions |
| Write safety | Idempotency keys on write operations |
