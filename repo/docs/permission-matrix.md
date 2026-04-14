# Permission Matrix

## Audit and Observability Capabilities

| Capability | SYSTEM_ADMIN | PROGRAM_ADMIN | READ_ONLY | REVIEWER | APPLICANT |
|---|---|---|---|---|---|
| `audit:read` | yes (full) | yes (masked) | yes (masked) | no | no |
| `metrics:read` | yes | no | no | no | no |

## Admin Endpoints

| Endpoint | Required Capability | Effective Access |
|---|---|---|
| `GET /v1/admin/audit-events` | `audit:read` | SYSTEM_ADMIN (full), PROGRAM_ADMIN (masked), READ_ONLY (masked) |
| `GET /v1/admin/metrics` | `metrics:read` | SYSTEM_ADMIN |

## Source of Truth

This matrix is derived from and must remain aligned with:
- `db/seeds/00_roles_permissions.js`
- `src/modules/admin/route.js`
- `src/modules/admin/audit/audit.service.js`
