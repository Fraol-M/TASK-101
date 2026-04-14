# Security Model

## Access Control Model

The service enforces capability-based access control through route-level permission checks and role-to-permission mappings seeded from `db/seeds/00_roles_permissions.js`.

## Audit Events Access

Capability: `audit:read`

Roles with `audit:read`:
- `SYSTEM_ADMIN`
- `PROGRAM_ADMIN`
- `READ_ONLY`

Response semantics for `GET /v1/admin/audit-events`:
- `SYSTEM_ADMIN`: full event payload (unmasked summaries)
- `PROGRAM_ADMIN` and `READ_ONLY`: masked `before_summary` and `after_summary`

Masking is applied in `src/modules/admin/audit/audit.service.js` using field-level masking for string values.

## Metrics Access

Capability: `metrics:read`

Roles with `metrics:read`:
- `SYSTEM_ADMIN`

## Notes

This document is normative for authorization semantics and should remain aligned with:
- `db/seeds/00_roles_permissions.js`
- `src/modules/admin/route.js`
- `src/modules/admin/audit/audit.service.js`
