# Previous Inspection Errors Re-Verification (Static-Only)

Date: 2026-04-12
Repository: repo
Mode: Static-only (no runtime execution)
Source issue list: tmp/cycle1/previous-errors-fix-verification-2026-04-11-static.md

## 1) Result Summary

- Fixed: 10 / 10
- Partially fixed: 0 / 10
- Not fixed: 0 / 10
- Overall: All previously reported issues remain fixed in current source.

## 2) Issue-by-Issue Re-Verification

| # | Prior Issue | Current Status | Evidence (current static) | Verification Note |
|---|---|---|---|---|
| 1 | Idempotency bypass for successful 204/no-body writes | Fixed | src/common/idempotency/idempotency.middleware.js:128, src/common/idempotency/idempotency.middleware.js:154 | Response replay still suppresses empty body, and completion still stores `ctx.body ?? {}` for successful writes. |
| 2 | Full audit trail not met across create/update paths | Fixed | src/modules/accounts/account.service.js:37, src/modules/accounts/account.service.js:58, src/modules/rbac/rbac.service.js:62, src/modules/rbac/rbac.service.js:81, src/modules/rbac/rbac.service.js:103, src/modules/personalization/personalization.service.js:23, src/modules/personalization/personalization.service.js:55, src/modules/personalization/personalization.service.js:76, src/modules/personalization/personalization.service.js:116, src/modules/personalization/personalization.service.js:133, src/modules/personalization/personalization.service.js:155, src/modules/personalization/personalization.service.js:176, src/modules/search/saved-queries.service.js:28, src/modules/search/saved-queries.service.js:58, src/modules/search/saved-queries.service.js:80 | Mutation paths in the previously affected domains still emit audit events. |
| 3 | Personalization similarity depth insufficient | Fixed | src/modules/personalization/personalization.service.js:284, src/modules/personalization/personalization.service.js:302, src/modules/personalization/personalization.service.js:345, src/modules/personalization/personalization.service.js:354 | Tag-similarity scoring (Jaccard-based) remains implemented and applied during recommendation generation. |
| 4 | Auth reliability risk from lock-skip behavior | Fixed | src/modules/auth/session.service.js:58, src/modules/auth/session.service.js:76, src/modules/auth/session.service.js:83 | Session lookup continues to use `FOR UPDATE NOWAIT` with retry on lock contention. |
| 5 | Purge script interval SQL likely invalid | Fixed | scripts/purge-expired-data.js:38, scripts/purge-expired-data.js:43 | Purge still uses parameter-safe interval arithmetic in SQL whereRaw clauses. |
| 6 | Saved-query PATCH mismatch and missing validation | Fixed | src/modules/search/route.js:43, src/modules/search/route.js:132, src/modules/search/saved-queries.service.js:49, src/modules/search/saved-queries.service.js:51 | PATCH schema and params validation remain in route; camelCase `queryText` still maps to `query_text`. |
| 7 | UUID path-param validation inconsistently applied | Fixed | src/modules/accounts/route.js:16, src/modules/rbac/route.js:18, src/modules/search/route.js:23, src/modules/university-data/_versioning/versioned.validator.js:54, src/modules/university-data/_versioning/versioned.validator.js:55, src/modules/university-data/_versioning/versioned.route.factory.js:62, src/modules/university-data/_versioning/versioned.route.factory.js:126 | UUID validation remains present across the previously inconsistent route families. |
| 8 | Audit view masking semantics mismatch | Fixed | src/modules/admin/audit/audit.service.js:8, src/modules/admin/audit/audit.service.js:54, src/modules/admin/audit/audit.service.js:70, src/modules/admin/audit/audit.service.js:74, src/modules/admin/audit/audit.service.js:75 | Non-admin audit queries still return masked summaries instead of null summaries. |
| 9 | Documentation inconsistency for audit-events access scope | Fixed | docs/security-model.md:45, docs/security-model.md:99, docs/permission-matrix.md:24, docs/permission-matrix.md:52 | Security and permission docs remain aligned on `audit:read` scope and masked/full behavior. |
| 10 | Search fielded filtering narrower than expectation | Fixed | src/modules/search/route.js:16, src/modules/search/route.js:17, src/modules/search/route.js:18, src/modules/search/route.js:31, src/modules/search/route.js:32, src/modules/search/route.js:33, src/modules/search/route.js:65, src/modules/search/route.js:66, src/modules/search/route.js:67, src/modules/search/search.service.js:65, src/modules/search/search.service.js:66, src/modules/search/search.service.js:103, src/modules/search/search.service.js:129, src/modules/search/search.service.js:130, src/modules/search/saved-queries.service.js:101, src/modules/search/saved-queries.service.js:102, src/modules/search/saved-queries.service.js:103 | Field filters for name, description, and tags remain wired through request schema, search SQL, and saved-query run path. |

## 3) Boundary and Caveat

- This is static verification only; runtime behavior (load, concurrency, and DB-engine edge cases) is not executed here.
- Statuses above apply to the prior issue set only and do not claim absence of unrelated defects.

## 4) Output Path

- repo/.tmp/previous-errors-reverification-2026-04-12-static.md
