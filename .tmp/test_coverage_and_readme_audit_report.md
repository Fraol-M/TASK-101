# Test Coverage Audit

## Scope, Method, and Constraints
- Audit mode: static inspection only (no test execution, no builds, no runtime validation).
- Scope inspected: `repo/src` route wiring, `repo/tests` test definitions, `repo/run_tests.sh`, `repo/README.md`, minimal structure only.
- Project type detection: `backend` (declared in `repo/README.md:3` as `> **Project type:** backend`).

## Endpoint Inventory and Mapping

### Backend Endpoint Inventory

- GET /health
- POST /v1/auth/login
- POST /v1/auth/logout
- POST /v1/auth/password/rotate
- GET /v1/accounts/me
- GET /v1/accounts/:id
- POST /v1/accounts
- PATCH /v1/accounts/:id/status
- GET /v1/admin/roles
- POST /v1/admin/roles
- PATCH /v1/admin/roles/:id
- POST /v1/admin/accounts/:id/roles
- GET /v1/admin/permissions
- GET /v1/admin/metrics
- GET /v1/admin/audit-events
- GET /v1/admin/reviewer-pool
- GET /v1/admin/reviewer-pool/:id
- POST /v1/admin/reviewer-pool
- PATCH /v1/admin/reviewer-pool/:id
- POST /v1/admin/reviewer-pool/:id/institution-history
- POST /v1/applications
- GET /v1/applications
- GET /v1/applications/:id
- POST /v1/assignments
- POST /v1/assignments/batch
- GET /v1/assignments
- GET /v1/assignments/:id
- GET /v1/workbench
- GET /v1/workbench/:assignmentId
- PUT /v1/scores/draft
- POST /v1/scores/submit
- GET /v1/scores/:assignmentId
- POST /v1/attachments
- GET /v1/attachments
- DELETE /v1/attachments/:id
- POST /v1/rankings/cycles/:cycleId/aggregate
- POST /v1/rankings/cycles/:cycleId/rank
- GET /v1/rankings/cycles/:cycleId
- POST /v1/rankings/escalations
- GET /v1/search
- GET /v1/search/suggest
- GET /v1/search/saved-queries
- POST /v1/search/saved-queries
- PATCH /v1/search/saved-queries/:id
- DELETE /v1/search/saved-queries/:id
- POST /v1/search/saved-queries/:id/run
- POST /v1/personalization/views
- GET /v1/personalization/history
- GET /v1/personalization/bookmarks
- POST /v1/personalization/bookmarks
- DELETE /v1/personalization/bookmarks
- GET /v1/personalization/recommendations
- GET /v1/personalization/preferences
- PUT /v1/personalization/preferences/:key
- DELETE /v1/personalization/preferences/:key
- GET /v1/personalization/subscriptions
- POST /v1/personalization/subscriptions
- DELETE /v1/personalization/subscriptions/:tag
- POST /v1/universities
- GET /v1/universities
- GET /v1/universities/:stableId
- GET /v1/universities/:stableId/current
- GET /v1/universities/:stableId/versions
- GET /v1/universities/:stableId/versions/:versionId
- POST /v1/universities/:stableId/versions
- PATCH /v1/universities/:stableId/versions/:versionId
- POST /v1/universities/:stableId/versions/:versionId/publish
- POST /v1/universities/:stableId/versions/:versionId/activate
- POST /v1/universities/:stableId/archive
- POST /v1/schools
- GET /v1/schools
- GET /v1/schools/:stableId
- GET /v1/schools/:stableId/current
- GET /v1/schools/:stableId/versions
- GET /v1/schools/:stableId/versions/:versionId
- POST /v1/schools/:stableId/versions
- PATCH /v1/schools/:stableId/versions/:versionId
- POST /v1/schools/:stableId/versions/:versionId/publish
- POST /v1/schools/:stableId/versions/:versionId/activate
- POST /v1/schools/:stableId/archive
- POST /v1/majors
- GET /v1/majors
- GET /v1/majors/:stableId
- GET /v1/majors/:stableId/current
- GET /v1/majors/:stableId/versions
- GET /v1/majors/:stableId/versions/:versionId
- POST /v1/majors/:stableId/versions
- PATCH /v1/majors/:stableId/versions/:versionId
- POST /v1/majors/:stableId/versions/:versionId/publish
- POST /v1/majors/:stableId/versions/:versionId/activate
- POST /v1/majors/:stableId/archive
- POST /v1/research-tracks
- GET /v1/research-tracks
- GET /v1/research-tracks/:stableId
- GET /v1/research-tracks/:stableId/current
- GET /v1/research-tracks/:stableId/versions
- GET /v1/research-tracks/:stableId/versions/:versionId
- POST /v1/research-tracks/:stableId/versions
- PATCH /v1/research-tracks/:stableId/versions/:versionId
- POST /v1/research-tracks/:stableId/versions/:versionId/publish
- POST /v1/research-tracks/:stableId/versions/:versionId/activate
- POST /v1/research-tracks/:stableId/archive
- POST /v1/enrollment-plans
- GET /v1/enrollment-plans
- GET /v1/enrollment-plans/:stableId
- GET /v1/enrollment-plans/:stableId/current
- GET /v1/enrollment-plans/:stableId/versions
- GET /v1/enrollment-plans/:stableId/versions/:versionId
- POST /v1/enrollment-plans/:stableId/versions
- PATCH /v1/enrollment-plans/:stableId/versions/:versionId
- POST /v1/enrollment-plans/:stableId/versions/:versionId/publish
- POST /v1/enrollment-plans/:stableId/versions/:versionId/activate
- POST /v1/enrollment-plans/:stableId/archive
- POST /v1/transfer-quotas
- GET /v1/transfer-quotas
- GET /v1/transfer-quotas/:stableId
- GET /v1/transfer-quotas/:stableId/current
- GET /v1/transfer-quotas/:stableId/versions
- GET /v1/transfer-quotas/:stableId/versions/:versionId
- POST /v1/transfer-quotas/:stableId/versions
- PATCH /v1/transfer-quotas/:stableId/versions/:versionId
- POST /v1/transfer-quotas/:stableId/versions/:versionId/publish
- POST /v1/transfer-quotas/:stableId/versions/:versionId/activate
- POST /v1/transfer-quotas/:stableId/archive
- POST /v1/application-requirements
- GET /v1/application-requirements
- GET /v1/application-requirements/:stableId
- GET /v1/application-requirements/:stableId/current
- GET /v1/application-requirements/:stableId/versions
- GET /v1/application-requirements/:stableId/versions/:versionId
- POST /v1/application-requirements/:stableId/versions
- PATCH /v1/application-requirements/:stableId/versions/:versionId
- POST /v1/application-requirements/:stableId/versions/:versionId/publish
- POST /v1/application-requirements/:stableId/versions/:versionId/activate
- POST /v1/application-requirements/:stableId/archive
- POST /v1/retest-rules
- GET /v1/retest-rules
- GET /v1/retest-rules/:stableId
- GET /v1/retest-rules/:stableId/current
- GET /v1/retest-rules/:stableId/versions
- GET /v1/retest-rules/:stableId/versions/:versionId
- POST /v1/retest-rules/:stableId/versions
- PATCH /v1/retest-rules/:stableId/versions/:versionId
- POST /v1/retest-rules/:stableId/versions/:versionId/publish
- POST /v1/retest-rules/:stableId/versions/:versionId/activate
- POST /v1/retest-rules/:stableId/archive

### API Test Mapping Table

| Endpoint | Covered | Test Type | Test Files | Evidence |
|---|---|---|---|---|
| GET /health | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js; tests/api/health.spec.js | api-nomock.spec.js describe('GET /health ? no-mock'); health.spec.js uses vi.mock(config/env) |
| POST /v1/auth/login | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js; tests/api/auth.login.spec.js | api-nomock.spec.js describe('POST /v1/auth/login ? no-mock') |
| POST /v1/auth/logout | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js; tests/api/auth.login.spec.js | api-nomock.spec.js describe('POST /v1/auth/logout ? no-mock') |
| POST /v1/auth/password/rotate | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/auth.login.spec.js | api-nomock.admin.spec.js tests POST /v1/auth/password/rotate |
| GET /v1/accounts/me | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/accounts.spec.js | api-nomock.admin.spec.js describe('GET /v1/accounts/me ? no-mock') |
| GET /v1/accounts/:id | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/accounts.spec.js | api-nomock.admin.spec.js it('GET /v1/accounts/:id ? returns the created account') |
| POST /v1/accounts | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/accounts.spec.js | api-nomock.admin.spec.js describe('POST /v1/accounts ? no-mock') |
| PATCH /v1/accounts/:id/status | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/accounts.spec.js | api-nomock.admin.spec.js it('PATCH /v1/accounts/:id/status ? suspends the account') |
| GET /v1/admin/roles | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/rbac.spec.js | api-nomock.admin.spec.js describe('RBAC ? no-mock') |
| POST /v1/admin/roles | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/rbac.spec.js | api-nomock.admin.spec.js describe('RBAC ? no-mock') |
| PATCH /v1/admin/roles/:id | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/rbac.spec.js | api-nomock.admin.spec.js describe('RBAC ? no-mock') |
| POST /v1/admin/accounts/:id/roles | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/rbac.spec.js | api-nomock.admin.spec.js describe('RBAC ? no-mock') |
| GET /v1/admin/permissions | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/rbac.spec.js | api-nomock.admin.spec.js describe('RBAC ? no-mock') |
| GET /v1/admin/metrics | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/admin.extended.spec.js | api-nomock.admin.spec.js describe('Admin ? no-mock') |
| GET /v1/admin/audit-events | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js | api-nomock.admin.spec.js describe('Admin ? no-mock') |
| GET /v1/admin/reviewer-pool | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/admin.extended.spec.js | api-nomock.admin.spec.js describe('Reviewer pool ? no-mock') |
| GET /v1/admin/reviewer-pool/:id | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/admin.extended.spec.js | api-nomock.admin.spec.js describe('Reviewer pool ? no-mock') |
| POST /v1/admin/reviewer-pool | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/admin.extended.spec.js | api-nomock.admin.spec.js describe('Reviewer pool ? no-mock') |
| PATCH /v1/admin/reviewer-pool/:id | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/admin.reviewer-pool.spec.js | api-nomock.admin.spec.js describe('Reviewer pool ? no-mock') |
| POST /v1/admin/reviewer-pool/:id/institution-history | yes | true no-mock HTTP | tests/integration/api-nomock.admin.spec.js; tests/api/admin.extended.spec.js | api-nomock.admin.spec.js describe('Reviewer pool ? no-mock') |
| POST /v1/applications | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/applications.spec.js | api-nomock.reviews.spec.js describe('Applications ? no-mock') |
| GET /v1/applications | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/applications.spec.js | api-nomock.reviews.spec.js describe('Applications ? no-mock') |
| GET /v1/applications/:id | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/applications.spec.js | api-nomock.reviews.spec.js describe('Applications ? no-mock') |
| POST /v1/assignments | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/assignments.spec.js | api-nomock.reviews.spec.js describe('Assignments ? no-mock') |
| POST /v1/assignments/batch | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/assignments.spec.js | api-nomock.reviews.spec.js describe('Assignments ? no-mock') |
| GET /v1/assignments | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/assignments.spec.js | api-nomock.reviews.spec.js describe('Assignments ? no-mock') |
| GET /v1/assignments/:id | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/assignments.spec.js | api-nomock.reviews.spec.js describe('Assignments ? no-mock') |
| GET /v1/workbench | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/workbench.spec.js | api-nomock.reviews.spec.js describe('Workbench ? no-mock') |
| GET /v1/workbench/:assignmentId | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/workbench.spec.js | api-nomock.reviews.spec.js describe('Workbench ? no-mock') |
| PUT /v1/scores/draft | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/scores.spec.js | api-nomock.reviews.spec.js describe('Scoring ? no-mock') |
| POST /v1/scores/submit | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/scores.spec.js | api-nomock.reviews.spec.js describe('Scoring ? no-mock') |
| GET /v1/scores/:assignmentId | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/scores.spec.js | api-nomock.reviews.spec.js describe('Scoring ? no-mock') |
| POST /v1/attachments | yes | HTTP with mocking | tests/api/attachments.spec.js | attachments.spec.js mocks attachment.service/session/rbac |
| GET /v1/attachments | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/attachments.spec.js | api-nomock.reviews.spec.js it('GET /v1/attachments ? reviewer lists attachments for assignment') |
| DELETE /v1/attachments/:id | yes | HTTP with mocking | tests/api/attachments.spec.js | attachments.spec.js mocks attachment.service/session/rbac |
| POST /v1/rankings/cycles/:cycleId/aggregate | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/rankings.spec.js | api-nomock.reviews.spec.js describe('Rankings ? no-mock') |
| POST /v1/rankings/cycles/:cycleId/rank | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/rankings.spec.js | api-nomock.reviews.spec.js describe('Rankings ? no-mock') |
| GET /v1/rankings/cycles/:cycleId | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/rankings.spec.js | api-nomock.reviews.spec.js describe('Rankings ? no-mock') |
| POST /v1/rankings/escalations | yes | true no-mock HTTP | tests/integration/api-nomock.reviews.spec.js; tests/api/rankings.spec.js | api-nomock.reviews.spec.js describe('Rankings ? no-mock') |
| GET /v1/search | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js; tests/api/search.spec.js | api-nomock.spec.js describe('GET /v1/search ? no-mock') |
| GET /v1/search/suggest | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/search.spec.js | api-nomock.features.spec.js describe('Search ? no-mock') |
| GET /v1/search/saved-queries | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/search.spec.js | api-nomock.features.spec.js describe('Search ? no-mock') |
| POST /v1/search/saved-queries | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/search.spec.js | api-nomock.features.spec.js describe('Search ? no-mock') |
| PATCH /v1/search/saved-queries/:id | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/search.spec.js | api-nomock.features.spec.js describe('Search ? no-mock') |
| DELETE /v1/search/saved-queries/:id | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/search.spec.js | api-nomock.features.spec.js describe('Search ? no-mock') |
| POST /v1/search/saved-queries/:id/run | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/search.spec.js | api-nomock.features.spec.js describe('Search ? no-mock') |
| POST /v1/personalization/views | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| GET /v1/personalization/history | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| GET /v1/personalization/bookmarks | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| POST /v1/personalization/bookmarks | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| DELETE /v1/personalization/bookmarks | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| GET /v1/personalization/recommendations | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| GET /v1/personalization/preferences | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| PUT /v1/personalization/preferences/:key | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| DELETE /v1/personalization/preferences/:key | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| GET /v1/personalization/subscriptions | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| POST /v1/personalization/subscriptions | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| DELETE /v1/personalization/subscriptions/:tag | yes | true no-mock HTTP | tests/integration/api-nomock.features.spec.js; tests/api/personalization.spec.js | api-nomock.features.spec.js describe('Personalization ? no-mock') |
| POST /v1/universities | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for universities |
| GET /v1/universities | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for universities |
| GET /v1/universities/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for universities |
| GET /v1/universities/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for universities |
| GET /v1/universities/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for universities |
| GET /v1/universities/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for universities |
| POST /v1/universities/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for universities |
| PATCH /v1/universities/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for universities |
| POST /v1/universities/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for universities |
| POST /v1/universities/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for universities |
| POST /v1/universities/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for universities |
| POST /v1/schools | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for schools |
| GET /v1/schools | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for schools |
| GET /v1/schools/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for schools |
| GET /v1/schools/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for schools |
| GET /v1/schools/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for schools |
| GET /v1/schools/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for schools |
| POST /v1/schools/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for schools |
| PATCH /v1/schools/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for schools |
| POST /v1/schools/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for schools |
| POST /v1/schools/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for schools |
| POST /v1/schools/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for schools |
| POST /v1/majors | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for majors |
| GET /v1/majors | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for majors |
| GET /v1/majors/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for majors |
| GET /v1/majors/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for majors |
| GET /v1/majors/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for majors |
| GET /v1/majors/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for majors |
| POST /v1/majors/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for majors |
| PATCH /v1/majors/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for majors |
| POST /v1/majors/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for majors |
| POST /v1/majors/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for majors |
| POST /v1/majors/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for majors |
| POST /v1/research-tracks | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for research-tracks |
| GET /v1/research-tracks | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for research-tracks |
| GET /v1/research-tracks/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for research-tracks |
| GET /v1/research-tracks/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for research-tracks |
| GET /v1/research-tracks/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for research-tracks |
| GET /v1/research-tracks/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for research-tracks |
| POST /v1/research-tracks/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for research-tracks |
| PATCH /v1/research-tracks/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for research-tracks |
| POST /v1/research-tracks/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for research-tracks |
| POST /v1/research-tracks/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for research-tracks |
| POST /v1/research-tracks/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for research-tracks |
| POST /v1/enrollment-plans | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for enrollment-plans |
| GET /v1/enrollment-plans | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for enrollment-plans |
| GET /v1/enrollment-plans/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for enrollment-plans |
| GET /v1/enrollment-plans/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for enrollment-plans |
| GET /v1/enrollment-plans/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for enrollment-plans |
| GET /v1/enrollment-plans/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for enrollment-plans |
| POST /v1/enrollment-plans/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for enrollment-plans |
| PATCH /v1/enrollment-plans/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for enrollment-plans |
| POST /v1/enrollment-plans/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for enrollment-plans |
| POST /v1/enrollment-plans/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for enrollment-plans |
| POST /v1/enrollment-plans/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for enrollment-plans |
| POST /v1/transfer-quotas | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for transfer-quotas |
| GET /v1/transfer-quotas | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for transfer-quotas |
| GET /v1/transfer-quotas/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for transfer-quotas |
| GET /v1/transfer-quotas/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for transfer-quotas |
| GET /v1/transfer-quotas/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for transfer-quotas |
| GET /v1/transfer-quotas/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for transfer-quotas |
| POST /v1/transfer-quotas/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for transfer-quotas |
| PATCH /v1/transfer-quotas/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for transfer-quotas |
| POST /v1/transfer-quotas/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for transfer-quotas |
| POST /v1/transfer-quotas/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for transfer-quotas |
| POST /v1/transfer-quotas/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for transfer-quotas |
| POST /v1/application-requirements | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for application-requirements |
| GET /v1/application-requirements | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for application-requirements |
| GET /v1/application-requirements/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for application-requirements |
| GET /v1/application-requirements/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for application-requirements |
| GET /v1/application-requirements/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for application-requirements |
| GET /v1/application-requirements/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for application-requirements |
| POST /v1/application-requirements/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for application-requirements |
| PATCH /v1/application-requirements/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for application-requirements |
| POST /v1/application-requirements/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for application-requirements |
| POST /v1/application-requirements/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for application-requirements |
| POST /v1/application-requirements/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for application-requirements |
| POST /v1/retest-rules | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create for retest-rules |
| GET /v1/retest-rules | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle/list tests hit list for retest-rules |
| GET /v1/retest-rules/:stableId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit detail for retest-rules |
| GET /v1/retest-rules/:stableId/current | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit current for retest-rules |
| GET /v1/retest-rules/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit versions list for retest-rules |
| GET /v1/retest-rules/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit version detail for retest-rules |
| POST /v1/retest-rules/:stableId/versions | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit create new draft for retest-rules |
| PATCH /v1/retest-rules/:stableId/versions/:versionId | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit patch for retest-rules |
| POST /v1/retest-rules/:stableId/versions/:versionId/publish | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit publish for retest-rules |
| POST /v1/retest-rules/:stableId/versions/:versionId/activate | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit activate for retest-rules |
| POST /v1/retest-rules/:stableId/archive | yes | true no-mock HTTP | tests/integration/api-nomock.spec.js or api-nomock.features.spec.js; tests/api/university-data.spec.js | No-mock lifecycle tests hit archive for retest-rules |
Generated 146 endpoints

## API Test Classification
1. True No-Mock HTTP
- `repo/tests/integration/api-nomock.spec.js`
- `repo/tests/integration/api-nomock.admin.spec.js`
- `repo/tests/integration/api-nomock.reviews.spec.js`
- `repo/tests/integration/api-nomock.features.spec.js`
- Evidence: supertest + `createApp().callback()` and no `vi.mock` usage in these files.

2. HTTP with Mocking
- Entire `repo/tests/api/*.spec.js` suite.
- Evidence: pervasive `vi.mock(...)` in API test files, including service-layer mocks (examples: `repo/tests/api/applications.spec.js:47`, `repo/tests/api/attachments.spec.js:48`, `repo/tests/api/search.spec.js:43`, `repo/tests/api/rankings.spec.js:46`, `repo/tests/api/university-data.spec.js:48`).

3. Non-HTTP (unit/integration without API-route HTTP)
- `repo/tests/unit/*.spec.js`
- Integration service-level tests such as:
  - `repo/tests/integration/aggregation.escalation.spec.js`
  - `repo/tests/integration/scoring.submit.spec.js`
  - `repo/tests/integration/university-data.lifecycle.spec.js`
  - `repo/tests/integration/search.fts.spec.js`
  - `repo/tests/integration/personalization.isolation.spec.js`
  - `repo/tests/integration/saved-queries.ownership.spec.js`
  - `repo/tests/integration/idempotency.race.spec.js`
  - `repo/tests/integration/batch-assignment-capacity.spec.js`
  - `repo/tests/integration/coi.institution-window.spec.js`
  - `repo/tests/integration/assignment-object-auth.spec.js`
  - `repo/tests/integration/applications.submission.spec.js`

## Mock Detection (Strict)
Detected mocks include:
- Auth/session and RBAC dependencies in API tests:
  - `repo/tests/api/accounts.spec.js:10`, `:14`
  - `repo/tests/api/applications.spec.js:13`, `:17`
  - `repo/tests/api/workbench.spec.js:10`, `:14`
- Service-layer mocks in API tests:
  - `repo/tests/api/accounts.spec.js:44` (account service)
  - `repo/tests/api/applications.spec.js:47` (application service)
  - `repo/tests/api/assignments.spec.js:43` (assignment service)
  - `repo/tests/api/scores.spec.js:54` (scoring service)
  - `repo/tests/api/attachments.spec.js:48` (attachment service)
  - `repo/tests/api/search.spec.js:43`, `:50` (search and saved-queries services)
  - `repo/tests/api/personalization.spec.js:44` (personalization service)
  - `repo/tests/api/rankings.spec.js:46` (aggregation service)
  - `repo/tests/api/university-data.spec.js:48` (versioned service factory)
- Shared infra mocks:
  - `repo/tests/api/*.spec.js` commonly mock `config/env`, `audit.service`, and `idempotency.repository`.

## Coverage Summary
- Total endpoints: 146
- Endpoints with HTTP tests: 146
- Endpoints with TRUE no-mock HTTP coverage: 144
- HTTP coverage: 100.00%
- True API coverage: 98.63%

Endpoints lacking true no-mock coverage (HTTP with mocking only):
- `POST /v1/attachments`
- `DELETE /v1/attachments/:id`

## Unit Test Analysis
### Backend Unit Tests
- Unit test files present: 19 (`repo/tests/unit/*.spec.js`).
- Modules covered (evidence from filenames):
  - Services: accounts, auth, applications, assignments, workbench, reviewer-pool, rbac, personalization, search, saved-queries.
  - Domain logic: scoring composite, aggregation trimmed mean, versioning publish transitions, COI checks, idempotency.
  - Security/ops helpers: logger redaction, password rules, audit service.
- Important backend modules not explicitly unit-tested (by file-level evidence):
  - Route/controller layer as isolated units (route behavior relies mostly on API/integration tests, not controller-unit tests).
  - `src/modules/reviews/attachments/attachment.service.js` has integration coverage, but no unit spec in `tests/unit`.
  - Middleware units for `auth.middleware`, `metrics.middleware`, `request-id.middleware`, `validate.middleware` are not explicitly present as dedicated unit files.

### Frontend Unit Tests (STRICT REQUIREMENT)
- Frontend test files: NONE
- Frontend frameworks/tools detected: NONE
- Frontend components/modules covered: NONE
- Important frontend components/modules not tested: not applicable (no frontend codebase detected)
- Mandatory verdict: **Frontend unit tests: MISSING**
- Critical-gap rule applicability: not triggered (project type is backend, not fullstack/web).

### Cross-Layer Observation
- Backend-only repository structure; no frontend layer detected.
- Backend test depth is substantial across API, integration, and unit levels.

## API Observability Check
- Strong in no-mock integration suites: endpoint/method, request inputs, and response assertions are usually explicit (`repo/tests/integration/api-nomock*.spec.js`).
- Mixed in mocked API suites: many tests validate status/errors and contract shape, but business-path realism is reduced by service mocking.
- Weak spots:
  - Attachment upload/delete real-path observability is absent in no-mock HTTP coverage.
  - Some no-mock tests allow broad status sets (e.g., `[200,409,422]`), which lowers determinism for strict behavioral assertions.

## Test Quality & Sufficiency
- Success/failure/validation/auth paths: broadly covered.
- Edge-case and authorization depth: good, including ownership/COI/idempotency/race behaviors in integration suite.
- Over-mocking risk: high in `tests/api` layer, partially compensated by no-mock integration suites.
- `run_tests.sh` check:
  - Docker-based orchestration present (`repo/run_tests.sh`, compose-based flow).
  - No local package install dependency mandated in the script.

## End-to-End Expectations
- Project type is backend; frontend?backend E2E is not applicable.
- For backend expectations, API + integration depth is strong overall.

## Tests Check
- Endpoint inventory resolved with prefixes and generated versioned routes (8 entities x 11 endpoints from factory).
- Every endpoint has HTTP-level coverage.
- True no-mock gap exists for two attachment write endpoints.

## Test Coverage Score (0-100)
**90/100**

## Score Rationale
- + Full HTTP endpoint coverage (146/146).
- + Very high true no-mock route coverage (144/146).
- + Strong non-HTTP integration depth for business-critical domains.
- - API test suite heavily relies on mocking; route-level API tests are not predominantly real-logic executions.
- - No true no-mock coverage for attachment upload/delete endpoints.

## Key Gaps
- `POST /v1/attachments` lacks true no-mock API test.
- `DELETE /v1/attachments/:id` lacks true no-mock API test.
- Controller/middleware unit granularity is uneven (service-heavy unit strategy).

## Confidence & Assumptions
- Confidence: High.
- Assumptions:
  - Endpoint inventory is derived from static router declarations and factory-generated route patterns.
  - “Covered” is determined by explicit HTTP calls in test files; runtime success/failure was not executed per constraint.

## Test Coverage Audit Verdict
**PASS WITH GAPS**

---

# README Audit

## README Location Check
- Found at required path: `repo/README.md`.

## Hard Gates
### Formatting
- PASS: Markdown is structured and readable.

### Startup Instructions (backend/fullstack requirement)
- PASS: Includes `docker-compose up -d` (`repo/README.md:29`), satisfying required `docker-compose up` instruction.

### Access Method
- PASS: URL + port provided (`http://localhost:3000`, examples at `repo/README.md:38`, `:42`, `:47`).

### Verification Method
- PASS: Explicit verification via curl health/login/resource checks (`repo/README.md:38-47`).

### Environment Rules (no runtime/manual install)
- PASS: No `npm install`, `pip install`, `apt-get`, or manual DB setup steps documented.
- Docker-centric run/test instructions are present (`repo/README.md:29`, `:73`, `:122`, `:124`).

### Demo Credentials (conditional auth)
- PASS: Demo credentials provided with role mapping (`repo/README.md:51` onward).

## Engineering Quality Review
- Tech stack clarity: good (`repo/README.md` technology stack section).
- Architecture explanation: good high-level structure (`Project Structure` section).
- Testing instructions: adequate (`Run tests`, plus Docker script references).
- Security/roles clarity: acceptable (credential table + docs references).
- Presentation quality: good and operationally usable.

## High Priority Issues
- None.

## Medium Priority Issues
- README does not explicitly cross-reference which endpoints are covered by true no-mock tests vs mocked API tests; auditability for test realism is therefore indirect.

## Low Priority Issues
- Detached mode `docker-compose up -d` is documented, but explicit log-follow troubleshooting guidance in Quick Start could be stronger.

## Hard Gate Failures
- None.

## README Verdict
**PASS**

---

# Final Verdicts
- Test Coverage Audit: **PASS WITH GAPS**
- README Audit: **PASS**



