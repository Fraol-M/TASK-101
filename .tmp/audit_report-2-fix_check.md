# Previous Inspection Errors Re-Verification (Static-Only)

Date: 2026-04-14
Repository: repo
Mode: Static-only (no runtime execution)
Source issue list: .tmp/audit_report-2.md

## 1) Result Summary

- Fixed: 6 / 6
- Partially fixed: 0 / 6
- Not fixed: 0 / 6
- Overall: All previously reported Issue H1-H3 and M1-M3 are fixed in current source (static evidence).

## 2) Issue-by-Issue Re-Verification

| # | Prior Issue | Current Status | Evidence (current static) | Verification Note |
|---|---|---|---|---|
| H1 | Reviewer can receive full blind mode payload when assignment is configured as full | Fixed | repo/src/modules/reviews/blind-modes/projection.service.js, repo/src/modules/reviews/assignments/route.js | Non-admin mode resolution now caps full to semi_blind (`return assignedMode === 'full' ? 'semi_blind' : assignedMode`), so reviewer responses no longer resolve to full payload. |
| H2 | Idempotency failure path can re-enable duplicate side effects | Fixed | repo/src/common/idempotency/idempotency.middleware.js | On `complete()` failure after retries, middleware now leaves slot pending and does not call `deletePending`, preventing duplicate handler execution on retry. |
| H3 | Versioned draft PATCH endpoint lacks body schema validation | Fixed | repo/src/modules/university-data/_versioning/versioned.route.factory.js | PATCH route now validates both params and body (`createSchema.partial()`), closing the unvalidated body path. |
| M1 | Attachment upload may leave orphaned files when DB checks fail after disk copy | Fixed | repo/src/modules/reviews/attachments/attachment.service.js | Service now performs compensating cleanup in catch path (`fs.unlink(absolutePath)`), removing copied files when transaction/DB checks fail. |
| M2 | Archive endpoint can return success for non-existent stable entities | Fixed | repo/src/modules/university-data/_versioning/versioned-repository.factory.js, repo/src/modules/university-data/_versioning/versioned.route.factory.js | Repository archive returns affected row count; route checks count and returns 404 when no rows were archived. |
| M3 | Predictable DB uniqueness conflicts can degrade to generic 500 responses | Fixed | repo/src/modules/reviews/assignments/assignment.service.js | Single-assignment create now catches SQLSTATE `23505` and maps to `ConflictError` with explicit conflict message rather than generic failure path. |

## 3) Boundary and Caveats

- This is static-only verification; runtime behavior under real load/concurrency/filesystem edge conditions was not executed.
- Statuses apply only to the prior Issue H1-H3 and M1-M3 set from `.tmp/audit_report-2.md`.

## 4) Output Path

- .tmp/audit_report-2-reverification-2026-04-14-static.md
