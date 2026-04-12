# System Design — Graduate Admissions Platform

## Table of Contents

1. [Overview](#overview)
2. [Design Goals](#design-goals)
3. [High-Level Architecture](#high-level-architecture)
4. [Deployment](#deployment)
5. [Middleware Chain](#middleware-chain)
6. [Module Structure](#module-structure)
7. [Database Design](#database-design)
8. [Auth & Session Design](#auth--session-design)
9. [RBAC Design](#rbac-design)
10. [Versioned Master Data](#versioned-master-data)
11. [Review Pipeline](#review-pipeline)
12. [Scoring Domain](#scoring-domain)
13. [Blind-Mode Projection](#blind-mode-projection)
14. [Attachment Design](#attachment-design)
15. [Idempotency Design](#idempotency-design)
16. [Rankings & Escalations](#rankings--escalations)
17. [Search Design](#search-design)
18. [Personalization Design](#personalization-design)
19. [Audit Trail](#audit-trail)
20. [Scheduled Tasks](#scheduled-tasks)
21. [Observability](#observability)
22. [Testing Strategy](#testing-strategy)

---

## Overview

The Graduate Admissions Platform is a REST API backend that manages the full lifecycle of a graduate admissions process: applicant self-service (viewing programs, submitting applications), staff/admin operations (managing programs, reviewer pools, assignment batching), reviewer workflows (blind review, scoring, attachments), and program-level analytics (score aggregation, outlier detection, ranking).

**Technology stack:**
- Runtime: Node.js 22+ (ES modules, `"type": "module"`)
- Framework: Koa.js with `@koa/router`
- Database: PostgreSQL 16 with Knex.js query builder
- Validation: Zod (request schemas), Pino (structured logging)
- Test runner: Vitest (unit + integration)
- Container: Docker Compose for local development

---

## Design Goals

| Goal | How achieved |
|------|-------------|
| **Data integrity** | All writes are wrapped in `withTransaction`. Reviewer load counters and audit records are updated atomically with the primary write. |
| **Blind review integrity** | Applicant PII is never included in reviewer-facing responses unless blind mode is `full`. Projection is applied in the workbench service layer, not at the route level, so it cannot be bypassed. |
| **Idempotent writes** | All authenticated write endpoints require an `Idempotency-Key` header. The middleware reserves a slot before handler execution, so concurrent retries with the same key are safe. |
| **Append-only audit** | The `audit_events` table has PostgreSQL rules preventing UPDATE and DELETE. Every write operation in every service calls `auditService.record()` within the same transaction. |
| **Server-side authority** | All derived values (cycle ID from application, reviewer load, composite scores) are computed server-side. Client-supplied duplicates are validated against the server's value and rejected if they differ. |
| **Configurable policies** | Review policies (COI window, min reviewers, trim settings, variance threshold) are centralised in `src/config/review-policies.js` and can be tuned without code changes. |
| **Least-privilege access** | Route-level RBAC (`requirePermission`) is the outer gate; service-layer object checks (reviewer ↔ assignment ownership) are the inner gate. |

---

## High-Level Architecture

```
Client (HTTP)
     │
     ▼
┌─────────────────────────────────────┐
│            Koa Middleware Stack      │
│  requestId → logger → metrics →     │
│  errorHandler → koaBody → auth →    │
│  idempotency → router               │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│          Module Route Handlers       │
│  validate(params/query/body) →      │
│  requirePermission → service call   │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│            Service Layer            │
│  Business logic, COI checks,        │
│  blind projection, aggregation      │
└─────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────┐
│         Database Layer (Knex)        │
│  withTransaction wraps all writes   │
│  Audit record co-committed in trx   │
└─────────────────────────────────────┘
     │
     ▼
   PostgreSQL 16
```

---

## Deployment

**Docker Compose services:**
- `api` — Node.js application server (port 3000)
- `postgres` — PostgreSQL 16
- `healthcheck` — `GET /health` polled by Docker

**Startup sequence (`docker/entrypoint.sh`):**
1. Wait for PostgreSQL to accept connections using `node --input-type=module` probe
2. Run `knex migrate:latest` (idempotent — skips already-run migrations)
3. Run `knex seed:run` (idempotent — seeds are upsert-based)
4. `exec node src/server.js`

**Environment validation:** All required environment variables are validated at startup via Zod in `src/config/env.js`. The process exits immediately on missing or malformed config rather than failing at runtime.

---

## Middleware Chain

Middleware runs in this order on every request:

```
1. requestIdMiddleware
   Generate ULID, attach to ctx.state.requestId, set X-Request-Id response header

2. Request logger
   Log method, path, status, latency at request completion

3. metricsMiddleware
   Increment http_requests_total counter, record http_request_duration_seconds histogram

4. errorHandlerMiddleware
   Catch all downstream errors; format AppError subclasses into structured JSON envelope
   Log 500-level errors with full stack trace

5. koaBody
   Parse JSON (1 MB limit), multipart/form-data (maxFileSize from config)
   Sets ctx.request.body and ctx.request.files

6. authMiddleware
   Skip for: GET /health, POST /v1/auth/login
   Extract Bearer token from Authorization header
   Look up session by SHA-256(token); validate idle + absolute expiry
   If rotationIntervalMs (15 min) elapsed since rotated_at: rotate token,
     return new token in X-Session-Token header, keep old valid for 30s grace
   Set ctx.state.user = { id, username, roles }

7. idempotencyMiddleware
   Skip for non-write methods (GET, HEAD, OPTIONS)
   Skip for unauthenticated requests (no ctx.state.user)
   Require Idempotency-Key header → 400 if missing
   Compute request fingerprint (SHA-256 of method+path+body; includes file hashes for multipart)
   Atomically INSERT idempotency record (reserve slot)
   If slot already exists: replay cached response or return 409 IN_FLIGHT
   After handler success: complete slot with real response (up to 3 retries)
   After handler error: delete pending slot so client can retry

8. router.routes() / router.allowedMethods()
   Dispatch to the appropriate module handler
```

---

## Module Structure

```
src/
├── app.js                    # Koa app creation, middleware wiring
├── server.js                 # HTTP server bind + graceful shutdown
├── config/
│   ├── env.js                # Zod-validated environment config (frozen object)
│   ├── auth.js               # Auth constants derived from env config
│   ├── review-policies.js    # Centralised review business rules
│   ├── storage.js            # Attachment storage config
│   └── search.js             # Search/FTS config
├── common/
│   ├── db/
│   │   ├── knex.js           # Knex singleton
│   │   └── transaction.js    # withTransaction helper
│   ├── errors/AppError.js    # Error hierarchy (ValidationError, NotFoundError, etc.)
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   ├── error-handler.middleware.js
│   │   ├── metrics.middleware.js
│   │   └── request-id.middleware.js
│   ├── idempotency/
│   │   ├── idempotency.middleware.js
│   │   └── idempotency.repository.js
│   ├── validation/validate.js # Zod middleware factory
│   ├── rbac/
│   │   ├── rbac.middleware.js # requirePermission factory
│   │   └── rbac.service.js
│   ├── crypto/tokens.js       # Token generation, requestFingerprint
│   ├── logging/logger.js      # Pino instance with redact config
│   └── metrics/metrics.js     # Prometheus counters/histograms
└── modules/
    ├── auth/
    ├── accounts/
    ├── rbac/
    ├── admin/
    │   └── audit/audit.service.js
    ├── university-data/
    │   ├── versioned.repository.js   # makeVersionedRepository factory
    │   ├── versioned.service.js      # makeVersionedService factory
    │   └── {entity}/route.js         # 8 entity routes
    ├── applications/
    ├── reviews/
    │   ├── assignments/
    │   │   ├── assignment.service.js
    │   │   └── coi.service.js
    │   ├── scoring/scoring.service.js
    │   ├── attachments/attachment.service.js
    │   ├── workbench/workbench.service.js
    │   └── blind-modes/projection.service.js
    ├── rankings/aggregation.service.js
    ├── search/
    └── personalization/
```

---

## Database Design

### Principles

- **UUIDs everywhere:** All primary keys are UUIDs (`uuid_generate_v4()`). This avoids sequential enumeration and enables distributed ID generation.
- **Append-only audit:** `audit_events` uses PostgreSQL rules to block UPDATE and DELETE.
- **Encrypted PII:** `applicant_name_encrypted`, `contact_email_encrypted`, `bio_encrypted`, `email_encrypted`, `display_name_encrypted` store AES-256-GCM ciphertext. Raw values are never persisted in plaintext.
- **JSONB for flexible data:** `payload_json` (versioned entities), `criteria_schema`, `criterion_scores`, `filters`, `reasons` use JSONB for schema flexibility without migrations.
- **Partial unique indexes:** Used for active-version uniqueness (`WHERE lifecycle_status = 'active'`) and session token uniqueness (`WHERE invalidated_at IS NULL`).

### Key Table Relationships

```
accounts ──┬── sessions
           ├── account_roles ── roles ── role_permissions ── permissions
           ├── reviewer_profiles ──── reviewer_institution_history
           ├── applications ──── application_program_choices ── majors
           │               └─── application_institution_history ── universities
           │
review_assignments ──── review_assignments (application_id, reviewer_id, cycle_id unique)
                   ├─── review_scores (1:1 per assignment)
                   └─── review_attachments (N per assignment)
                   
application_score_aggregates (1:1 per application)
escalation_events (N per application)
```

### Migration Phases

| Phase | Tables created |
|-------|---------------|
| P0 | Extensions (uuid-ossp, unaccent, pg_trgm), grad_search FTS config, idempotency_keys |
| P1a | accounts, account_password_history, sessions |
| P1b | roles, permissions, role_permissions, account_roles |
| P2 | 8 stable tables + 8 version tables (versioned university data) |
| P3 | application_cycles, applications, application_program_choices, application_institution_history, reviewer_profiles, reviewer_institution_history |
| P4 | review_assignments, coi_check_records |
| P5 | scoring_form_templates, review_scores, review_attachments |
| P6 | application_score_aggregates, escalation_events |
| P7 | search_query_log, search_saved_queries, search_synonyms |
| P8 | entity_view_history, entity_bookmarks, user_preferences, tag_subscriptions, recommendation_explanations |
| P9 | audit_events (append-only, with PostgreSQL rules) |

---

## Auth & Session Design

### Login Flow

1. Look up account by username
2. `bcrypt.compare(password, account.password_hash)` — cost factor 12
3. Generate 32-byte random token (`crypto.randomBytes(32)`)
4. Store `SHA-256(token)` as `token_hash` (BYTEA, not the raw token)
5. Return raw hex token to client

The server never stores the raw token. Compromise of the database does not expose usable tokens.

### Token Validation (per request)

1. Extract Bearer token from `Authorization` header
2. Compute `SHA-256(token)` → look up session by `token_hash`
3. Check `invalidated_at IS NULL`
4. Check `idle_expires_at > now` (idle timeout)
5. Check `absolute_expires_at > now` (hard cap)
6. Extend `idle_expires_at` by idle timeout window
7. If `rotated_at IS NULL OR now - rotated_at > rotationIntervalMs`: rotate

### Token Rotation

1. Generate new 32-byte token
2. Store new `token_hash`; save old hash in `previous_token_hash`
3. Set `rotated_at = now`
4. Return new token in `X-Session-Token` header
5. Grace window: old token remains valid for 30 seconds (handles in-flight concurrent requests)

### Password Policy

- Minimum 12 characters
- At least 3 of 4 character classes (uppercase, lowercase, digit, symbol)
- Not in the last 5 password hashes (checked via `bcrypt.compare` against `account_password_history`)
- `password_last_rotated_at` tracked for compliance reporting

---

## RBAC Design

### Two-Layer Model

**Layer 1 — Route-level RBAC:**
Every protected route uses `requirePermission('resource', 'action')` middleware. This checks `resource:action` capability against the authenticated user's roles.

```
requirePermission('review', 'submit')
→ loads roles from ctx.state.user.roles
→ looks up capabilities for each role
→ checks if 'review:submit' is in the union of capabilities
→ throws AuthorizationError (403) if not found
```

**Layer 2 — Object-level checks in service layer:**
After passing RBAC, service methods enforce data ownership:
- `assignmentService.getById`: reviewers see only their own assignments (404 mask for non-owners)
- `attachmentService.upload`: verifies caller's reviewer profile matches the assignment's `reviewer_id`
- `scoringService.saveDraft`: verifies reviewer profile ownership
- Personalization: all queries include `account_id = actorId` filter — no cross-account leakage possible

### Role Storage

Roles and permissions are stored in `roles`, `permissions`, `role_permissions` tables. The `account_roles` join table tracks which roles each account has. Capability lookups join all three tables.

The 5 standard roles and 25 capabilities are seeded in `db/seeds/00_roles_permissions.js` using upsert operations (idempotent re-run).

---

## Versioned Master Data

Eight entity types share identical lifecycle behaviour via factory functions.

### Lifecycle State Machine

```
        ┌──────────────────────────────────────────┐
        │                                          │
[create] draft ──[publish]──► active ──[new publish]──► superseded
                    │
                    ▼
              scheduled ──[cron]──► active
                    │
              [archive]──► archived
```

- Only `draft` versions can be edited (`PATCH`)
- Publishing a version transitions the previous `active` version of the same stable entity to `superseded`
- `scheduled` versions are promoted to `active` by the nightly cron script
- `archived` stable entities are excluded from `listCurrent` but remain in version history

### Partial Unique Index

```sql
CREATE UNIQUE INDEX ON major_versions (major_id)
WHERE lifecycle_status = 'active';
```

This enforces "at most one active version per stable entity" at the database level.

### Factory Pattern

```js
// versioned.repository.js
export function makeVersionedRepository(tableName, stableTable, stableIdColumn) { ... }

// versioned.service.js
export function makeVersionedService({ tableName, stableTable, stableIdColumn, entityType }) { ... }
```

Each of the 8 entity modules instantiates its own service/repository by calling the factory. The service layer wraps all state changes in `withTransaction` and calls `auditService.record()` — bypassing the service (e.g., calling the repository directly) would skip audit emission.

### Search Integration

All version tables have a `search_vector tsvector` generated column. The vector is weighted:
- **A weight:** entity name
- **B weight:** description / field name
- **C weight:** remaining payload fields

The custom PostgreSQL FTS configuration `grad_search` adds unaccent normalisation on top of English stemming.

---

## Review Pipeline

The review pipeline processes applications through five stages:

```
1. Assignment
   assignmentService.create / batchAssign
   → COI check (institution window + prior-cycle adjacency)
   → Reviewer load check (active_assignments < max_load)
   → Insert into review_assignments
   → Increment reviewer_profiles.active_assignments

2. Workbench Access
   workbenchService.getForReviewer
   → Load assignment + application
   → Apply blind-mode projection (strip PII per blind mode)

3. Scoring (Draft)
   scoringService.saveDraft
   → Validate criterion IDs against template schema
   → Verify weights sum to 100 ± 0.01
   → Compute composite score server-side
   → Upsert review_scores (is_draft = true)

4. Attachment Upload (optional, during draft phase)
   attachmentService.upload
   → MIME + size validation
   → Magic byte verification
   → FOR UPDATE lock on assignment → re-count → insert

5. Score Submission
   scoringService.submit
   → All criteria required
   → Recommendation required
   → review_assignments.status → 'submitted'
   → reviewer_profiles.active_assignments decremented
```

### COI (Conflict of Interest) Rules

Two rules are enforced by `coiService`:

**Rule 1 — Institution affiliation window:**
Reviewer cannot review an applicant who has been affiliated with the same university as the reviewer within the past 5 years. Affiliation data comes from `reviewer_institution_history` and `application_institution_history`.

**Rule 2 — Prior-cycle review block:**
Reviewer cannot review the same applicant they reviewed (and submitted) in the immediately preceding cycle. "Preceding cycle" is the cycle with the highest year strictly less than the current cycle's year — found via a MAX subquery, not year-1 arithmetic, so gap years are handled correctly.

**Batch COI check:**
For batch assignments, all `(reviewer, application)` pairs are checked in a single SQL query using a `WITH candidate_pairs AS (VALUES ...)` CTE to avoid N×M individual checks.

**COI records:**
Every COI check (regardless of outcome) is recorded in `coi_check_records` for audit purposes.

---

## Scoring Domain

### Composite Score Formula

```
composite = Σ( (raw_i / maxScore_i) × 10 × weight_i ) / Σ(weight_i)
```

- Each criterion score is first normalised to a 0–10 scale
- Then weighted by the criterion's weight percentage
- Result is rounded to 3 decimal places
- Null if no criteria have been scored

**Weight guard:** If template weights don't sum to 100 ± 0.01, the server rejects the score with a 422 error. This catches template misconfiguration before it silently distorts composite scores.

### Submission Rules

- All criteria must have scores before submission (draft allows partial)
- Scores must be multiples of 0.5 (half-point precision)
- Scores must be within [0, criterion.maxScore]
- `recommendation` is required for submission

### Score Template

Each `application_cycle` has one active `scoring_form_template`. The template's `criteria_schema.criteria` array defines:
- `id` — criterion identifier
- `weight` — percentage weight (must sum to 100)
- `maxScore` — raw maximum (normalised to 10 in composite formula)
- `label` — display name

---

## Blind-Mode Projection

The workbench service applies projection to hide applicant PII from reviewers:

| Mode | Hidden fields |
|------|--------------|
| `blind` | `applicantName`, `contactEmail`, `institutionHistory`, `accountId` |
| `semi_blind` | `applicantName`, `contactEmail`, `accountId` (institutions kept) |
| `full` | Nothing hidden (not recommended for reviewers) |

Projection is applied in `workbench.service.js` via `projectionService.project(application, blindMode)` before the response is serialised. The blind mode is stored on the `review_assignments` row at assignment time — it cannot be changed by the reviewer.

---

## Attachment Design

### Validation Pipeline (sequential)

1. MIME type in allow-list (declared)
2. File size ≤ maxFileBytes (declared)
3. Reviewer ownership check
4. Optimistic count pre-check (no lock, early exit)
5. Read file buffer
6. Magic byte detection (`file-type` library) — must match declared MIME
7. SHA-256 hash of file content
8. `mkdir -p` for storage directory
9. `copyFile` temp → storage path

### Storage Layout

```
{attachmentsRoot}/
  {id[0:2]}/
    {id[2:4]}/
      {assignmentId}_{sha256}{ext}
```

Partitioning by the first 4 hex chars of the assignment UUID avoids filesystem hotspots from thousands of files in a single directory.

### Atomicity

A race condition exists between counting current attachments and inserting a new one. This is closed by:

1. `SELECT id FROM review_assignments WHERE id = ? FOR UPDATE` — acquires a row-level lock
2. Re-count attachments under the lock
3. If count ≥ maxFilesPerReview, abort transaction (and delete the file that was written)
4. Insert (with `onConflict(['assignment_id', 'content_hash']).ignore()` for duplicate detection)

The optimistic pre-check (step 4 above, before file I/O) is kept as an early exit to avoid reading files unnecessarily when the cap is obviously exceeded.

### Compensating Cleanup

If the transaction fails after the file has been written, a `catch` block attempts to unlink the file. Failures in the cleanup are swallowed (the DB is the source of truth; unreferenced orphan files are lower risk than a failed upload that blocks the user).

---

## Idempotency Design

### Reservation Pattern

```
reserve(account, key, fingerprint)
  → INSERT INTO idempotency_keys ... ON CONFLICT DO NOTHING
  → Returns true if insert succeeded (slot is ours)
  → Returns false if conflict (slot exists already)
```

This is a single atomic operation. Two concurrent requests with the same key race at the database level — only one wins the INSERT; the other finds the existing record.

### States

| `response_status` | Meaning |
|-------------------|---------|
| `0` | Pending — handler is still running |
| `200`–`299` | Completed — cached response available |

### Completion Retry

After a successful handler, the middleware calls `complete()` to update the slot with the real response status and body. This is retried up to 3 times (50ms, 100ms backoff). If all retries fail, the slot remains in `pending` state rather than being deleted — deleting would allow the client to re-execute the handler, violating the idempotency guarantee. The pending slot expires naturally after 24 hours.

### File Fingerprinting

For multipart uploads, the fingerprint body includes file identity:
```json
{
  "assignmentId": "uuid",
  "__files": {
    "file": { "size": 204800, "sha256": "a3f8..." }
  }
}
```

This means re-uploading a different file with the same idempotency key is correctly detected as a fingerprint conflict and rejected with `409 CONFLICT`.

---

## Rankings & Escalations

### Aggregation (idempotent)

`aggregateCycle(cycleId)`:
1. Load all submitted (non-draft) scores for the cycle
2. Group by application
3. For each application: compute mean, trimmed mean, variance, recommendation distribution
4. Upsert into `application_score_aggregates` (`onConflict.merge`)
5. Auto-escalate high-variance applications (stddev > `varianceThreshold`, default 1.8)

### Trimmed Mean

The trimmed mean removes outlier scores to reduce the impact of a single unusually high or low reviewer:

```
trimCount = max(1, floor(trimPercent/100 × count))
trimmedScores = sorted[trimCount : -trimCount]
trimmedMean = mean(trimmedScores)
```

`Math.max(1, ...)` ensures at least one score is trimmed from each end once `trimMinCount` (default 7) is reached — without this guard, `floor(10% × 7) = 0` and no trimming occurs at exactly the threshold.

Falls back to plain mean if fewer than `trimMinCount` scores exist.

### Ranking

`rankCycle(cycleId)`:
- Order by `trimmed_mean_score DESC`
- Tiebreak 1: `research_fit_score DESC` (pre-computed field on application)
- Tiebreak 2: `submitted_at ASC` (earlier submission wins)
- Assign ordinal `rank` values (1-indexed)

### Escalation Triggers

| Trigger | Source |
|---------|--------|
| `high_variance` | Auto-created by `aggregateCycle` when stddev > threshold |
| `missing_reviews` | Manual |
| `borderline_tie` | Manual |
| `manual` | Manual |

`aggregateCycle` is idempotent — it checks for existing `high_variance` escalation events before inserting to avoid duplicates on re-run.

---

## Search Design

### Full-Text Search

Uses PostgreSQL's built-in FTS with a custom configuration `grad_search`:
- English dictionary (stemming, stop words)
- `unaccent` extension (handles accented characters)
- `pg_trgm` extension (trigram similarity for fuzzy matching)

Queries use `websearch_to_tsquery('grad_search', input)` which accepts natural-language input without requiring tsvector syntax knowledge.

Active versions receive a relevance boost of 1.5× via `ts_rank_cd` weighting.

### Synonym Expansion

Before the FTS query, the search service checks the `search_synonyms` table for the query terms. Synonyms are expanded into the query (e.g., `ml` → `ml | machine learning`).

Pre-seeded abbreviations: `ai`, `cs`, `ml`, `phd`, `ms`, `mba`, `nlp`, `cv`, `bioinformatics`, `data science`.

### Highlighted Excerpts

`ts_headline('grad_search', content, query, 'StartSel=<mark>,StopSel=</mark>,MaxWords=35,MinWords=15,ShortWord=3')` generates excerpts with matched terms wrapped in `<mark>` tags.

### Query Logging

Every search request is logged in `search_query_log` (anonymised — null `account_id` if the user opted out) for analytics: query text, entity type, result count, duration.

---

## Personalization Design

### View History

Records every entity view in `entity_view_history`. Entries older than `historyRetentionDays` (default 180) are excluded from list queries. A background cleanup process (optional) can prune old records.

### Recommendations

The recommendation engine scores entities based on:
- **Tag match:** Subscribed tags that overlap with entity keywords
- **View history:** Recency-weighted view count
- **Bookmark bonus:** Fixed bonus for bookmarked entities

Scores are stored in `recommendation_explanations` with per-rule `reasons` for explainability. The `GET /v1/personalization/recommendations` response returns the full reason breakdown.

### Isolation

All personalization tables have `account_id` as a non-nullable FK. Every query includes `WHERE account_id = actorId` — there is no service path that could return another account's data.

---

## Audit Trail

### Design

The `audit_events` table is append-only. PostgreSQL rules:
```sql
CREATE RULE no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;
```

Every write operation in every service calls `auditService.record()` within the same transaction. If the transaction rolls back, the audit record is also rolled back — there are no orphan audit records for failed operations.

### Schema

```
actor_account_id UUID NULLABLE FK (null for system/cron operations)
action_type      VARCHAR(100)  e.g. 'review_assignment.created'
entity_type      VARCHAR(50)   e.g. 'review_assignment'
entity_id        UUID NULLABLE
request_id       TEXT          ULID (26 chars) from X-Request-Id header
before_summary   JSONB NULLABLE
after_summary    JSONB NULLABLE
occurred_at      TIMESTAMP
```

`actor_account_id` is nullable to support system-initiated operations (e.g., the scheduled promotion cron runs as `null` — identified by `action_type LIKE '%.scheduled_promoted'` and `actor_account_id IS NULL`).

### Sensitive Field Redaction in Logs

Pino logger is configured with a `redact` paths list:
```
req.headers.authorization, req.headers.cookie, req.body.password,
req.body.currentPassword, req.body.newPassword,
*.password, *.token, *.tokenHash, *.hash, *.encryptionKey, *.localEncryptionKey
```

These fields are replaced with `[REDACTED]` in all log output. This is verified by a dedicated unit test (`tests/unit/logger.redaction.spec.js`) that exercises the real Pino engine (not mocks).

---

## Scheduled Tasks

### Version Promotion Script (`scripts/promote-scheduled-versions.js`)

Runs nightly (e.g., via cron or a scheduler). Promotes `scheduled` versions whose `effective_from` date is today or earlier to `active`.

**Uses `makeVersionedService`** (not the repository directly) to ensure audit events are emitted for each promotion. The actor ID is `null` (system) because `audit_events.actor_account_id` is a nullable UUID FK — passing the string `'system'` would cause a FK violation.

**Design:**
1. For each of the 8 entity types, call `service.promoteScheduled(stableId, null, requestId)`
2. `requestId` is `cron-promote-{date}-{stableId}` (unique per run per entity, not a ULID, but still traceable)
3. Errors per entity are caught and logged; the script continues with remaining entities

---

## Observability

### Metrics (Prometheus)

Exposed at `GET /admin/metrics` (requires `metrics:read`).

| Metric | Type | Labels |
|--------|------|--------|
| `http_requests_total` | Counter | `method`, `route`, `status` |
| `http_request_duration_seconds` | Histogram | `method`, `route` |
| `review_submissions_total` | Counter | `status` |
| `attachment_upload_failures_total` | Counter | `reason` |
| `second_pass_escalations_total` | Counter | `trigger` |

### Structured Logging (Pino)

Every log line is JSON with:
- `level` (string)
- `time` (epoch ms)
- `requestId` (ULID)
- `msg` (message string)
- Domain fields (accountId, entityType, assignmentId, etc.)

Sensitive fields are redacted before output (see Audit Trail section).

### Request IDs

Every request gets a ULID assigned by `requestIdMiddleware`. The ULID is:
- Set as `ctx.state.requestId`
- Returned in the `X-Request-Id` response header
- Included in all log lines during request processing
- Stored in `audit_events.request_id` for cross-referencing

---

## Testing Strategy

### Unit Tests (`tests/unit/`)

Test pure functions and business logic in isolation:
- `computeComposite` — scoring formula
- `trimmedMean` / `variance` — aggregation math
- `secureShuffle` — distribution properties
- Logger redaction — real Pino engine with in-memory stream (no mocks)

### Integration Tests (`tests/integration/`)

Test full service behaviour against a real PostgreSQL database:
- `university-data.lifecycle.spec.js` — versioned entity lifecycle
- `personalization.isolation.spec.js` — cross-account isolation
- `saved-queries.ownership.spec.js` — CRUD + ownership enforcement

**Philosophy:** Integration tests do not mock the database. The test database URL is set via `DATABASE_URL_TEST`. Tests run against real migrations and are the only authoritative verification of DB-level constraints (unique indexes, FK enforcement, append-only rules).

### Test Isolation

Each integration test file creates its own accounts and data within the test run. Tests do not assume a clean database state — they create their own fixtures. Cleanup is handled by cascading deletes on the test accounts.

### What Tests Do Not Cover

- Virus scan status transitions (no AV scanner in test environment)
- Distributed race conditions at scale (covered by the SELECT FOR UPDATE design)
- Email delivery (not in scope — emails are encrypted at rest, not sent by this service)
