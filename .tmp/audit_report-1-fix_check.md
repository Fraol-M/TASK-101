# Previous Errors Fix Verification (Static-Only)

Date: 2026-04-12
Repository: repo
Verification mode: Static-only (no runtime execution)
Baseline findings: `.tmp/delivery-architecture-audit-2026-04-12-static.md`

## 1) Verification Summary

- Fixed: 10 / 10
- Partially fixed: 0 / 10
- Not fixed: 0 / 10

## 2) Issue-by-Issue Status

| # | Prior Finding | Current Status | Evidence (static) | Verification Notes |
|---|---|---|---|---|
| 1 | Idempotency bypass for successful 204/no-body writes | **Fixed** | `src/common/idempotency/idempotency.middleware.js:76`, `src/common/idempotency/idempotency.middleware.js:83` | Middleware persists idempotency records for successful `2xx` writes and stores a canonical empty payload fallback (`ctx.body ?? {}`), so 204 write endpoints are covered. |
| 2 | Full audit trail not met across all create/update paths | **Fixed** | `src/modules/accounts/account.service.js:35`, `src/modules/accounts/account.service.js:56`, `src/modules/rbac/rbac.service.js:60`, `src/modules/rbac/rbac.service.js:79`, `src/modules/rbac/rbac.service.js:101`, `src/modules/personalization/personalization.service.js:19`, `src/modules/personalization/personalization.service.js:50`, `src/modules/personalization/personalization.service.js:69`, `src/modules/personalization/personalization.service.js:107`, `src/modules/personalization/personalization.service.js:142`, `src/modules/search/saved-queries.service.js:25`, `src/modules/search/saved-queries.service.js:52`, `src/modules/search/saved-queries.service.js:68` | Previously missing domains now emit audit events for personalization and saved-query mutations; baseline gaps are closed. |
| 3 | Personalization similarity depth insufficient | **Fixed** | `src/modules/personalization/personalization.service.js:270`, `src/modules/personalization/personalization.service.js:288`, `src/modules/personalization/personalization.service.js:289`, `src/modules/personalization/personalization.service.js:331` | Recommendation logic now includes explicit tag-similarity scoring (Jaccard-style) across expanded entity tables. |
| 4 | Auth reliability risk from lock-skip behavior | **Fixed** | `src/modules/auth/session.service.js:55`, `src/modules/auth/session.service.js:73`, `src/modules/auth/session.service.js:79`, `src/modules/auth/session.service.js:82` | Session rotation now uses `FOR UPDATE NOWAIT` with retry/backoff on lock contention, replacing lock-skip semantics. |
| 5 | Purge script interval SQL likely invalid | **Fixed** | `scripts/purge-expired-data.js:38`, `scripts/purge-expired-data.js:43` | Purge query uses parameter-safe interval arithmetic (`NOW() - (? * INTERVAL '1 day')`). |
| 6 | Saved-query PATCH mismatch and missing validation | **Fixed** | `src/modules/search/route.js:37`, `src/modules/search/route.js:122`, `src/modules/search/route.js:133`, `src/modules/search/saved-queries.service.js:47` | PATCH body is schema-validated and route params are validated; service maps camelCase `queryText` to DB `query_text`. |
| 7 | UUID path-param validation inconsistently applied | **Fixed** | `src/modules/accounts/route.js:16`, `src/modules/accounts/route.js:28`, `src/modules/university-data/_versioning/versioned.route.factory.js:62`, `src/modules/university-data/_versioning/versioned.route.factory.js:98`, `src/modules/rbac/route.js:18`, `src/modules/rbac/route.js:43`, `src/modules/rbac/route.js:58`, `src/modules/search/route.js:20`, `src/modules/search/route.js:122`, `src/modules/search/route.js:133`, `src/modules/search/route.js:144` | Previously unvalidated `:id` params in RBAC/search now have UUID schema validation; baseline inconsistency is resolved. |
| 8 | Audit view masking semantics mismatch | **Fixed** | `src/modules/admin/audit/audit.service.js:8`, `src/modules/admin/audit/audit.service.js:13`, `src/modules/admin/audit/audit.service.js:70`, `src/modules/admin/audit/audit.service.js:74`, `src/modules/admin/audit/audit.service.js:75` | Non-admin viewers now receive masked summaries (not null summaries), aligning implementation with masked-view requirement. |
| 9 | Documentation inconsistency for audit-events access scope | **Fixed** | `docs/security-model.md:44`, `docs/security-model.md:45`, `docs/security-model.md:99`, `docs/permission-matrix.md:24`, `docs/permission-matrix.md:52` | Security and permission docs now align: `audit:read` includes SYSTEM_ADMIN/PROGRAM_ADMIN/READ_ONLY, with full vs masked semantics stated consistently. |
| 10 | Search fielded filtering narrower than expectation | **Fixed** | `src/modules/search/route.js:16`, `src/modules/search/route.js:17`, `src/modules/search/route.js:18`, `src/modules/search/route.js:65`, `src/modules/search/route.js:66`, `src/modules/search/route.js:67`, `src/modules/search/search.service.js:65`, `src/modules/search/search.service.js:66`, `src/modules/search/search.service.js:69`, `src/modules/search/search.service.js:103`, `src/modules/search/search.service.js:129`, `src/modules/search/search.service.js:130`, `src/modules/search/search.service.js:145`, `src/modules/search/saved-queries.service.js:90`, `src/modules/search/saved-queries.service.js:91`, `src/modules/search/saved-queries.service.js:92` | Payload-level field filters `nameContains` (ILIKE on `payload_json->>'name'`), `descriptionContains` (ILIKE on `payload_json->>'description'`), and `tags` (JSON containment OR-match via `payload_json->'tags' @> ?::jsonb`) added to request schema, service SQL, and saved-query run path. |

## 3) Residual Risk Notes (Static)

- Runtime behavior is still unverified for lock contention and idempotent replay under real load.

## 4) Output

This verification result has been updated in:
- `.tmp/previous-errors-fix-verification-2026-04-11-static.md`
