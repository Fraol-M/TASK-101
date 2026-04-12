# Delivery Acceptance & Project Architecture Audit (Static-Only)

Date: 2026-04-12
Repository: repo
Audit mode: Static-only (no runtime execution)

## 1. Verdict
- Overall conclusion: Partial Pass

## 2. Scope and Static Verification Boundary
- What was reviewed:
  - Documentation, manifests, env/config, Docker artifacts, route registration, core modules, migrations/seeds, scripts, and tests.
  - Primary evidence sources include README.md:5, package.json:13, src/bootstrap/register-routes.js:30, db/migrations/20260410_004_p2_university_versioned_entities.js:50, tests/integration/rankings.pipeline.spec.js:148.
- What was not reviewed:
  - Runtime behavior under real load, live container orchestration behavior, external environment/network behavior.
- What was intentionally not executed:
  - Project startup, Docker, tests, migrations, scripts.
- Claims requiring manual verification:
  - p95 latency and throughput target compliance (README.md:128, docs/observability.md:65, docs/observability.md:70).
  - Session rotation behavior under high-concurrency lock contention (src/modules/auth/session.service.js:68, src/modules/auth/session.service.js:73).
  - Retention purge script execution correctness in PostgreSQL (scripts/purge-expired-data.js:38, scripts/purge-expired-data.js:43).

## 3. Repository / Requirement Mapping Summary
- Prompt core goal mapped:
  - University versioned master data, review assignment/scoring/aggregation, search, and personalization are all present and wired under /v1 route groups (src/bootstrap/register-routes.js:35, src/bootstrap/register-routes.js:37, src/bootstrap/register-routes.js:39, src/bootstrap/register-routes.js:40).
- Major constraints mapped:
  - One-active-version DB enforcement exists (db/migrations/20260410_004_p2_university_versioned_entities.js:50).
  - COI checks include institution window and prior-cycle logic (src/modules/reviews/assignments/coi.service.js:30, src/modules/reviews/assignments/coi.service.js:51).
  - Scoring bounds and step are validated (src/modules/reviews/scoring/route.js:14).
  - Ranking tie-breakers are deterministic (src/modules/rankings/aggregation.service.js:171, src/modules/rankings/aggregation.service.js:172, src/modules/rankings/aggregation.service.js:173).
  - Search synonym expansion and highlighting implemented (src/modules/search/search.service.js:29, src/modules/search/search.service.js:102).
- Significant requirement-fit gaps found:
  - Idempotency not persisted for successful 204/no-body writes.
  - Audit trail is not complete across all create/update write paths.
  - Personalization similarity implementation is narrow relative to prompt.

## 4. Section-by-section Review

### 4.1 Hard Gates

#### 4.1.1 Documentation and static verifiability
- Conclusion: Pass
- Rationale: Startup/config/test instructions and entrypoint wiring are statically traceable.
- Evidence: README.md:5, README.md:19, README.md:91, package.json:13, package.json:21, .env.example:12, .env.example:35, src/bootstrap/register-routes.js:30.
- Manual verification note: Runtime correctness remains out of scope.

#### 4.1.2 Material deviation from Prompt
- Conclusion: Partial Pass
- Rationale: Architecture and modules align with prompt scope, but several explicit requirement semantics are only partially met (idempotency breadth, full audit trail breadth, personalization similarity depth).
- Evidence: src/common/idempotency/idempotency.middleware.js:72, README.md:133, src/modules/personalization/personalization.service.js:161, src/modules/personalization/personalization.service.js:251.

### 4.2 Delivery Completeness

#### 4.2.1 Coverage of explicit core requirements
- Conclusion: Partial Pass
- Rationale: Most core functional areas exist and are implemented; key non-functional/semantic requirements have material gaps.
- Evidence: src/modules/university-data/_versioning/versioned-repository.factory.js:166, src/modules/reviews/assignments/coi.service.js:68, src/modules/reviews/attachments/attachment.service.js:63, src/modules/rankings/aggregation.service.js:87, src/modules/search/search.service.js:29.

#### 4.2.2 End-to-end deliverable completeness (0→1)
- Conclusion: Pass
- Rationale: Repo structure, migrations, seeds, scripts, and tests represent a real service delivery rather than a code fragment.
- Evidence: README.md:31, db/migrations/20260410_000_p0_baseline_extensions.js:1, db/seeds/00_roles_permissions.js:1, src/server.js:1, tests/integration/scoring.submit.spec.js:1.

### 4.3 Engineering and Architecture Quality

#### 4.3.1 Structure and decomposition quality
- Conclusion: Pass
- Rationale: Modules are separated by capability and route wiring is explicit.
- Evidence: src/bootstrap/register-routes.js:32, src/bootstrap/register-routes.js:35, src/bootstrap/register-routes.js:37, src/bootstrap/register-routes.js:39.

#### 4.3.2 Maintainability/extensibility
- Conclusion: Partial Pass
- Rationale: Core structure is maintainable, but inconsistent API patch shapes and missing param validation in several routes increase maintenance and defect risk.
- Evidence: src/modules/search/route.js:94, src/modules/search/route.js:98, src/modules/search/saved-queries.service.js:36, src/modules/university-data/_versioning/versioned.route.factory.js:7, src/modules/university-data/_versioning/versioned.route.factory.js:58, src/modules/university-data/_versioning/versioned.route.factory.js:117.

### 4.4 Engineering Details and Professionalism

#### 4.4.1 Error handling/logging/validation/API design
- Conclusion: Partial Pass
- Rationale: Good error envelope and logging baseline exists, but material issues remain in idempotency breadth, audit breadth, and some validation consistency.
- Evidence: src/common/errors/error-handler.middleware.js:17, src/common/logging/logger.js:15, src/common/logging/logger.js:17, src/common/idempotency/idempotency.middleware.js:72, src/modules/search/route.js:94.

#### 4.4.2 Product-like service quality
- Conclusion: Pass
- Rationale: Service is organized as a production-style backend with DB migrations, RBAC, observability, and modular business domains.
- Evidence: README.md:3, README.md:78, docs/architecture.md:1, src/app.js:24.

### 4.5 Prompt Understanding and Requirement Fit

#### 4.5.1 Business-goal and constraint fit
- Conclusion: Partial Pass
- Rationale: Core admissions workflow and supporting modules are implemented; specific prompt semantics are partially fulfilled in personalization similarity and full-write idempotency/audit breadth.
- Evidence: src/modules/personalization/personalization.service.js:161, src/modules/personalization/personalization.service.js:252, src/common/idempotency/idempotency.middleware.js:72, README.md:133.

### 4.6 Aesthetics (frontend-only)

#### 4.6.1 Visual/interaction quality
- Conclusion: Not Applicable
- Rationale: Delivery is backend-only.
- Evidence: README.md:3.

## 5. Issues / Suggestions (Severity-Rated)

### High

1) Severity: High
- Title: Idempotency protection is bypassed for successful write responses without body (e.g., 204)
- Conclusion: Fail
- Evidence: src/common/idempotency/idempotency.middleware.js:72, src/modules/personalization/route.js:31, src/modules/personalization/route.js:39, src/modules/personalization/personalization.service.js:11
- Impact: Duplicate submissions can still create repeated side effects for authenticated write endpoints returning 204 (notably view history), violating prompt idempotency intent.
- Minimum actionable fix: Persist idempotency records for all successful authenticated writes (2xx), including 204 with a canonical empty response payload.

2) Severity: High
- Title: Full audit trail requirement is not met across all create/update write paths
- Conclusion: Fail
- Evidence: README.md:133, src/modules/accounts/account.service.js:16, src/modules/accounts/account.service.js:37, src/modules/rbac/rbac.service.js:54, src/modules/rbac/rbac.service.js:61, src/modules/rbac/rbac.service.js:69, src/modules/personalization/personalization.service.js:37, src/modules/personalization/personalization.service.js:74, src/modules/search/saved-queries.service.js:19
- Impact: Important state changes occur without who/when/what audit entries, reducing compliance and forensic traceability.
- Minimum actionable fix: Introduce a mandatory audit decorator/pattern for every mutating service method and enforce via tests/lint rule.

3) Severity: High
- Title: Personalization implementation does not satisfy prompt-level similarity depth
- Conclusion: Partial Fail
- Evidence: src/modules/personalization/personalization.service.js:161, src/modules/personalization/personalization.service.js:162, src/modules/personalization/personalization.service.js:209, src/modules/personalization/personalization.service.js:251, src/modules/personalization/personalization.service.js:253
- Impact: Recommendations are primarily heuristic boosts (views/bookmarks/entity_type tag) without clear tag/attribute similarity across broader entities, weakening requirement fit.
- Minimum actionable fix: Add explicit similarity scoring (for example tag overlap/Jaccard on entity attributes) and expand candidate entities beyond only universities/majors in cold-start.

4) Severity: High
- Title: Suspected auth reliability risk under concurrency from FOR UPDATE SKIP LOCKED
- Conclusion: Suspected Risk / Cannot Confirm Statistically
- Evidence: src/modules/auth/session.service.js:68, src/modules/auth/session.service.js:73, src/modules/auth/session.service.js:75
- Impact: Concurrent requests can transiently fail with 401 if token row is lock-skipped.
- Minimum actionable fix: Replace SKIP LOCKED with lock timeout + retry strategy, or retry once before returning AuthenticationError.

### Medium

5) Severity: Medium
- Title: Purge script uses likely-invalid PostgreSQL interval placeholder syntax
- Conclusion: Suspected Risk
- Evidence: scripts/purge-expired-data.js:38, scripts/purge-expired-data.js:43
- Impact: Retention cleanup may fail at runtime, causing data growth and retention-policy drift.
- Minimum actionable fix: Use parameter-safe interval arithmetic such as NOW() - (? * INTERVAL '1 day').

6) Severity: Medium
- Title: Saved-query PATCH API shape mismatch and missing request validation
- Conclusion: Fail
- Evidence: src/modules/search/route.js:19, src/modules/search/route.js:82, src/modules/search/route.js:94, src/modules/search/route.js:98, src/modules/search/saved-queries.service.js:36
- Impact: Client PATCH payloads using queryText can be silently ignored; malformed patches are not schema-validated.
- Minimum actionable fix: Add PATCH schema with explicit allowed fields and map camelCase API contract fields to DB columns consistently.

7) Severity: Medium
- Title: UUID path parameter validation is inconsistently applied
- Conclusion: Partial Fail
- Evidence: src/modules/university-data/_versioning/versioned.route.factory.js:7, src/modules/university-data/_versioning/versioned.route.factory.js:58, src/modules/university-data/_versioning/versioned.route.factory.js:117, src/modules/accounts/route.js:24, src/modules/accounts/account.service.js:10
- Impact: Malformed UUID path params may bubble into DB-layer errors (500) rather than clean 400 validation responses.
- Minimum actionable fix: Apply validate({ params: ... }) schemas uniformly on all UUID path-param routes.

8) Severity: Medium
- Title: Audit view masking semantics do not match masked-view requirement
- Conclusion: Partial Fail
- Evidence: src/common/crypto/field-encryption.js:50, src/modules/admin/audit/audit.service.js:57
- Impact: Non-admin viewers receive null summaries instead of masked summaries, reducing audit usability and diverging from prompt wording.
- Minimum actionable fix: Use maskField-based selective masking for allowed viewers instead of nulling all summaries.

9) Severity: Medium
- Title: Documentation inconsistency on audit-events access scope
- Conclusion: Fail (Documentation consistency)
- Evidence: docs/security-model.md:98, docs/permission-matrix.md:24, db/seeds/00_roles_permissions.js:85, db/seeds/00_roles_permissions.js:92, src/modules/admin/route.js:31
- Impact: Static verifiability is weakened; auditors cannot infer intended authorization policy reliably from docs.
- Minimum actionable fix: Align security-model doc, permission matrix, and seed policy to one intended access model.

10) Severity: Medium
- Title: Search fielded filtering is narrower than prompt expectation
- Conclusion: Partial Fail
- Evidence: src/modules/search/route.js:12, src/modules/search/search.service.js:59, src/modules/search/search.service.js:74
- Impact: Filtering is effectively limited to entity type; richer fielded filtering capabilities are not evident.
- Minimum actionable fix: Extend query schema and SQL builder with additional fielded filters (for example lifecycle status, effective dates, and key payload fields).

## 6. Security Review Summary

- Authentication entry points
  - Conclusion: Partial Pass
  - Evidence: src/modules/auth/route.js:11, src/modules/auth/auth.middleware.js:33, src/modules/auth/session.service.js:68
  - Reasoning: Entry points and bearer/session checks are explicit, but concurrency lock behavior introduces suspected reliability risk.

- Route-level authorization
  - Conclusion: Pass
  - Evidence: src/modules/rbac/rbac.middleware.js:20, src/modules/rbac/rbac.middleware.js:29, src/modules/admin/route.js:12, src/modules/admin/route.js:31
  - Reasoning: Protected routes consistently apply capability checks.

- Object-level authorization
  - Conclusion: Partial Pass
  - Evidence: src/modules/applications/application.service.js:58, src/modules/reviews/assignments/assignment.service.js:251, src/modules/reviews/workbench/workbench.service.js:37, src/modules/reviews/attachments/attachment.service.js:52
  - Reasoning: Strong checks exist in critical reviewer/applicant flows; still requires broader route-by-route verification for total certainty.

- Function-level authorization
  - Conclusion: Partial Pass
  - Evidence: src/modules/reviews/scoring/scoring.service.js:56, src/modules/reviews/scoring/scoring.service.js:122, src/modules/reviews/assignments/assignment.service.js:38
  - Reasoning: Service-level guards are present for key review flows, but not universal across all mutating domains.

- Tenant/user data isolation
  - Conclusion: Partial Pass
  - Evidence: src/modules/applications/application.service.js:69, src/modules/personalization/personalization.service.js:26, src/modules/search/saved-queries.service.js:34
  - Reasoning: Isolation patterns are present for major per-user resources.

- Admin/internal/debug endpoint protection
  - Conclusion: Partial Pass
  - Evidence: src/modules/admin/route.js:12, src/modules/admin/route.js:31, docs/security-model.md:98, docs/permission-matrix.md:24
  - Reasoning: Admin endpoints are permission-gated, but policy/document mismatch remains on audit visibility scope.

## 7. Tests and Logging Review

- Unit tests
  - Conclusion: Pass
  - Evidence: tests/unit/idempotency.dedup.spec.js:92, tests/unit/auth.password-rules.spec.js:19, tests/unit/blind-modes.projection.spec.js:9, tests/unit/aggregation.trimmed-mean.spec.js:50

- API/integration tests
  - Conclusion: Partial Pass
  - Evidence: tests/api/auth.login.spec.js:11, tests/api/assignments.spec.js:41, tests/integration/scoring.submit.spec.js:187, tests/integration/rankings.pipeline.spec.js:148
  - Reasoning: Integration suites cover many core data paths; many API suites are service-mocked and do not validate full runtime stacks.

- Logging categories / observability
  - Conclusion: Pass
  - Evidence: src/common/logging/logger.js:11, src/common/metrics/metrics.js:15, src/common/metrics/metrics.js:38, src/modules/admin/route.js:12

- Sensitive-data leakage risk in logs/responses
  - Conclusion: Partial Pass
  - Evidence: src/common/logging/logger.js:15, src/common/logging/logger.js:17, src/app.js:47, docs/requirement-traceability.md:58
  - Reasoning: Redaction exists, but no dedicated automated redaction tests are evident.

## 8. Test Coverage Assessment (Static Audit)

### 8.1 Test Overview
- Unit tests exist: yes.
- API tests exist: yes.
- Integration tests exist: yes.
- Frameworks: Vitest + Supertest.
- Test entry points: package.json scripts and vitest config.
- Documentation for test commands: present.
- Evidence: package.json:18, package.json:19, package.json:20, package.json:21, vitest.config.js:6, README.md:88, README.md:91.

### 8.2 Coverage Mapping Table

| Requirement / Risk Point | Mapped Test Case(s) | Key Assertion / Fixture / Mock | Coverage Assessment | Gap | Minimum Test Addition |
|---|---|---|---|---|---|
| Auth login + basic auth API responses | tests/api/auth.login.spec.js:78, tests/api/auth.login.spec.js:122 | Service/session are mocked (tests/api/auth.login.spec.js:11, tests/api/auth.login.spec.js:21) | Basically covered | No DB-backed session lifecycle or rotation coverage | Add integration tests for login/logout/session rotation and token grace-window behavior |
| Route-level 401/403 guard behavior | tests/api/rbac.route-guards.spec.js:63, tests/api/rbac.route-guards.spec.js:80 | Explicit 401/403 scenarios | Sufficient (route layer) | Does not prove deep service authorization correctness | Add end-to-end route+DB authorization tests for critical admin routes |
| Application object-level authorization | tests/integration/applications.submission.spec.js:206 | 403 for non-owner path in real DB-backed service | Sufficient | None material observed | Keep regression tests for role edge cases |
| Assignment object-level authorization | tests/integration/assignment-object-auth.spec.js:132 | 404 info-safe denial for non-owner reviewer | Sufficient | None material observed | Keep and extend to list endpoint edge cases |
| COI institution-window enforcement | tests/integration/coi.institution-window.spec.js:78 | Real SQL join + date-window behavior | Basically covered | Prior-cycle COI path lacks DB-backed integration evidence | Add integration test for prior-cycle reviewer block |
| Score step/range validation (0.5, 0–10) | tests/api/scores.spec.js:98 | 400 on invalid half-step values | Sufficient (route validation) | No HTTP+DB integration for malformed payload persistence safety | Add integration test that malformed payload never reaches DB writes |
| Submit scoring transitions | tests/integration/scoring.submit.spec.js:187 | Verifies score persistence, assignment state transition, reviewer load decrement | Sufficient | None material observed | Add concurrency submission conflict case |
| Aggregation escalation threshold | tests/integration/aggregation.escalation.spec.js:80 | Escalation event created when variance exceeds threshold | Sufficient | None material observed | Add boundary test at exactly threshold |
| Ranking deterministic tie-breakers | tests/integration/rankings.pipeline.spec.js:148 | Asserts order by mean then research fit | Sufficient | None material observed | Add explicit tie on submitted_at to validate tertiary tie handling |
| Search synonyms and ranking | tests/integration/search.fts.spec.js:133 | Synonym expansion path validated in DB-backed tests | Basically covered | Fielded filtering breadth not covered | Add integration tests for additional field filters |
| Version one-active enforcement | tests/integration/versioning.one-active-enforcement.spec.js:26 | Partial unique index behavior validated | Sufficient | No full publish workflow integration for all 8 entities | Add matrix tests for publish/activate/archive across all entity types |
| Idempotency dedup/conflict | tests/unit/idempotency.dedup.spec.js:92, tests/unit/idempotency.dedup.spec.js:117 | Unit-only middleware behavior | Insufficient | No integration coverage for 204/no-body write idempotency | Add API/integration tests for repeated key on /v1/personalization/views and DELETE endpoints |
| Logging redaction | docs/requirement-traceability.md:58 | No dedicated tests listed | Missing | Sensitive logging regressions may pass unnoticed | Add logger snapshot tests with password/token payloads |
| Personalization recommendations quality | tests/api/personalization.spec.js:82 | Service mocked in API tests | Insufficient | No DB-backed tests for similarity, declared-interest cold start, or popularity ordering | Add integration recommendation tests with seeded signals and expected ranking reasons |

### 8.3 Security Coverage Audit
- Authentication
  - Conclusion: Insufficient
  - Evidence: tests/api/auth.login.spec.js:11, tests/api/auth.login.spec.js:21
  - Reason: Core auth/session behavior is heavily mocked in API tests; real rotation and timeout paths are not meaningfully covered.

- Route authorization
  - Conclusion: Basically covered
  - Evidence: tests/api/rbac.route-guards.spec.js:63, tests/api/rbac.route-guards.spec.js:80
  - Reason: 401/403 route-guard behavior is tested.

- Object-level authorization
  - Conclusion: Sufficient for key flows
  - Evidence: tests/integration/applications.submission.spec.js:206, tests/integration/assignment-object-auth.spec.js:132, tests/integration/attachments.service.spec.js:217
  - Reason: Real DB-backed checks exist for high-risk ownership boundaries.

- Tenant/data isolation
  - Conclusion: Basically covered
  - Evidence: tests/integration/applications.submission.spec.js:235, tests/api/search.spec.js:177
  - Reason: Some per-user isolation paths are covered; broader cross-module isolation still not exhaustive.

- Admin/internal protection
  - Conclusion: Basically covered
  - Evidence: tests/api/rbac.route-guards.spec.js:91, tests/api/rankings.spec.js:129
  - Reason: Admin route guard behavior is tested, but policy/document mismatch remains.

### 8.4 Final Coverage Judgment
- Partial Pass
- Covered major risks:
  - Object-level authorization for key review/application paths.
  - Core scoring, aggregation, ranking, and version-constraint logic.
- Uncovered or weakly covered risks:
  - Real auth/session rotation concurrency behavior.
  - Idempotency behavior for 204/no-body writes.
  - Logging redaction regression detection.
  - Full personalization similarity/quality behavior under real DB data.
- Boundary statement:
  - Current tests could still pass while severe defects remain in auth/session concurrency, write-idempotency breadth, and logging-redaction assurance.

## 9. Final Notes
- This report is static-only and evidence-bound; no runtime claims are asserted beyond static code/test artifacts.
- No code modifications were made.
- Highest-priority remediation should target idempotency breadth, complete audit coverage, and personalization requirement-fit gaps before acceptance.