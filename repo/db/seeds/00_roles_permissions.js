/**
 * Seed: Roles and permissions.
 * Idempotent — safe to run multiple times.
 * Creates the 5 standard roles and their capability mappings.
 */

const ROLES = [
  { name: 'SYSTEM_ADMIN', description: 'Full system access' },
  { name: 'PROGRAM_ADMIN', description: 'Manage programs, assignments, and review cycles' },
  { name: 'REVIEWER', description: 'Submit reviews for assigned applications' },
  { name: 'APPLICANT', description: 'View own application status' },
  { name: 'READ_ONLY', description: 'Audit and reporting read access' },
];

const PERMISSIONS = [
  // Auth
  { capability: 'auth:login' },
  { capability: 'auth:logout' },
  // Accounts
  { capability: 'accounts:self:read' },
  { capability: 'accounts:self:update-password' },
  { capability: 'accounts:admin:manage' },
  // RBAC
  { capability: 'rbac:read' },
  { capability: 'rbac:write' },
  // Audit / metrics
  { capability: 'audit:read' },
  { capability: 'metrics:read' },
  // University data
  { capability: 'university-data:read' },
  { capability: 'university-data:write' },
  { capability: 'university-data:publish' },
  { capability: 'university-data:archive' },
  // Applications
  { capability: 'applications:read' },
  { capability: 'applications:write' },
  // Reviews
  { capability: 'reviewers:manage' },
  { capability: 'review-assignments:manage' },
  { capability: 'review:read-assigned' },
  { capability: 'review:submit' },
  // rankings:read — read ranked lists; rankings:compute — trigger aggregation/ranking mutations
  { capability: 'rankings:read' },
  { capability: 'rankings:compute' },
  { capability: 'escalations:write' },
  // Search
  { capability: 'search:query' },
  { capability: 'search:saved-query:manage' },
  // Personalization
  { capability: 'personalization:self:read' },
  { capability: 'personalization:self:write' },
];

// Role → capability mappings
const ROLE_PERMISSIONS = {
  SYSTEM_ADMIN: PERMISSIONS.map((p) => p.capability),
  PROGRAM_ADMIN: [
    'auth:login', 'auth:logout',
    'accounts:self:read', 'accounts:self:update-password',
    'university-data:read', 'university-data:write', 'university-data:publish', 'university-data:archive',
    'applications:read', 'applications:write',
    'reviewers:manage', 'review-assignments:manage',
    'review:read-assigned', 'review:submit',
    'rankings:read', 'rankings:compute', 'escalations:write',
    'search:query', 'search:saved-query:manage',
    'personalization:self:read', 'personalization:self:write',
    'audit:read',
  ],
  REVIEWER: [
    'auth:login', 'auth:logout',
    'accounts:self:read', 'accounts:self:update-password',
    'university-data:read',
    'review:read-assigned', 'review:submit',
    'search:query', 'search:saved-query:manage',
    'personalization:self:read', 'personalization:self:write',
  ],
  APPLICANT: [
    'auth:login', 'auth:logout',
    'accounts:self:read', 'accounts:self:update-password',
    'university-data:read',
    'applications:read', 'applications:write',
    'search:query',
    'personalization:self:read', 'personalization:self:write',
  ],
  READ_ONLY: [
    'auth:login', 'auth:logout',
    'accounts:self:read', 'accounts:self:update-password',
    'university-data:read',
    'applications:read',
    'rbac:read',
    'rankings:read',
    'search:query',
    'audit:read',
  ],
};

export async function seed(knex) {
  // Roles
  for (const role of ROLES) {
    await knex('roles').insert(role).onConflict('name').merge();
  }

  // Permissions
  for (const perm of PERMISSIONS) {
    await knex('permissions').insert(perm).onConflict('capability').merge();
  }

  // Role-permission mappings
  for (const [roleName, capabilities] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await knex('roles').where({ name: roleName }).first();
    if (!role) continue;

    for (const capability of capabilities) {
      const perm = await knex('permissions').where({ capability }).first();
      if (!perm) continue;

      await knex('role_permissions')
        .insert({ role_id: role.id, permission_id: perm.id })
        .onConflict(['role_id', 'permission_id'])
        .ignore();
    }
  }
}
