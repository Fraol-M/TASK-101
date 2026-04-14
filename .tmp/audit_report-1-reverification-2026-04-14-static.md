# Previous Inspection Errors Re-Verification (Static-Only)

Date: 2026-04-14
Repository: repo
Mode: Static-only (no runtime execution)
Source issue list: .tmp/audit_report-1.md

## 1) Result Summary

- Fixed: 10 / 10
- Partially fixed or not fully verifiable: 0 / 10
- Not fixed: 0 / 10
- Overall: All previously reported issues are fixed in current source and documentation.

## 2) Issue-by-Issue Re-Verification

| # | Prior Issue | Current Status | Evidence (current static) | Verification Note |
|---|---|---|---|---|
| 1 | Idempotency bypass for successful 204/no-body writes | Fixed | repo/src/common/idempotency/idempotency.middleware.js | Middleware completion path now persists successful 2xx writes with fallback payload `ctx.body ?? {}`, and replay path keeps 204 body empty. |
| 2 | Full audit trail not met across create/update paths | Fixed | repo/src/modules/accounts/account.service.js, repo/src/modules/rbac/rbac.service.js, repo/src/modules/personalization/personalization.service.js, repo/src/modules/search/saved-queries.service.js | The previously flagged mutating paths in these modules currently emit `auditService.record(...)` entries. |
| 3 | Personalization similarity depth insufficient | Fixed | repo/src/modules/personalization/personalization.service.js | Recommendation logic includes explicit tag-similarity scoring via Jaccard overlap in `_applyTagSimilarity(...)` across expanded versioned entity tables. |
| 4 | Auth reliability risk from lock-skip behavior | Fixed | repo/src/modules/auth/session.service.js | Session validation uses `FOR UPDATE NOWAIT` with retry on lock contention; `SKIP LOCKED` behavior noted in prior issue is no longer used. |
| 5 | Purge script interval SQL likely invalid | Fixed | repo/scripts/purge-expired-data.js | Purge SQL uses parameter-safe interval arithmetic: `NOW() - (? * INTERVAL '1 day')`. |
| 6 | Saved-query PATCH mismatch and missing validation | Fixed | repo/src/modules/search/route.js, repo/src/modules/search/saved-queries.service.js | PATCH now has explicit body + params schema validation, and service maps camelCase `queryText` to DB `query_text`. |
| 7 | UUID path parameter validation inconsistently applied | Fixed | repo/src/modules/accounts/route.js, repo/src/modules/rbac/route.js, repo/src/modules/search/route.js, repo/src/modules/university-data/_versioning/versioned.route.factory.js, repo/src/modules/university-data/_versioning/versioned.validator.js | UUID param validation is present in the previously inconsistent route families. |
| 8 | Audit view masking semantics mismatch | Fixed | repo/src/modules/admin/audit/audit.service.js | Non-admin audit viewers receive masked summaries via `maskSummary(...)` instead of null summaries. |
| 9 | Documentation inconsistency on audit-events access scope | Fixed | repo/docs/security-model.md, repo/docs/permission-matrix.md, repo/db/seeds/00_roles_permissions.js, repo/src/modules/admin/route.js | Documentation now explicitly matches implementation: `audit:read` includes SYSTEM_ADMIN/PROGRAM_ADMIN/READ_ONLY with full vs masked audit-event semantics. |
| 10 | Search fielded filtering narrower than expectation | Fixed | repo/src/modules/search/route.js, repo/src/modules/search/search.service.js, repo/src/modules/search/saved-queries.service.js | Filters for lifecycle/effective-date/name/description/tags are wired in schema, SQL builder, and saved-query run path. |

## 3) Boundary and Caveats

- This is static verification only; runtime behavior (load, lock contention timing, DB engine edge cases) was not executed.
- Statuses apply only to the prior issue set from `.tmp/audit_report-1.md`.

## 4) Output Path

- .tmp/audit_report-1-reverification-2026-04-14-static.md
