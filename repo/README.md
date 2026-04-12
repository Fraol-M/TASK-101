# GradAdmissions Operations & Review Platform

A fully offline, backend-only graduate admissions platform built with Node.js, Koa, and PostgreSQL.

## Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env — set LOCAL_ENCRYPTION_KEY (see below)

# 2. Start database
docker compose up -d db

# 3. Install dependencies
npm install

# 4. Run migrations
npm run migrate

# 5. Seed reference data (roles, permissions)
npm run seed

# 6. Start server
npm start
# Server runs on http://localhost:3000
```

### Generate encryption key
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Docker (full stack)
```bash
# Set LOCAL_ENCRYPTION_KEY in your environment first
docker compose up -d
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
│       ├── admin/                # Audit events, metrics endpoint
│       ├── university-data/      # 8 versioned entities
│       ├── applications/         # Application records
│       ├── reviews/              # Assignment, scoring, aggregation
│       ├── search/               # Full-text search
│       └── personalization/      # Favorites, history, recommendations
├── db/
│   ├── migrations/               # Knex migration files (40+)
│   └── seeds/                    # Reference data (roles, permissions)
├── storage/attachments/          # Local review attachment storage
├── tests/
│   ├── unit/                     # Business logic tests
│   ├── api/                      # HTTP endpoint tests
│   └── integration/              # DB-level tests
├── scripts/                      # Maintenance scripts
└── docs/                         # Architecture, API contract, security model
```

## Available Scripts

| Command | Description |
|---|---|
| `npm start` | Start production server |
| `npm run dev` | Start with file watching |
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:rollback` | Rollback last migration batch |
| `npm run seed` | Insert reference data |
| `npm test` | Run all tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:api` | API tests only |
| `npm run test:integration` | Integration tests only |
| `npm run reindex-search` | Rebuild search index |
| `npm run purge-history` | Delete expired browsing history |
| `npm run export-metrics` | Write metrics to file |
| `npm run self-audit` | Check audit readiness |

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

- [`docs/architecture.md`](docs/architecture.md) — Module boundaries, request lifecycle, sequence diagrams
- [`docs/api-contract.md`](docs/api-contract.md) — Route groups, request/response examples, permissions
- [`docs/security-model.md`](docs/security-model.md) — Auth, session, encryption, audit, blind mode
- [`docs/permission-matrix.md`](docs/permission-matrix.md) — Role-to-capability mapping
- [`docs/storage-and-attachments.md`](docs/storage-and-attachments.md) — File storage, MIME validation
- [`docs/observability.md`](docs/observability.md) — Logs, metrics, maintenance scripts
- [`docs/requirement-traceability.md`](docs/requirement-traceability.md) — Prompt requirement → code mapping
- [`docs/audit-readiness-checklist.md`](docs/audit-readiness-checklist.md) — Pre-submission verification

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
