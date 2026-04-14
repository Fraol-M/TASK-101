# API Specification — Graduate Admissions Platform

**Base URL:** `http://localhost:3000`  
**API prefix:** `/v1`  
**Format:** All request and response bodies are `application/json` unless the endpoint accepts multipart file uploads.

---

## Table of Contents

1. [Authentication](#authentication)
2. [Request Headers](#request-headers)
3. [Response Envelope](#response-envelope)
4. [Error Codes](#error-codes)
5. [Roles & Permissions](#roles--permissions)
6. [Endpoints](#endpoints)
   - [Health](#health)
   - [Auth](#auth)
   - [Accounts](#accounts)
   - [RBAC & Admin](#rbac--admin)
   - [University Data](#university-data)
   - [Applications](#applications)
   - [Review Assignments](#review-assignments)
   - [Review Scoring](#review-scoring)
   - [Review Attachments](#review-attachments)
   - [Review Workbench](#review-workbench)
   - [Rankings & Escalations](#rankings--escalations)
   - [Search](#search)
   - [Saved Queries](#saved-queries)
   - [Personalization](#personalization)
7. [Config Reference](#config-reference)

---

## Authentication

All protected endpoints require a session token supplied as a Bearer token:

```
Authorization: Bearer <token>
```

Tokens are 32-byte cryptographically random values returned as a 64-character hex string on login. The server stores only the SHA-256 hash (`token_hash`).

**Token rotation:** If a token has been active for more than 15 minutes since `rotated_at`, the server issues a fresh token and returns it in the `X-Session-Token` response header. The client must adopt the new token immediately. The old token remains valid for a 30-second grace window to handle in-flight concurrent requests.

**Session expiry:**
- Idle timeout: 30 minutes of inactivity (default; env-configurable)
- Absolute timeout: 12 hours from session creation (default; env-configurable)

**Unauthenticated routes** (no `Authorization` header needed):
- `GET /health`
- `POST /v1/auth/login`

---

## Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | On protected routes | `Bearer <hex-token>` |
| `Idempotency-Key` | On all authenticated write operations (POST, PUT, PATCH, DELETE) | Client-generated unique key (max 255 chars). Enables safe retries. |
| `Content-Type` | On requests with a body | `application/json` or `multipart/form-data` |

### Idempotency

All authenticated write operations **must** supply an `Idempotency-Key` header or the server returns `400 MISSING_IDEMPOTENCY_KEY`.

Behavior:

| Scenario | Response |
|----------|----------|
| New key | Execute handler, cache response, return real response |
| Same key + same fingerprint, completed | Return cached response (status + body) |
| Same key + same fingerprint, still pending | `409 IDEMPOTENCY_KEY_IN_FLIGHT` |
| Same key + different body | `409 CONFLICT` |

The fingerprint is computed from `SHA-256(method + path + sorted(body))`. For multipart uploads, file identity (`{ size, sha256 }` per field) is merged into the fingerprint body under `__files`.

Idempotency records expire after 24 hours.

---

## Response Envelope

### Success

```json
{
  "data": { ... },
  "meta": {
    "requestId": "01HX...",
    "page": 1,
    "pageSize": 20,
    "total": 143
  }
}
```

Pagination fields (`page`, `pageSize`, `total`) are only present on paginated list responses.

### Error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      { "field": "email", "issue": "Invalid email format" }
    ]
  },
  "meta": { "requestId": "01HX..." }
}
```

`details` is optional and only present when the error has field-level context (e.g., Zod validation failures, COI conflict reasons, missing score criteria).

---

## Error Codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Zod schema validation failed (params, query, or body) |
| 400 | `MISSING_IDEMPOTENCY_KEY` | Authenticated write request missing `Idempotency-Key` header |
| 401 | `AUTHENTICATION_ERROR` | Missing, expired, or invalid session token |
| 403 | `AUTHORIZATION_ERROR` | Authenticated but insufficient permissions for this operation |
| 404 | `NOT_FOUND` | Entity does not exist (also used to mask unauthorized access to prevent enumeration) |
| 409 | `CONFLICT` | Duplicate unique key, idempotency key reused with different body, or version conflict |
| 409 | `IDEMPOTENCY_KEY_IN_FLIGHT` | Concurrent request with the same idempotency key is still processing |
| 422 | `UNPROCESSABLE` | Business rule violation: weights ≠ 100, COI detected, file too large, unsupported MIME type, duplicate upload, reviewer at max load, etc. |
| 500 | `INTERNAL_ERROR` | Unhandled server error |

---

## Roles & Permissions

### Roles

| Role | Description |
|------|-------------|
| `SYSTEM_ADMIN` | Full access — all 25 capabilities |
| `PROGRAM_ADMIN` | Manage programs, cycles, assignments, audit access |
| `REVIEWER` | Submit reviews for their own assigned applications |
| `APPLICANT` | View own applications and university data |
| `READ_ONLY` | Read-only access including audit trail |

### Capability Matrix

| Capability | SYSTEM_ADMIN | PROGRAM_ADMIN | REVIEWER | APPLICANT | READ_ONLY |
|-----------|:---:|:---:|:---:|:---:|:---:|
| `auth:login` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `auth:logout` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `accounts:self:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `accounts:self:update-password` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `accounts:admin:manage` | ✓ | | | | |
| `rbac:read` | ✓ | ✓ | | | ✓ |
| `rbac:write` | ✓ | | | | |
| `audit:read` | ✓ | ✓ | | | ✓ |
| `metrics:read` | ✓ | | | | |
| `university-data:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `university-data:write` | ✓ | ✓ | | | |
| `university-data:publish` | ✓ | ✓ | | | |
| `university-data:archive` | ✓ | ✓ | | | |
| `applications:read` | ✓ | ✓ | | ✓ | ✓ |
| `applications:write` | ✓ | ✓ | | ✓ | |
| `reviewers:manage` | ✓ | ✓ | | | |
| `review-assignments:manage` | ✓ | ✓ | | | |
| `review:read-assigned` | ✓ | ✓ | ✓ | | |
| `review:submit` | ✓ | ✓ | ✓ | | |
| `rankings:read` | ✓ | ✓ | | | ✓ |
| `rankings:compute` | ✓ | ✓ | | | |
| `escalations:write` | ✓ | ✓ | | | |
| `search:query` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `search:saved-query:manage` | ✓ | ✓ | ✓ | ✓ | |
| `personalization:self:read` | ✓ | ✓ | ✓ | ✓ | |
| `personalization:self:write` | ✓ | ✓ | ✓ | ✓ | |

**Object-level rules (enforced in service layer, not just RBAC):**
- Reviewers see only their own assignments, scores, and attachments — admins see all.
- Personalization data is always scoped to the authenticated account — no cross-account access.
- Reviewers cannot read application PII in blind mode (projected by workbench service).

---

## Endpoints

### Health

#### `GET /health`

No authentication required.

**Response 200**
```json
{ "status": "ok" }
```

---

### Auth

#### `POST /v1/auth/login`

No authentication or idempotency key required.

**Request body**
```json
{
  "username": "alice",
  "password": "S3cureP@ssw0rd!"
}
```

**Response 200**
```json
{
  "data": {
    "token": "a3f8...(64 hex chars)",
    "account": {
      "id": "uuid",
      "username": "alice",
      "roles": ["REVIEWER"]
    }
  }
}
```

**Errors:** `401` invalid credentials, `422` account suspended or inactive.

---

#### `POST /v1/auth/logout`

Requires: `auth:logout`

Invalidates the current session. Body is empty.

**Response 204** (no body)

---

#### `POST /v1/auth/password/rotate`

Requires: `accounts:self:update-password`

**Request body**
```json
{
  "currentPassword": "OldP@ssword1!",
  "newPassword": "NewP@ssword2!"
}
```

Password rules:
- Minimum 12 characters
- At least 3 of 4 character classes (uppercase, lowercase, digit, symbol)
- Must not match any of the last 5 passwords

**Response 204** (no body)

**Errors:** `422` current password wrong or new password fails policy or is in history.

---

### Accounts

#### `GET /v1/accounts/me`

Requires: `accounts:self:read`

**Response 200**
```json
{
  "data": {
    "id": "uuid",
    "username": "alice",
    "status": "active",
    "roles": ["REVIEWER"],
    "passwordLastRotatedAt": "2026-01-15T10:00:00Z"
  }
}
```

---

#### `POST /v1/accounts`

Requires: `accounts:admin:manage`

**Request body**
```json
{
  "username": "bob",
  "password": "InitialP@ss1!",
  "email": "bob@example.com",
  "displayName": "Bob Smith",
  "roles": ["APPLICANT"]
}
```

**Response 201**
```json
{ "data": { "id": "uuid", "username": "bob", "status": "active" } }
```

---

#### `GET /v1/accounts/:id`

Requires: `accounts:admin:manage`

Path params: `id` — UUID of the account.

**Response 200** — account object

---

#### `PATCH /v1/accounts/:id/status`

Requires: `accounts:admin:manage`

**Request body**
```json
{ "status": "suspended" }
```

Valid values: `active`, `inactive`, `suspended`.

**Response 200** — updated account object

---

### RBAC & Admin

#### `GET /v1/admin/roles`

Requires: `rbac:read`

**Response 200**
```json
{
  "data": [
    { "id": "uuid", "name": "REVIEWER", "description": "...", "capabilities": ["review:submit", "review:read-assigned"] }
  ]
}
```

---

#### `POST /v1/admin/roles`

Requires: `rbac:write`

**Request body**
```json
{ "name": "CUSTOM_ROLE", "description": "Custom role for X", "capabilities": ["search:query"] }
```

**Response 201** — created role object

---

#### `PATCH /v1/admin/roles/:id`

Requires: `rbac:write`

**Request body** — partial update of `description` or `capabilities`.

**Response 200** — updated role object

---

#### `POST /v1/admin/accounts/:id/roles`

Requires: `rbac:write`

Assign or remove roles on an account.

**Request body**
```json
{ "add": ["REVIEWER"], "remove": ["APPLICANT"] }
```

**Response 200** — updated account roles

---

#### `GET /v1/admin/permissions`

Requires: `rbac:read`

Returns all 25 capability strings with descriptions.

**Response 200**
```json
{ "data": [{ "id": "uuid", "capability": "review:submit" }] }
```

---

#### `GET /v1/admin/audit-events`

Requires: `audit:read`

**Query params:**
- `actorAccountId` (UUID, optional)
- `entityType` (string, optional)
- `actionType` (string, optional)
- `from` / `to` (ISO datetime, optional)
- `page`, `pageSize` (default 20, max 100)

**Response 200** — paginated list of audit events

---

#### `GET /v1/admin/metrics`

Requires: `metrics:read`

Returns Prometheus text-format metrics.

**Response 200** `text/plain; version=0.0.4`

---

#### `GET /v1/admin/reviewer-pool`

Requires: `reviewers:manage`

**Query params:** `page`, `pageSize`, `available` (boolean), `active` (boolean)

**Response 200** — paginated list of reviewer profiles

---

#### `POST /v1/admin/reviewer-pool`

Requires: `reviewers:manage`

Create a reviewer profile for an existing account.

**Request body**
```json
{
  "accountId": "uuid",
  "maxLoad": 10,
  "expertiseTags": ["machine learning", "computer science"],
  "bio": "Professor of CS at State University"
}
```

**Response 201** — created reviewer profile

---

#### `PATCH /v1/admin/reviewer-pool/:id`

Requires: `reviewers:manage`

Path params: `id` — UUID of reviewer profile.

**Request body** — any subset of `{ available, active, maxLoad, expertiseTags, bio }`.

**Response 200** — updated reviewer profile

---

#### `POST /v1/admin/reviewer-pool/:id/institution-history`

Requires: `reviewers:manage`

Add an institution affiliation record for COI tracking.

**Request body**
```json
{
  "universityId": "uuid",
  "role": "employed",
  "startDate": "2020-09-01",
  "endDate": null
}
```

Valid roles: `employed`, `enrolled`, `visiting`, `adjunct`, `other`.

**Response 201** — created history record

---

### University Data

Eight versioned entity types share identical route patterns. Replace `{entity}` with:
`universities`, `schools`, `majors`, `research-tracks`, `enrollment-plans`, `transfer-quotas`, `application-requirements`, `retest-rules`

All university-data write routes require `university-data:write`, publish requires `university-data:publish`, archive requires `university-data:archive`, reads require `university-data:read`.

**Lifecycle states:** `draft` → `scheduled` or `active` (via publish) → `superseded` (when a new version is published for the same stable entity) → `archived`

#### `POST /v1/{entity}`

Create a new stable entity with an initial draft version.

**Request body**
```json
{
  "name": "Computer Science",
  "payload": { "field": "engineering", "description": "..." },
  "changeSummary": "Initial draft"
}
```

**Response 201**
```json
{
  "data": {
    "stableId": "uuid",
    "versionId": "uuid",
    "lifecycleStatus": "draft",
    "versionNumber": 1
  }
}
```

---

#### `GET /v1/{entity}`

List all stable entities with their current active version.

**Query params:** `page`, `pageSize`, `search` (full-text)

**Response 200** — paginated list

---

#### `GET /v1/{entity}/:stableId`

Get the stable entity record.

---

#### `GET /v1/{entity}/:stableId/current`

Get the currently active version's full payload.

**Response 404** if no active version exists.

---

#### `POST /v1/{entity}/:stableId/versions`

Create a new draft version for an existing stable entity.

**Request body**
```json
{
  "payload": { ... },
  "changeSummary": "Updated enrollment limits for 2027",
  "effectiveFrom": "2027-01-01"
}
```

**Response 201** — new version object with `lifecycleStatus: "draft"`

---

#### `PATCH /v1/{entity}/:stableId/versions/:versionId`

Update a draft version. Only `draft` versions can be edited.

**Response 200** — updated version

**Error 422** if version is not in `draft` status.

---

#### `GET /v1/{entity}/:stableId/versions`

List all versions for a stable entity, ordered by `version_number` descending.

---

#### `GET /v1/{entity}/:stableId/versions/:versionId`

Get a specific version by ID.

---

#### `POST /v1/{entity}/:stableId/versions/:versionId/publish`

Publish a draft or scheduled version. Transitions to `active`; any previously active version of the same stable entity becomes `superseded`.

**Request body**
```json
{
  "effectiveFrom": "2026-09-01"
}
```

If `effectiveFrom` is a future date, the version transitions to `scheduled` and is promoted to `active` by the nightly `scripts/promote-scheduled-versions.js` cron script.

**Response 200** — published version object

---

#### `POST /v1/{entity}/:stableId/archive`

Archive a stable entity and all its versions. Archived entities are excluded from `listCurrent` results.

**Response 200** — archived stable entity

---

### Applications

#### `POST /v1/applications`

Requires: `applications:write`

**Request body**
```json
{
  "cycleId": "uuid",
  "applicantName": "Jane Doe",
  "contactEmail": "jane@example.com",
  "programChoices": [
    { "majorId": "uuid", "preferenceOrder": 1 },
    { "majorId": "uuid", "preferenceOrder": 2 }
  ],
  "institutionHistory": [
    { "universityId": "uuid", "role": "enrolled", "startDate": "2020-09-01", "endDate": "2024-05-30" }
  ]
}
```

PII fields (`applicantName`, `contactEmail`) are encrypted at rest using AES-256-GCM.

**Response 201** — application object

---

#### `GET /v1/applications`

Requires: `applications:read`

**Query params:**
- `cycleId` (UUID, optional)
- `status` (optional): `draft`, `submitted`, `under_review`, `decided`, `withdrawn`
- `page`, `pageSize` (default 20, max 100)

**Response 200** — paginated list

---

#### `GET /v1/applications/:id`

Requires: `applications:read`

Path params: `id` — UUID.

**Response 200** — application object

---

### Review Assignments

#### `POST /v1/assignments`

Requires: `review-assignments:manage`

Manual (direct) assignment of a reviewer to an application.

**Request body**
```json
{
  "applicationId": "uuid",
  "reviewerId": "uuid",
  "mode": "manual",
  "blindMode": "blind",
  "dueAt": "2026-06-01T23:59:59Z"
}
```

`mode`: `random`, `rule_based`, `manual`  
`blindMode`: `blind`, `semi_blind`, `full`

The server derives `cycleId` from the application record — client-supplied `cycleId` is validated against it but never trusted as the source of truth.

**Pre-conditions checked:**
- Reviewer is `active` and `available`
- Reviewer has not reached `max_load`
- No conflict of interest (institution window, prior-cycle rule)

**Response 201** — assignment object

**Errors:**
- `404` application or reviewer not found
- `409` assignment already exists for this `(application, reviewer, cycle)` triple
- `422` reviewer unavailable, at max load, or COI detected (with `details[]` listing reasons)

---

#### `POST /v1/assignments/batch`

Requires: `review-assignments:manage`

Assign multiple applications in one operation.

**Request body**
```json
{
  "applicationIds": ["uuid", "uuid"],
  "mode": "rule_based",
  "blindMode": "blind",
  "reviewersPerApplication": 2
}
```

`reviewersPerApplication` defaults to the configured minimum (2).

For `rule_based` mode, reviewers are ranked by expertise tag overlap with the application's major/field keywords. For `random` mode, the reviewer pool is cryptographically shuffled (Fisher-Yates with `crypto.getRandomValues`).

Batch COI check runs against all `(reviewer, application)` pairs before any insertion.

**Response 200**
```json
{
  "data": {
    "created": [ ...assignment objects... ],
    "errors": [
      { "applicationId": "uuid", "issue": "Insufficient eligible reviewers after COI filtering" }
    ]
  }
}
```

A partial success (some created, some in `errors`) returns **200**. If zero assignments could be created, returns **422**.

---

#### `GET /v1/assignments`

Requires: `review:read-assigned`

**Query params:**
- `cycleId` (UUID, optional)
- `status` (optional): `assigned`, `submitted`, `skipped`
- `page`, `pageSize` (default 20, max 100)

Non-admin callers see only their own assignments.

**Response 200** — paginated list

---

#### `GET /v1/assignments/:id`

Requires: `review:read-assigned`

Path params: `id` — UUID.

Non-admin callers receive a `404` if the assignment doesn't belong to them (prevents enumeration).

**Response 200** — assignment object

---

### Review Scoring

#### `PUT /v1/scores/draft`

Requires: `review:submit`

Save or update a draft score. Idempotent via `onConflict(['assignment_id']).merge(...)`.

**Request body**
```json
{
  "assignmentId": "uuid",
  "criterionScores": {
    "criterion-id-1": 8.5,
    "criterion-id-2": 7.0
  },
  "narrativeComments": "Excellent research background...",
  "recommendation": "admit"
}
```

`recommendation` (optional for draft): `strong_admit`, `admit`, `borderline`, `reject`, `strong_reject`

Individual criterion scores are validated against the template schema. Scores must be multiples of `0.5` within `[0, criterion.maxScore]`.

The composite score is computed server-side:
```
composite = Σ( (raw / maxScore) * 10 * weight ) / Σ(weight)
```
Rounded to 3 decimal places.

**Response 200** — score object with `is_draft: true` and computed `compositeScore`

**Errors:** `422` if template weights don't sum to 100 ± 0.01, or unknown criterion ID supplied.

---

#### `POST /v1/scores/submit`

Requires: `review:submit`

Finalise a score. All criteria in the template must be scored. `recommendation` is required.

**Request body** — same as draft

On success:
- `review_scores.is_draft` set to `false`
- `review_assignments.status` → `submitted`
- `reviewer_profiles.active_assignments` decremented by 1

**Response 200** — score object with `is_draft: false`

**Errors:** `422` if any criterion is missing or recommendation is absent.

---

#### `GET /v1/scores/:assignmentId`

Requires: `review:read-assigned`

Path params: `assignmentId` — UUID.

**Response 200** — score object. Non-admins can only read scores for their own assignments.

---

### Review Attachments

#### `POST /v1/attachments`

Requires: `review:submit`

Upload a file attachment for a review assignment. Request must be `multipart/form-data`.

**Form fields:**
- `assignmentId` (UUID) — which assignment this file belongs to
- `file` — the file binary

**Validation pipeline (in order):**
1. Declared MIME type checked against allow-list (`application/pdf`, `image/png`, `image/jpeg`)
2. File size checked against `ATTACHMENT_MAX_FILE_BYTES` (10 MB default)
3. Reviewer ownership verified — only the assigned reviewer can upload
4. Optimistic pre-check: attachment count `< ATTACHMENT_MAX_FILES_PER_REVIEW` (5 default)
5. File buffer read; magic bytes verified against declared MIME type (prevents spoofing)
6. SHA-256 hash computed
7. `SELECT ... FOR UPDATE` on assignment row (serialises concurrent uploads)
8. Re-count under lock — enforces cap atomically
9. Insert into `review_attachments` with `onConflict(assignment_id, content_hash).ignore()` — duplicate upload returns 422

**Storage path:** `{root}/{id[0:2]}/{id[2:4]}/{assignmentId}_{sha256}{ext}`

**Response 201** — attachment object:
```json
{
  "data": {
    "id": "uuid",
    "assignmentId": "uuid",
    "originalFilename": "supporting-doc.pdf",
    "mimeType": "application/pdf",
    "fileSizeBytes": 204800,
    "contentHash": "a3f8...",
    "virusScanStatus": "pending",
    "createdAt": "2026-04-12T10:00:00Z"
  }
}
```

**Errors:** `422` file type not allowed, file too large, magic byte mismatch, duplicate upload, attachment cap reached.

---

#### `GET /v1/attachments`

Requires: `review:read-assigned`

**Query params:**
- `assignmentId` (UUID, required) — validated as UUID format

**Response 200** — list of attachment metadata (no file content):
```json
{
  "data": [
    { "id": "uuid", "originalFilename": "doc.pdf", "mimeType": "application/pdf", "fileSizeBytes": 204800, "virusScanStatus": "clean", "createdAt": "..." }
  ]
}
```

---

#### `DELETE /v1/attachments/:id`

Requires: `review:submit`

Path params: `id` — UUID of attachment.

The uploader can always delete their own attachment. Admins (`SYSTEM_ADMIN`, `PROGRAM_ADMIN`) can delete any attachment for operational remediation.

On success: deletes from DB and removes from filesystem (best-effort).

**Response 204** (no body)

**Errors:** `403` if caller is not the uploader and not an admin.

---

### Review Workbench

The workbench applies blind-mode projection to hide applicant PII from reviewers.

| Blind mode | Projection |
|-----------|-----------|
| `blind` | Applicant name, contact email, institution affiliations removed |
| `semi_blind` | Institution affiliations retained; name/email removed |
| `full` | No projection; full application data visible |

#### `GET /v1/workbench`

Requires: `review:read-assigned`

Returns all assignments for the authenticated reviewer with projected application data.

**Response 200** — list of workbench views

---

#### `GET /v1/workbench/:assignmentId`

Requires: `review:read-assigned`

Path params: `assignmentId` — UUID.

**Response 200** — single workbench view with blind-projected application

---

### Rankings & Escalations

#### `POST /v1/rankings/cycles/:cycleId/aggregate`

Requires: `rankings:compute`

Path params: `cycleId` — UUID.

Aggregates all submitted (non-draft) scores for the cycle. Upserts `application_score_aggregates`. Auto-creates escalation events for high-variance applications (stddev > `REVIEW_VARIANCE_THRESHOLD`, default 1.8).

Idempotent — safe to re-run.

**Response 200**
```json
{ "data": { "aggregated": 150, "escalated": 3 } }
```

---

#### `POST /v1/rankings/cycles/:cycleId/rank`

Requires: `rankings:compute`

Path params: `cycleId` — UUID.

Assigns ordinal `rank` values to aggregated applications. Ordering: `trimmed_mean_score DESC`, `research_fit_score DESC`, `submitted_at ASC` (earlier submission wins ties).

Must be called after `/aggregate`.

**Response 200**
```json
{ "data": { "ranked": 148 } }
```

---

#### `GET /v1/rankings/cycles/:cycleId`

Requires: `rankings:read`

Path params: `cycleId` — UUID.

**Query params:**
- `escalationOnly` (boolean, optional) — filter to only escalated applications
- `page`, `pageSize` (default 50, max 200)

**Response 200** — paginated ranking list:
```json
{
  "data": {
    "rows": [
      {
        "applicationId": "uuid",
        "rank": 1,
        "meanScore": 8.750,
        "trimmedMeanScore": 8.900,
        "reviewerCount": 3,
        "recommendationCounts": { "strong_admit": 2, "admit": 1 },
        "highVarianceFlag": false,
        "escalationFlag": false,
        "computedAt": "2026-04-12T08:00:00Z"
      }
    ],
    "total": 148
  }
}
```

---

#### `POST /v1/rankings/escalations`

Requires: `escalations:write`

Create a manual escalation event.

**Request body**
```json
{
  "applicationId": "uuid",
  "cycleId": "uuid",
  "trigger": "manual",
  "notes": "Committee requests additional review"
}
```

`trigger`: `high_variance`, `missing_reviews`, `borderline_tie`, `manual`

The server validates that `applicationId` belongs to the given `cycleId`.

**Response 201** — escalation event object

---

### Search

#### `GET /v1/search`

Requires: `search:query`

Full-text search across university data entities.

**Query params:**
- `q` (string, required) — search query
- `entityType` (optional): `universities`, `schools`, `majors`, `research-tracks`, `enrollment-plans`, `transfer-quotas`, `application-requirements`, `retest-rules`, or `all` (default)
- `page`, `pageSize` (default 20, max 100)

Synonym expansion is applied automatically (e.g., `ml` → `machine learning`). Highlighted excerpts are returned using `<mark>...</mark>` tags.

**Response 200**
```json
{
  "data": {
    "rows": [
      {
        "stableId": "uuid",
        "entityType": "majors",
        "name": "Machine Learning",
        "headline": "Advanced <mark>ML</mark> research program",
        "rank": 0.92
      }
    ],
    "total": 12
  }
}
```

---

#### `GET /v1/search/suggest`

Requires: `search:query`

Autocomplete suggestions.

**Query params:** `q` (string, required), `limit` (default 5, max 20)

**Response 200**
```json
{ "data": ["machine learning", "machine learning theory", "..."] }
```

---

### Saved Queries

#### `GET /v1/search/saved-queries`

Requires: `search:saved-query:manage`

**Query params:**
- `subscribed` (boolean, optional) — filter to subscribed queries only
- `page`, `pageSize`

**Response 200** — paginated list of saved queries owned by the authenticated account.

---

#### `POST /v1/search/saved-queries`

Requires: `search:saved-query:manage`

**Request body**
```json
{
  "name": "AI programs 2026",
  "queryText": "artificial intelligence",
  "filters": { "entityType": "majors", "cycleId": "uuid" },
  "subscribed": false
}
```

`name` must be unique per account.

**Response 201** — saved query object

**Errors:** `409` name already in use by this account.

---

#### `PATCH /v1/search/saved-queries/:id`

Requires: `search:saved-query:manage`

Path params: `id` — UUID.

**Request body** — partial update of `{ name, queryText, filters, subscribed }`.

Ownership enforced — only the owning account can update.

**Response 200** — updated saved query

**Errors:** `403` not owner, `409` new name conflicts with an existing query name.

---

#### `DELETE /v1/search/saved-queries/:id`

Requires: `search:saved-query:manage`

Ownership enforced.

**Response 204** (no body)

---

#### `POST /v1/search/saved-queries/:id/run`

Requires: `search:saved-query:manage`

Execute a saved query and update `last_run_at` and `last_result_count`.

**Response 200** — same format as `GET /v1/search` results

---

### Personalization

All personalization endpoints are scoped to the authenticated account. Cross-account access is not possible.

#### `POST /v1/personalization/views`

Requires: `personalization:self:write`

Record a view event.

**Request body**
```json
{
  "entityType": "majors",
  "stableId": "uuid",
  "versionId": "uuid"
}
```

**Response 201** — view history record

---

#### `GET /v1/personalization/history`

Requires: `personalization:self:read`

**Query params:** `entityType` (optional), `page`, `pageSize`

Only returns views within the last `HISTORY_RETENTION_DAYS` (default 180 days).

**Response 200** — paginated list of view history records

---

#### `GET /v1/personalization/bookmarks`

Requires: `personalization:self:read`

**Query params:** `entityType` (optional), `page`, `pageSize`

**Response 200** — paginated list of bookmarks

---

#### `POST /v1/personalization/bookmarks`

Requires: `personalization:self:write`

**Request body**
```json
{ "entityType": "majors", "stableId": "uuid" }
```

**Response 201** — bookmark object

**Errors:** `409` already bookmarked.

---

#### `DELETE /v1/personalization/bookmarks`

Requires: `personalization:self:write`

**Query params:** `entityType` (required), `stableId` (UUID, required)

**Response 204** (no body)

**Errors:** `404` bookmark not found.

---

#### `GET /v1/personalization/preferences`

Requires: `personalization:self:read`

**Response 200** — object of all preference key-value pairs for the account.

---

#### `PUT /v1/personalization/preferences/:key`

Requires: `personalization:self:write`

Path params: `key` — preference key (string).

**Request body**
```json
{ "value": { "theme": "dark", "pageSize": 50 } }
```

`value` can be any JSON-serialisable value. Upserts — creates if not present, overwrites if present.

**Response 200** — preference record

---

#### `DELETE /v1/personalization/preferences/:key`

Requires: `personalization:self:write`

**Response 204** (no body)

**Errors:** `404` preference key not found.

---

#### `GET /v1/personalization/subscriptions`

Requires: `personalization:self:read`

**Response 200** — list of tag subscriptions

---

#### `POST /v1/personalization/subscriptions`

Requires: `personalization:self:write`

**Request body**
```json
{ "tag": "machine learning", "tagType": "field" }
```

`tagType`: `topic`, `field`, `entity_type`, `custom`

**Response 201** — subscription record

**Errors:** `409` already subscribed to this tag.

---

#### `DELETE /v1/personalization/subscriptions/:tag`

Requires: `personalization:self:write`

Path params: `tag` — the subscription tag value.

**Response 204** (no body)

**Errors:** `404` subscription not found.

---

#### `GET /v1/personalization/recommendations`

Requires: `personalization:self:read`

Returns personalised entity recommendations with explainability scores.

**Query params:** `entityType` (optional), `page`, `pageSize`

**Response 200**
```json
{
  "data": [
    {
      "entityType": "majors",
      "stableId": "uuid",
      "score": 87,
      "reasons": [
        { "rule": "tag_match", "contribution": 40, "detail": "Subscribed to 'machine learning'" },
        { "rule": "view_history", "contribution": 30, "detail": "Viewed 3 times in last 30 days" },
        { "rule": "bookmark_bonus", "contribution": 17, "detail": "Bookmarked" }
      ],
      "generatedAt": "2026-04-12T00:00:00Z"
    }
  ]
}
```

---

## Config Reference

| Setting | Env Variable | Default | Notes |
|---------|-------------|---------|-------|
| Port | `PORT` | 3000 | |
| Database URL | `DATABASE_URL` | — | Required |
| Session idle timeout | `SESSION_IDLE_TIMEOUT_MINUTES` | 30 | Minutes |
| Session absolute timeout | `SESSION_ABSOLUTE_TIMEOUT_HOURS` | 12 | Hours |
| Token rotation interval | — | 15 min | Hardcoded in `src/config/auth.js` |
| Token rotation grace window | — | 30 s | Hardcoded |
| Bcrypt cost factor | — | 12 | Hardcoded |
| Password min length | — | 12 | Hardcoded |
| Password history count | — | 5 | Last N passwords blocked |
| Attachment storage root | `ATTACHMENT_STORAGE_ROOT` | `./storage/attachments` | |
| Max file size | `ATTACHMENT_MAX_FILE_BYTES` | 10 485 760 (10 MB) | |
| Max files per review | `ATTACHMENT_MAX_FILES_PER_REVIEW` | 5 | |
| Allowed MIME types | — | `application/pdf,image/png,image/jpeg` | Hardcoded in env.js |
| COI institution window | — | 5 years | Hardcoded in `src/config/review-policies.js` |
| Min reviewers per application | — | 2 | Configurable in `src/config/review-policies.js` |
| Trim enabled | `REVIEW_TRIM_ENABLED` | `true` | |
| Trim percent | `REVIEW_TRIM_PERCENT` | 10 | % trimmed from each end |
| Trim min count | `REVIEW_TRIM_MIN_COUNT` | 7 | Min scores before trimming activates |
| Variance threshold | `REVIEW_VARIANCE_THRESHOLD` | 1.8 | Stddev above which escalation fires |
| Score step | — | 0.5 | Min increment between scores; hardcoded |
| Score range | — | 0–10 | Per criterion, normalised to 0–10 |
| Search FTS config | `SEARCH_DEFAULT_LANGUAGE` | `english` | PostgreSQL FTS dictionary |
| History retention | `HISTORY_RETENTION_DAYS` | 180 | Days before view history pruned |
| Encryption key | `LOCAL_ENCRYPTION_KEY` | — | Required; 64-char hex (32 bytes) |
| Log level | `LOG_LEVEL` | `info` | trace, debug, info, warn, error, fatal |
