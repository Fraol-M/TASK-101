# Business Logic Questions — Graduate Admissions Platform

This document records every non-obvious design decision made during implementation. Each entry follows the format:

**Question** → What was unclear or required a choice  
**Assumption** → The constraint or principle that drove the decision  
**Solution** → What was implemented and why

---

## Authentication & Sessions

---

### Q1: Should session timeout be idle-based, absolute, or both?

**Question:** A reviewer might leave the workbench open overnight. Should the session expire after 30 minutes of no activity, or after a fixed 12-hour window regardless of activity?

**Assumption:** Both are needed for different threat models. Idle timeout protects against unattended terminals. Absolute timeout prevents indefinitely-valid tokens that accumulate if a user never logs out.

**Solution:** Dual timeout: `idle_expires_at` is reset on every authenticated request; `absolute_expires_at` is fixed at login time. Both are configurable via environment variables (`SESSION_IDLE_TIMEOUT_MINUTES`, `SESSION_ABSOLUTE_TIMEOUT_HOURS`). A request that arrives after either threshold is expired receives `401`.

---

### Q2: How should token rotation work without breaking concurrent requests?

**Question:** If a client sends two simultaneous requests and the first one rotates the token, the second request arrives with the old token — which is now invalid. This causes spurious `401` errors.

**Assumption:** In-flight concurrent requests with the old token must still succeed for a short window after rotation.

**Solution:** Token rotation stores the old `token_hash` in a `previous_token_hash` column and keeps it valid for a 30-second grace window. Rotation only triggers if `now - rotated_at > 15 minutes` (configurable constant). The grace period is hardcoded at 30 seconds because it only needs to outlast the longest reasonable round-trip, not be configurable.

---

### Q3: Should the raw session token be stored in the database?

**Question:** Storing the raw token means a database breach directly exposes valid session credentials.

**Assumption:** The database should not be sufficient for session hijacking. The principle follows bcrypt password hashing: store only a one-way transformation.

**Solution:** Store `SHA-256(token)` as a BYTEA(32) column. The raw token is returned to the client at login and never persisted. A database dump reveals only hashes, not tokens.

---

### Q4: What should happen when `complete()` fails after the handler succeeds?

**Question:** The handler ran successfully (e.g., assignment created), but writing the idempotency completion record fails. Should we delete the pending slot so the client can retry, or leave it pending?

**Assumption:** Deleting the slot would allow the client to re-execute the handler on retry, creating a duplicate assignment. That is worse than the client seeing `409 IN_FLIGHT` for up to 24 hours.

**Solution:** Leave the slot in `pending` state. Retry `complete()` up to 3 times (50ms, 100ms backoff) before giving up. Log the failure prominently. The pending slot expires naturally. This trades a degraded client experience (stuck `409`) for correctness (no duplicate execution).

---

### Q5: How should the idempotency fingerprint handle multipart file uploads?

**Question:** `ctx.request.body` is empty for multipart requests — the file is in `ctx.request.files`. A client could re-upload a different file with the same idempotency key and the fingerprint would match, treating it as a valid replay.

**Assumption:** A different file with the same key is a new request, not a retry of the same request.

**Solution:** Before computing the fingerprint, read each temp file and compute `{ size, sha256 }`. Merge these into the fingerprint body under a `__files` key. This means file identity is part of the fingerprint. Re-uploading a different file produces a different fingerprint and is rejected with `409 CONFLICT`.

---

## Reviewer Assignments

---

### Q6: Should cycleId be trusted from the client when creating assignments?

**Question:** The client can supply a `cycleId` when creating an assignment. Should the server use that value?

**Assumption:** The cycle is a property of the application, not a client choice. Trusting the client would allow fabricated cycleId values that corrupt assignment records and join queries.

**Solution:** The server always derives `cycleId` from `applications.cycle_id`. If the client supplies a `cycleId`, it is validated against the derived value and rejected if it doesn't match. It is never used as the inserted value.

---

### Q7: Should the max_load check be inside or outside the transaction?

**Question:** The reviewer's `active_assignments < max_load` check could be stale by the time the assignment is inserted if concurrent requests are in flight.

**Assumption:** The check should still happen at the service layer for fast rejection, but the database increment is the true enforcement gate.

**Solution:** Check `active_assignments >= max_load` at the service layer before entering the transaction (returns 422 early). The `active_assignments` counter is then incremented atomically within the transaction alongside the assignment insert. Under high concurrency, a reviewer could briefly exceed `max_load` by the number of concurrent requests that passed the pre-check simultaneously — this is an accepted tradeoff to avoid locking the reviewer row on every check. The `max_load` is a soft guideline, not a hard database constraint.

---

### Q8: How should batch assignment handle reviewer capacity across multiple applications?

**Question:** In a batch of 50 applications, a reviewer might be eligible for all 50 but their `max_load` only allows 3 more. The pre-loaded reviewer records don't reflect assignments being planned for applications earlier in the batch.

**Assumption:** The batch must respect the total load including assignments being created in the same batch, not just assignments already in the database.

**Solution:** A `reservedCounts` map tracks how many batch assignments have been planned for each reviewer. When evaluating reviewer eligibility for each application, the check is `r.active_assignments + (reservedCounts.get(r.id) || 0) < r.max_load`. After a reviewer is selected for an application, their reserved count is incremented. This ensures the batch respects total capacity.

---

### Q9: How should rule-based batch assignment rank reviewers?

**Question:** In `rule_based` mode, which reviewers should be preferred for a given application?

**Assumption:** Expertise relevance (subject-matter match) should be the primary sort. Among equally matched reviewers, available capacity should be preferred to balance load.

**Solution:** For each application, load its `major_versions.payload_json->>'name'` and `->>'field'` values. Lowercase and compare against reviewer `expertise_tags` (also lowercased). Count matches → `matchCount`. Secondary sort key: `max_load - active_assignments` (more available capacity preferred). Sort: `matchCount DESC, capacity DESC`.

---

### Q10: Should the COI prior-cycle rule use `year - 1` arithmetic?

**Question:** The rule "reviewer reviewed this applicant in the prior cycle" was initially implemented as `prev_cycle.year = curr_cycle.year - 1`. This fails if a cycle year was skipped (e.g., 2023 → 2025 with no 2024 cycle).

**Assumption:** "Prior cycle" means the most recently completed cycle before the current one, not necessarily the calendar year minus one.

**Solution:** Replace the arithmetic with a subquery:
```sql
AND prev_cycle.year = (
  SELECT MAX(ac.year)
  FROM application_cycles ac
  WHERE ac.year < curr_cycle.year
)
```
This finds the true previous cycle regardless of year gaps. Applied identically in both `checkConflict` (single pair) and `batchCheck` (N×M pairs via CTE).

---

### Q11: Should COI checks be recorded even when there is no conflict?

**Question:** Recording only conflicts would make it impossible to audit whether a check was performed at all for a given (reviewer, application) pair.

**Assumption:** For compliance, auditors need to verify that every assignment was preceded by a COI check, not just those that were blocked.

**Solution:** `coiService.recordCheck()` is always called after `checkConflict()`, regardless of `hasConflict`. The `has_conflict` boolean distinguishes them. A missing record for any assignment would indicate a process failure.

---

## Scoring

---

### Q12: Should composite score calculation be in the client or server?

**Question:** The client could compute the composite score locally and send it, saving a round-trip.

**Assumption:** The composite score is an authoritative value used in rankings and audit records. Allowing client-supplied values would permit manipulation.

**Solution:** The server always recomputes the composite score from `criterionScores` and the active `scoring_form_template`. The client-supplied `compositeScore` (if any) is ignored. The formula is exported from `scoring.service.js` so unit tests can verify it directly without reimplementing it.

---

### Q13: How should the weight epsilon guard work?

**Question:** Template `criteria` weights should sum to exactly 100. But floating-point arithmetic means `40 + 30 + 30.0001` might fail an exact equality check.

**Assumption:** Misconfigured templates (weights summing to e.g. 97 or 105) should be caught. Floating-point noise on a correctly-configured template should not cause false rejections.

**Solution:** `Math.abs(weightSum - 100) > 0.01` — reject if off by more than 0.01. This tolerates floating-point noise while catching real misconfiguration. The 0.01 threshold was chosen because any intentional misconfiguration would be at least 1% off, while floating-point rounding errors on 3-4 decimal weight values are several orders of magnitude smaller.

---

### Q14: Why is score step validated at 0.5 increments?

**Question:** Should reviewers be able to score 7.3 on a criterion, or should granularity be constrained?

**Assumption:** Half-point precision (7.0, 7.5, 8.0) is coarse enough to be meaningfully distinguishable while fine enough to reflect nuanced assessment. Sub-half-point precision (7.1, 7.23) introduces false precision in human judgment.

**Solution:** Scores must be multiples of 0.5. Validated at the Zod schema layer before the service is called.

---

### Q15: Should draft scores allow partial criteria?

**Question:** A reviewer might want to save progress after scoring 3 of 5 criteria. Should the server require all criteria at draft time?

**Assumption:** Preventing partial saves would frustrate reviewers doing long-form narrative reviews. The only hard requirement is completeness at submission time.

**Solution:** `saveDraft` validates only that supplied criterion IDs are valid (no unknown IDs). Missing criteria are allowed — `composite_score` is computed from whatever criteria have been scored. `submit` requires all criteria and `recommendation`.

---

## Attachments

---

### Q16: Why verify magic bytes when MIME type is declared by the client?

**Question:** The client sends a `Content-Type` or MIME type with the upload. Why re-verify?

**Assumption:** A malicious actor can set `Content-Type: application/pdf` while uploading an executable. Server-side content-type detection (via magic bytes / file signatures) is the only reliable gate.

**Solution:** After reading the file buffer, use the `file-type` library to detect the MIME type from magic bytes. If `detectedType.mime !== file.mimetype`, reject with 422 `magic_byte_mismatch`. The allow-list check on the declared MIME type is a fast pre-check before file I/O; the magic byte check is the authoritative gate.

---

### Q17: How should the attachment count cap be enforced atomically?

**Question:** Two concurrent uploads could both read "count = 4" (below the cap of 5) and both proceed to insert, resulting in 6 attachments.

**Assumption:** The cap must be hard — no overflows under concurrency.

**Solution:** Inside `withTransaction`:
1. `SELECT id FROM review_assignments WHERE id = ? FOR UPDATE` — acquires a row-level exclusive lock on the assignment
2. Re-count attachments under the lock
3. If count ≥ cap, abort

The pre-count check before file I/O is kept as an optimistic early-exit for the common case (cap not reached). The lock ensures correctness for the race case.

---

### Q18: What should happen to the uploaded file if the transaction fails?

**Question:** The file has already been written to disk before the transaction begins. If the transaction rolls back, the file becomes an orphan.

**Assumption:** Orphan files are a lower risk than a failed upload that doesn't clean up and blocks the user's next attempt with a confusing error.

**Solution:** A `catch` block on the transaction call attempts `fs.unlink(absolutePath)`. Unlink failures are silently swallowed (`.catch(() => {})`). The database is the source of truth for which files are valid. A periodic background job can sweep for unreferenced files if storage hygiene is needed.

---

## Aggregation & Rankings

---

### Q19: Should the trimmed mean always trim, or only above a minimum count?

**Question:** If an application has only 2 reviews, trimming 10% from each end would remove the only reviews. The trimmed mean would be undefined.

**Assumption:** Trimming is only meaningful with enough scores to have statistical outliers. Below the minimum count, plain mean is more informative.

**Solution:** If `scores.length < trimMinCount` (default 7), fall back to plain mean. `Math.max(1, floor(trimPercent/100 × count))` ensures at least 1 score is trimmed from each end once the threshold is reached — without the `Math.max(1, ...)`, `floor(10% × 7) = 0` and no trimming occurs at exactly the threshold count.

---

### Q20: What should the ranking tiebreaker be?

**Question:** Multiple applications may have identical `trimmed_mean_score`. How should ties be broken?

**Assumption:** Research fit (pre-computed on the application) is a secondary signal. If that also ties, earlier submission should be rewarded (applicants who committed earlier).

**Solution:** `ORDER BY trimmed_mean_score DESC, research_fit_score DESC, submitted_at ASC`. This is applied deterministically so rankings are stable across re-runs.

---

### Q21: Should `aggregateCycle` be idempotent?

**Question:** If an admin runs aggregation twice (e.g., after late score submissions arrive), should duplicate escalation events be created?

**Assumption:** Re-running aggregation should safely update existing data without creating duplicate audit noise.

**Solution:** `application_score_aggregates` uses `onConflict(['application_id']).merge(...)` for upsert. Escalation event creation checks for an existing `high_variance` event for the same `(application_id, cycle_id)` before inserting. Safe to run multiple times.

---

### Q22: Should the escalation validate that applicationId belongs to cycleId?

**Question:** A client could supply any `applicationId` and `cycleId` combination. If the application actually belongs to a different cycle, the escalation record would corrupt cross-cycle reporting.

**Assumption:** The server must validate referential integrity that isn't captured by FK constraints alone (the FK only validates that `cycleId` exists, not that the application belongs to it).

**Solution:** Before inserting the escalation, the service queries `applications.cycle_id` for the given `applicationId` and compares it to the client-supplied `cycleId`. Mismatch returns `422 Application does not belong to the specified cycle`.

---

## Versioned Master Data

---

### Q23: Why use a stable table + version table pattern instead of a single table with version columns?

**Question:** We could store all version data in one table with a `version_number` column. Why the two-table pattern?

**Assumption:** The stable entity (e.g., a `major`) has an identity that persists across versions. Searching, bookmarking, and subscriptions need a stable reference ID that doesn't change when content changes. A single-table design would require picking one row as "current" or using complex queries everywhere.

**Solution:** Stable table (`majors.id`) = permanent identity. Version table (`major_versions.id`) = time-stamped snapshot. All business references (assignments, bookmarks, program choices) use the stable ID. The active version is found via the partial unique index on `lifecycle_status = 'active'`.

---

### Q24: Should published versions be immutable?

**Question:** Can a program admin edit a version after it has been published (transitioned to `active`)?

**Assumption:** Published versions represent committed decisions that may have been communicated to applicants. Retroactive edits would undermine the audit trail and could confuse applicants who received information based on the old content.

**Solution:** Only `draft` versions can be edited via `PATCH`. Attempting to edit a `active`, `superseded`, or `archived` version returns `422`. To change published content, a new draft version must be created.

---

### Q25: Why does the scheduled promotion script use `makeVersionedService` instead of `makeVersionedRepository`?

**Question:** The script could call the repository's `promoteScheduled` directly, which is simpler.

**Assumption:** All state transitions must generate audit records. The repository only does the DB update; the service wraps it in `withTransaction` and calls `auditService.record()`. Bypassing the service would create silent promotions with no audit trail.

**Solution:** The script calls `makeVersionedService` and uses `service.promoteScheduled()`. Each entity type config also includes `entityType` (required by the service factory for audit records).

---

### Q26: What should the system actor ID be for cron-initiated operations?

**Question:** The promotion script runs without a human actor. The `audit_events.actor_account_id` column is a UUID FK to `accounts`. Should we use a special system account UUID, the string `'system'`, or null?

**Assumption:** There is no system account in the `accounts` table. Inserting a non-UUID string into a UUID column causes a FK violation and rolls back the transaction.

**Solution:** `SYSTEM_ACTOR = null`. The column is `NULLABLE` precisely to accommodate system operations. Cron-sourced audit events are identified by `actor_account_id IS NULL AND action_type LIKE '%.scheduled_promoted'`.

---

## Search

---

### Q27: Should search use a separate search index (Elasticsearch) or in-database FTS?

**Question:** For a large dataset, a dedicated search engine like Elasticsearch would offer better performance and features.

**Assumption:** For the expected dataset size (thousands of university entities, not millions), PostgreSQL FTS is adequate. Avoiding a second service reduces operational complexity, keeps transactions consistent (FTS vector updated in the same transaction as content changes), and eliminates index synchronisation lag.

**Solution:** PostgreSQL FTS with a generated `search_vector tsvector` column. The custom `grad_search` configuration adds `unaccent` + trigram similarity. The FTS vector is always in sync with the data because it's a generated column — no async indexing pipeline.

---

### Q28: Why are synonyms stored in the database rather than a config file?

**Question:** A hardcoded list of abbreviations (ml = machine learning) could live in a config file.

**Assumption:** Program admins should be able to add domain-specific synonyms without a code deployment (e.g., add a new acronym for a newly accredited field).

**Solution:** `search_synonyms` table with `term` (canonical) and `synonyms` (array). Pre-seeded with common abbreviations. Synonyms are loaded at query time and merged into the FTS query. Admins can add/update synonyms without a release.

---

## Personalization

---

### Q29: Should view history have a retention limit?

**Question:** View history could grow unboundedly. Should old records be pruned?

**Assumption:** History older than ~6 months is unlikely to influence recommendations and wastes storage. Users don't expect their browsing from 2 years ago to appear in "recently viewed".

**Solution:** `historyRetentionDays = 180` (configurable). List queries add `AND viewed_at > NOW() - INTERVAL '{n} days'`. Records outside the window are invisible to the API. A background cleanup can physically delete them; the API-level filter means cleanup is not urgent.

---

### Q30: Should bookmark duplicates return 409 or be silently ignored?

**Question:** If a user bookmarks the same entity twice (e.g., a double-click), should the second request succeed silently or return an error?

**Assumption:** The idempotency key handles the case of a true network retry (same key → cached response). A second intentional bookmark (no idempotency key) is a client logic error that should be surfaced, not silently absorbed, so the client can fix its UI.

**Solution:** Return `409 CONFLICT`. The `UNIQUE(account_id, entity_type, stable_id)` constraint enforces this at the database level.

---

## Security

---

### Q31: Why is PII encrypted at the application layer rather than relying on disk encryption?

**Question:** The database server has full-disk encryption. Isn't that enough for applicant PII?

**Assumption:** Full-disk encryption only protects data at rest from physical theft of storage media. A compromised database connection (SQL injection, misconfigured permissions) exposes plaintext data. Application-layer encryption means the DB server never sees plaintext PII.

**Solution:** `applicantName`, `contactEmail`, `email`, `displayName`, `bio` are encrypted with AES-256-GCM using `LOCAL_ENCRYPTION_KEY` before storage. The key is injected via environment variable, not stored in the database.

---

### Q32: How should blind mode prevent PII leakage across API layers?

**Question:** A reviewer making a direct call to `/v1/applications/:id` (which requires `applications:read`) could bypass blind mode.

**Assumption:** Reviewers should not have `applications:read` capability. The workbench endpoint is the only legitimate path for reviewers to access application data, and projection is applied there.

**Solution:** The `REVIEWER` role does not have `applications:read`. Only `review:read-assigned` and `review:submit` are granted. Reviewers can only access application data through the workbench (`/v1/workbench/*`), which always applies blind-mode projection. Admins have `applications:read` and bypass projection by design.

---

### Q33: Should audit records be written before or inside the primary transaction?

**Question:** If audit is written before the primary insert, a rollback leaves a misleading audit record. If it's written after and separately, a failure between the insert and audit write leaves an unaudited action.

**Assumption:** The audit record must be atomic with the primary operation — either both commit or both roll back.

**Solution:** `auditService.record()` accepts an optional `trx` parameter and uses the same transaction object as the primary write. Both operations are committed (or rolled back) atomically.

---

### Q34: Why does the log redaction test use a real Pino instance rather than a mock?

**Question:** A mock could verify that `logger.info` was called with certain args. Why spin up a full Pino instance?

**Assumption:** Mocking the logger would test our mock, not the Pino redaction engine. A change to the `redact.paths` list (the most likely regression) would not be caught if the real engine is never exercised.

**Solution:** The test creates a real Pino logger with production redact config writing to an in-memory `Writable` stream. It logs a message, reads the parsed JSON output, and asserts `[REDACTED]` on each sensitive path. This catches any regression in the path list or Pino version behavior.

---

## RBAC

---

### Q35: Should `READ_ONLY` have `rbac:read` capability?

**Question:** Read-only users are support/audit staff. Should they be able to view the role/permission configuration?

**Assumption:** Auditors need to verify that roles are configured correctly as part of compliance checks. Withholding the role configuration would make the audit role less useful.

**Solution:** `READ_ONLY` includes `rbac:read`. It does not include `rbac:write` — auditors can view but not modify role configurations.

---

### Q36: Why use a capability string model (`resource:action`) rather than a flat permission list?

**Question:** We could store permissions as simple strings like `CAN_READ_APPLICATIONS`, `CAN_SUBMIT_REVIEWS`, etc. Why the `resource:action` namespace?

**Assumption:** The `resource:action` format makes the permission matrix self-documenting, enables prefix-based grouping for display, and scales to new resources without polluting a flat namespace.

**Solution:** All capabilities follow `resource:action` convention: `university-data:read`, `review:submit`, `accounts:admin:manage`. Checks use exact string comparison — no prefix matching is done at runtime, keeping the check simple and fast.

---

## Infrastructure

---

### Q37: Why use ULIDs for request IDs instead of UUIDs?

**Question:** The database uses UUID v4 for all PKs. Why use ULID for request IDs?

**Assumption:** ULIDs are lexicographically sortable (time-prefixed) — a log line with `requestId: "01HX4N..."` immediately reveals the approximate time without querying the database. They also look distinct from UUIDs, making it clear in logs that the value is a transient identifier, not a database PK.

**Solution:** `requestIdMiddleware` generates a ULID (via the `ulid` package). Stored as TEXT in `audit_events.request_id` (not UUID type, because ULID uses a different alphabet and is 26 chars vs 36 for UUID with hyphens).

---

### Q38: Why use `SELECT ... FOR UPDATE` rather than `SELECT ... FOR UPDATE SKIP LOCKED` in the attachment cap check?

**Question:** `SKIP LOCKED` would let a concurrent transaction proceed without waiting. Why block instead?

**Assumption:** For the attachment cap, we need the concurrent transaction to wait and then see the updated count, not skip and potentially exceed the cap. `SKIP LOCKED` is appropriate for job-queue patterns where "skip if busy" is acceptable. For correctness-critical cap enforcement, blocking is required.

**Solution:** `SELECT id FROM review_assignments WHERE id = ? FOR UPDATE` (blocking). The concurrent upload waits until the first transaction commits, then re-counts and enforces the cap correctly.

---

### Q39: Should the `withTransaction` helper auto-retry on serialisation errors?

**Question:** PostgreSQL serializable transactions can fail with error code `40001` (serialization_failure) and should be retried. Should `withTransaction` handle this?

**Assumption:** The application uses `READ COMMITTED` isolation (Knex default), not `SERIALIZABLE`. Serialisation failures do not occur. The `FOR UPDATE` row locking pattern achieves the needed atomicity within `READ COMMITTED`.

**Solution:** `withTransaction` does not retry — it re-throws all errors. If `SERIALIZABLE` isolation is ever needed, the retry logic should be added to `withTransaction` at that time.
