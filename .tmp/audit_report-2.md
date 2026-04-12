# Delivery Acceptance and Project Architecture Audit (Static-Only)

Date: 2026-04-12  
Repository: `repo`  
Audit Mode: Static-only (no runtime execution)

## 1. Verdict

- Overall conclusion: **Partial Pass**

Rationale:
- The repository is materially aligned to the prompt and is structurally complete.
- Multiple **High** root-cause issues remain in security/consistency-critical paths (blind-mode enforcement, idempotency reliability under failure, and versioned draft update validation).
- Additional **Medium** issues remain in storage consistency and API correctness behavior.

---

## 2. Scope and Static Verification Boundary

- What was reviewed:
  - Documentation and run/config artifacts: `README.md`, `.env.example`, `package.json`, Docker and Knex configs.
  - Entry points and middleware stack: `src/server.js`, `src/app.js`, `src/bootstrap/register-routes.js`.
  - Security-critical modules: auth/session/RBAC/idempotency, review workflows, versioned data, search, personalization.
  - Database migrations/seeds for schema constraints and permission model.
  - Unit/API/integration test sources and test configuration.

- What was not reviewed:
  - Runtime behavior in a live process (HTTP server, DB execution behavior under actual load, container orchestration behavior at runtime).

- What was intentionally not executed:
  - Project startup, Docker, migrations, and tests (per static-only boundary).

- Claims requiring manual verification:
  - p95 latency under 300ms at 50 req/s (`README.md:128`).
  - End-to-end operational behavior in Docker and real deployment environments.
  - Runtime impact of failure-path behaviors identified statically.

---

## 3. Repository / Requirement Mapping Summary

- Prompt core goal: offline admissions operations platform with versioned university master data, review workbench/assignment/scoring/ranking, search, personalization, RBAC/audit/security controls.
- Main mapped implementation areas:
  - Versioned university entities: `src/modules/university-data/_versioning/*`, `db/migrations/20260410_004_p2_university_versioned_entities.js`.
  - Review workflow: `src/modules/reviews/*`, `src/modules/rankings/aggregation.service.js`, migrations `005`-`008`.
  - Security model: `src/modules/auth/*`, `src/modules/rbac/*`, `src/common/idempotency/*`, `src/modules/admin/audit/audit.service.js`.
  - Search/personalization: `src/modules/search/*`, `src/modules/personalization/*`, migrations `009`, `012`-`015`.

---

## 4. Section-by-section Review

### 4.1 Hard Gates

#### 1.1 Documentation and static verifiability
- Conclusion: **Pass**
- Rationale: Startup/test/config docs and scripts exist and are statically traceable to code/config.
- Evidence: `README.md:5`, `README.md:79`, `package.json:11`, `package.json:13`, `package.json:17`, `src/bootstrap/register-routes.js:30`, `src/bootstrap/register-routes.js:32`
- Manual verification note: Runtime command success remains manual by boundary.

#### 1.2 Material deviation from Prompt
- Conclusion: **Partial Pass**
- Rationale: Core domains are implemented, but one high-risk security semantics gap exists in blind/full-mode handling for reviewer workbench views.
- Evidence: `src/modules/reviews/assignments/route.js:16`, `src/modules/reviews/assignments/assignment.service.js:70`, `src/modules/reviews/blind-modes/projection.service.js:71`, `src/modules/reviews/blind-modes/projection.service.js:35`, `docs/security-model.md:52`

### 4.2 Delivery Completeness

#### 2.1 Core explicit requirements coverage
- Conclusion: **Partial Pass**
- Rationale: Most explicit requirements are implemented (versioning/COI/scoring/attachments/ranking/search/personalization/auth). Remaining high/medium defects affect reliability and security semantics rather than broad feature absence.
- Evidence: `src/modules/university-data/_versioning/versioned.route.factory.js:142`, `src/modules/reviews/assignments/coi.service.js:57`, `src/modules/reviews/scoring/route.js:13`, `src/modules/reviews/attachments/attachment.service.js:71`, `src/modules/rankings/aggregation.service.js:176`, `src/modules/search/search.service.js:29`, `src/modules/personalization/personalization.service.js:388`, `src/modules/auth/session.service.js:73`

#### 2.2 Basic end-to-end deliverable (0→1)
- Conclusion: **Pass**
- Rationale: Complete project structure with docs, migrations, scripts, and tests exists; not a fragment/demo-only delivery.
- Evidence: `README.md:40`, `db/migrations/20260410_000_p0_baseline_extensions.js:34`, `src/app.js:75`, `tests/integration/auth.session.spec.js:76`, `tests/integration/rankings.pipeline.spec.js:148`

### 4.3 Engineering and Architecture Quality

#### 3.1 Structure and module decomposition
- Conclusion: **Pass**
- Rationale: Clear modular decomposition by capability; route registration is centralized; services/repositories are separated.
- Evidence: `src/bootstrap/register-routes.js:32`, `src/bootstrap/register-routes.js:41`, `src/modules/university-data/index.js:1`, `src/modules/reviews/index.js:1`

#### 3.2 Maintainability and extensibility
- Conclusion: **Partial Pass**
- Rationale: Reusable factories and consistent patterns exist, but versioned draft update path lacks payload validation, which weakens data integrity and maintainability.
- Evidence: `src/modules/university-data/_versioning/versioned.route.factory.js:123`, `src/modules/university-data/_versioning/versioned.route.factory.js:126`, `src/modules/university-data/_versioning/versioned.route.factory.js:109`, `src/modules/university-data/_versioning/versioned-repository.factory.js:112`
- Manual verification note: Runtime consequences of malformed payloads require execution to fully observe.

### 4.4 Engineering Details and Professionalism

#### 4.1 Error handling, logging, validation, API design
- Conclusion: **Partial Pass**
- Rationale: Strong baseline logging/metrics/validation exists, but several high/medium reliability defects remain: idempotency failure fallback can allow duplicate writes; unvalidated version draft PATCH body; some predictable business conflicts risk surfacing as generic 500.
- Evidence: `src/common/idempotency/idempotency.middleware.js:163`, `src/common/idempotency/idempotency.middleware.js:164`, `src/common/idempotency/idempotency.middleware.js:167`, `src/modules/university-data/_versioning/versioned.route.factory.js:126`, `src/modules/reviews/assignments/assignment.service.js:64`, `db/migrations/20260410_006_p4_review_assignments.js:21`, `src/common/errors/error-handler.middleware.js:37`

#### 4.2 Product/service-level organization (not demo-only)
- Conclusion: **Pass**
- Rationale: Delivery includes production-shape concerns (migrations, Docker, maintenance scripts, observability, audit).
- Evidence: `Dockerfile:1`, `docker-compose.yml:58`, `scripts/purge-expired-data.js:1`, `scripts/promote-scheduled-versions.js:1`, `src/common/metrics/metrics.js:16`

### 4.5 Prompt Understanding and Requirement Fit

#### 5.1 Business goal, scenario, implicit constraints fit
- Conclusion: **Partial Pass**
- Rationale: Business intent is largely met; remaining high issues affect blind-review semantics and duplicate-submission guarantees under failure conditions.
- Evidence: `src/modules/reviews/blind-modes/projection.service.js:71`, `src/common/idempotency/idempotency.middleware.js:164`, `src/modules/rankings/aggregation.service.js:92`, `src/modules/search/search.service.js:118`

### 4.6 Aesthetics (frontend-only / full-stack tasks only)

#### 6.1 Visual and interaction quality
- Conclusion: **Not Applicable**
- Rationale: This repository is backend-only; no frontend UI deliverable is in scope.
- Evidence: `README.md:3`, `src/app.js:1`

---

## 5. Issues / Suggestions (Severity-Rated)

### High

#### Issue H1
- Severity: **High**
- Title: Reviewer can receive `full` blind mode payload when assignment is configured as `full`
- Conclusion: **Fail**
- Evidence:
  - `src/modules/reviews/assignments/route.js:16` (accepts `blindMode` = `full`)
  - `src/modules/reviews/assignments/assignment.service.js:70` (persists requested `blind_mode`)
  - `src/modules/reviews/blind-modes/projection.service.js:71` (non-admin mode = `assignment.blind_mode`)
  - `src/modules/reviews/blind-modes/projection.service.js:35` (includes `applicant_account_id` in `FULL_COLUMNS`)
  - `docs/security-model.md:52` (documents full-mode as admin-only)
- Impact: Blind-review confidentiality boundary can be weakened by assignment configuration; function-level authorization semantics are inconsistent with documented model.
- Minimum actionable fix:
  - Enforce that non-admin viewers cannot resolve to `full` mode.
  - Optionally reject `blindMode=full` for reviewer-targeted assignments unless explicit privileged policy is met.

#### Issue H2
- Severity: **High**
- Title: Idempotency failure path can re-enable duplicate side effects
- Conclusion: **Fail**
- Evidence:
  - `src/common/idempotency/idempotency.middleware.js:163` (on `complete()` failure: release pending slot)
  - `src/common/idempotency/idempotency.middleware.js:164` (explicit tradeoff: retry may re-execute handler)
  - `src/common/idempotency/idempotency.middleware.js:167` (deletes pending slot)
- Impact: Under post-handler persistence failure, client retries with same key can re-run write handlers, violating strict duplicate-submission prevention expectation.
- Minimum actionable fix:
  - Do not delete pending slot after successful handler side effects unless deterministic reconciliation exists.
  - Persist idempotency completion atomically with business write (or use a recoverable outbox/reconciliation state).

#### Issue H3
- Severity: **High**
- Title: Versioned draft PATCH endpoint lacks body schema validation
- Conclusion: **Fail**
- Evidence:
  - `src/modules/university-data/_versioning/versioned.route.factory.js:123` (PATCH route)
  - `src/modules/university-data/_versioning/versioned.route.factory.js:126` (validates params only)
  - `src/modules/university-data/_versioning/versioned.route.factory.js:109` (create-new-draft does validate body)
  - `src/modules/university-data/_versioning/versioned-repository.factory.js:112` (blindly writes `payload_json` from request)
- Impact: Invalid or structurally inconsistent payloads can be persisted in authoritative version snapshots.
- Minimum actionable fix:
  - Add strict body validation for PATCH (at least schema-compatible partial with required invariants).
  - Reject unknown/invalid fields before persistence.

### Medium

#### Issue M1
- Severity: **Medium**
- Title: Attachment upload may leave orphaned files when DB checks fail after disk copy
- Conclusion: **Partial Fail**
- Evidence:
  - `src/modules/reviews/attachments/attachment.service.js:93` (file copied to final storage before transaction)
  - `src/modules/reviews/attachments/attachment.service.js:97` (transaction starts after copy)
  - `src/modules/reviews/attachments/attachment.service.js:107` (count-limit rejection can occur post-copy)
  - `src/modules/reviews/attachments/attachment.service.js:128` (duplicate-hash rejection can occur post-copy)
  - `src/modules/reviews/attachments/attachment.service.js:198` (unlink of stored path only exists in delete flow)
- Impact: Orphan files can accumulate and complicate storage governance / cleanup.
- Minimum actionable fix:
  - Move final copy after transactional acceptance or add compensating delete on transaction failure.

#### Issue M2
- Severity: **Medium**
- Title: Archive endpoint can return success for non-existent stable entities
- Conclusion: **Partial Fail**
- Evidence:
  - `src/modules/university-data/_versioning/versioned-repository.factory.js:181` (archive method)
  - `src/modules/university-data/_versioning/versioned-repository.factory.js:186` (blind update, no affected-row check)
  - `src/modules/university-data/_versioning/versioned.route.factory.js:201` (always calls archive)
  - `src/modules/university-data/_versioning/versioned.route.factory.js:202` (always returns `{ archived: true }`)
- Impact: False-positive API responses and weak operational correctness for archive workflows.
- Minimum actionable fix:
  - Verify entity existence / update count and return 404 when no matching active/draft/scheduled rows exist.

#### Issue M3
- Severity: **Medium**
- Title: Predictable DB uniqueness conflicts can degrade to generic 500 responses
- Conclusion: **Partial Fail**
- Evidence:
  - `src/modules/reviews/assignments/assignment.service.js:64` (single assignment insert without conflict mapping)
  - `db/migrations/20260410_006_p4_review_assignments.js:21` (unique constraint on assignment triplet)
  - `src/common/errors/error-handler.middleware.js:37` (unexpected errors mapped to 500)
  - `docs/api-contract.md:47` (contract defines explicit 409 conflict semantics)
- Impact: API contract consistency and client behavior predictability are weakened.
- Minimum actionable fix:
  - Catch SQLSTATE `23505` and map to `ConflictError` with 409 in conflict-prone write paths.

---

## 6. Security Review Summary

### Authentication entry points
- Conclusion: **Pass**
- Evidence: `src/modules/auth/route.js:10`, `src/modules/auth/auth.middleware.js:9`, `src/modules/auth/session.service.js:71`, `src/modules/auth/session.service.js:73`
- Rationale: Public login is explicit; authenticated routes require bearer token with idle/absolute timeout checks.

### Route-level authorization
- Conclusion: **Pass**
- Evidence: `src/modules/admin/route.js:12`, `src/modules/rankings/route.js:14`, `src/modules/search/route.js:55`, `src/modules/personalization/route.js:32`
- Rationale: Protected routes consistently apply `requirePermission(...)` by capability group.

### Object-level authorization
- Conclusion: **Partial Pass**
- Evidence: `src/modules/applications/application.service.js:53`, `src/modules/reviews/assignments/assignment.service.js:287`, `src/modules/reviews/scoring/scoring.service.js:233`, `src/modules/search/saved-queries.service.js:95`
- Rationale: Ownership checks are broadly present; blind-mode function-level gap (Issue H1) still impacts reviewer data exposure semantics.

### Function-level authorization
- Conclusion: **Fail**
- Evidence: `src/modules/reviews/blind-modes/projection.service.js:71`, `src/modules/reviews/blind-modes/projection.service.js:35`, `docs/security-model.md:52`
- Rationale: Non-admin effective mode selection is data-driven from assignment config and can become `full`.

### Tenant / user data isolation
- Conclusion: **Partial Pass**
- Evidence: `src/modules/personalization/route.js:46`, `src/modules/personalization/personalization.service.js:35`, `src/modules/search/saved-queries.service.js:95`, `tests/integration/personalization.isolation.spec.js:81`
- Rationale: Isolation is implemented for major user-scoped domains; blind/full-mode gap remains a user-data exposure concern.

### Admin / internal / debug protection
- Conclusion: **Pass**
- Evidence: `src/modules/admin/route.js:12`, `src/modules/admin/route.js:30`, `src/bootstrap/register-routes.js:25`
- Rationale: Admin metrics/audit endpoints are permission-guarded; public exposure is limited to `/health`.

---

## 7. Tests and Logging Review

### Unit tests
- Conclusion: **Pass**
- Evidence: `tests/unit/aggregation.trimmed-mean.spec.js:30`, `tests/unit/scoring.composite.spec.js:52`, `tests/unit/idempotency.dedup.spec.js:57`, `tests/unit/logger.redaction.spec.js:57`
- Rationale: Core algorithms and utility behavior are unit-tested.

### API / integration tests
- Conclusion: **Partial Pass**
- Evidence: `tests/api/rbac.route-guards.spec.js:65`, `tests/integration/auth.session.spec.js:76`, `tests/integration/scoring.submit.spec.js:186`, `tests/integration/rankings.pipeline.spec.js:148`
- Rationale: Strong integration coverage exists for many core flows, but critical gaps remain (no dedicated workbench endpoint integration tests; no idempotency completion-failure regression test).

### Logging categories / observability
- Conclusion: **Pass**
- Evidence: `src/common/logging/logger.js:14`, `src/common/metrics/metrics.js:16`, `src/common/metrics/metrics.js:23`, `src/modules/admin/route.js:12`
- Rationale: Structured logs and local metrics are implemented with protected metrics endpoint.

### Sensitive-data leakage risk in logs / responses
- Conclusion: **Partial Pass**
- Evidence: `src/common/logging/logger.js:15`, `src/common/logging/logger.js:21`, `src/modules/reviews/blind-modes/projection.service.js:35`, `src/modules/reviews/blind-modes/projection.service.js:71`
- Rationale: Log redaction is strong; response-level blind-mode semantics have a high-risk gap (Issue H1).

---

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview

- Unit tests exist: `tests/unit/*.spec.js`.
- API tests exist: `tests/api/*.spec.js`.
- Integration tests exist: `tests/integration/*.spec.js`.
- Test frameworks/tooling: Vitest + Supertest (`package.json:17`, `vitest.config.js:15`, `vitest.config.js:17`).
- Test entry points: `npm test`, `npm run test:unit`, `npm run test:api`, `npm run test:integration` (`package.json:17`, `package.json:19`, `package.json:20`, `package.json:21`).
- Documentation provides test commands (`README.md:79`).

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Auth login/session timeout/rotation | `tests/api/auth.login.spec.js:79`, `tests/integration/auth.session.spec.js:76`, `tests/integration/auth.session.spec.js:315` | 401 on invalid creds; rotation/grace/timeout/lock retry paths | sufficient | None material | Keep regression tests for timeout constants and lock retry |
| Route auth (401/403) | `tests/api/rbac.route-guards.spec.js:65`, `tests/api/rbac.route-guards.spec.js:87` | Explicit unauthenticated vs unauthorized responses | sufficient | None material | Add one cross-module guard matrix smoke test |
| Object-level auth (applications/assignments/saved queries/personalization) | `tests/integration/applications.submission.spec.js:159`, `tests/integration/assignment-object-auth.spec.js:131`, `tests/integration/saved-queries.ownership.spec.js:148`, `tests/integration/personalization.isolation.spec.js:81` | Owner/non-owner/admin permutations | sufficient | None material | Add negative tests for every new user-scoped endpoint |
| COI institution and prior-cycle semantics | `tests/unit/coi.service.spec.js:24`, `tests/integration/coi.institution-window.spec.js:71` | SQL-backed 5-year window checks; prior-cycle mostly unit-mocked | basically covered | Prior-cycle branch lacks DB-backed integration evidence | Add integration case for prior-cycle reviewer block with real cycle-year fixtures |
| Blind/semi-blind enforcement | `tests/unit/blind-modes.projection.spec.js:8` | Column/mode projection unit checks | insufficient | No integration/workbench test for reviewer visibility; no regression preventing reviewer `full` mode | Add integration tests for `/v1/workbench/:assignmentId` with reviewer/admin + `blind/semi_blind/full` assignments |
| Scoring constraints + submit transitions | `tests/api/scores.spec.js:99`, `tests/integration/scoring.submit.spec.js:186` | 0–10/0.5 validation; submit state transitions and ownership | sufficient | None material | Add malformed template weight test at API boundary |
| Attachment limits and ownership | `tests/api/attachments.spec.js:74`, `tests/integration/attachments.service.spec.js:258` | MIME/size/count + uploader/admin delete behavior | basically covered | No regression for orphan-file rollback path | Add integration test asserting failed DB insert does not leave file in storage |
| Aggregation/ranking/tie-break/escalation | `tests/unit/aggregation.trimmed-mean.spec.js:30`, `tests/integration/rankings.pipeline.spec.js:148`, `tests/integration/aggregation.escalation.spec.js:67` | Tie-break order and high-variance escalation persistence | sufficient | None material | Add extreme-value boundary test at exactly trim threshold |
| Search FTS/synonyms/saved query ownership | `tests/integration/search.fts.spec.js:71`, `tests/integration/search.fts.spec.js:132`, `tests/integration/saved-queries.ownership.spec.js:71` | Real DB synonym expansion and ownership enforcement | sufficient | None material | Add pagination/filter combinator tests |
| Personalization recommendations/explanations persistence | `tests/api/personalization.spec.js:44`, `tests/integration/personalization.isolation.spec.js:230` | API tests mock service; integration covers history/bookmarks/preferences/subscriptions | insufficient | No DB-backed verification for recommendation explanation persistence (`recommendation_explanations`) | Add integration test asserting `_persistExplanations` inserts expected reasons payload |
| Idempotency under concurrency and dedup | `tests/unit/idempotency.dedup.spec.js:57`, `tests/integration/idempotency.race.spec.js:75` | Reserve/complete/deletePending and race behavior | basically covered | No test for `complete()` failure fallback that can re-enable duplicate execution | Add integration test forcing `complete()` failure and assert no duplicate side effects on retry |
| Audit masking and admin audit exposure | `tests/api/rbac.route-guards.spec.js:117` | Only checks endpoint accessibility for SYSTEM_ADMIN | insufficient | No tests for masked summaries for non-admin roles | Add API/integration tests for PROGRAM_ADMIN/READ_ONLY masked `before_summary`/`after_summary` |

### 8.3 Security Coverage Audit

- authentication: **basically covered**  
  Evidence: `tests/api/auth.login.spec.js:79`, `tests/integration/auth.session.spec.js:76`  
  Note: Core session security paths are tested with DB-backed coverage.

- route authorization: **sufficient**  
  Evidence: `tests/api/rbac.route-guards.spec.js:65`, `tests/api/rbac.route-guards.spec.js:87`

- object-level authorization: **basically covered**  
  Evidence: `tests/integration/assignment-object-auth.spec.js:131`, `tests/integration/applications.submission.spec.js:159`, `tests/integration/saved-queries.ownership.spec.js:148`

- tenant / data isolation: **basically covered**  
  Evidence: `tests/integration/personalization.isolation.spec.js:81`, `tests/integration/saved-queries.ownership.spec.js:148`

- admin / internal protection: **insufficient**  
  Evidence: `tests/api/rbac.route-guards.spec.js:117`  
  Note: Endpoint access is tested, but admin-read masking semantics are not meaningfully covered.

- residual severe-undetected-risk note:
  - Current tests do not meaningfully guard against reviewer full-mode exposure (Issue H1) or idempotency completion-failure duplicate execution (Issue H2), so severe defects could remain undetected while tests still pass.

### 8.4 Final Coverage Judgment

**Partial Pass**

Boundary explanation:
- Major security/workflow paths (auth, route guards, ownership, scoring, rankings, FTS, idempotency race basics) are covered.
- Coverage gaps in blind-mode enforcement, idempotency failure semantics, recommendation explanation persistence, and audit masking mean severe defects can still exist despite green tests.

---

## 9. Final Notes

- This report is strictly static and evidence-based; runtime claims are intentionally bounded.
- Findings are grouped by root cause to avoid repetitive symptom inflation.
- Priority remediation order:
  1. H1 reviewer full-mode exposure.
  2. H2 idempotency completion-failure duplicate risk.
  3. H3 unvalidated versioned draft PATCH payload.
  4. Medium reliability/consistency fixes (M1–M3).
