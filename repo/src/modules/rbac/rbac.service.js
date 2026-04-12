import knex from '../../common/db/knex.js';
import { auditService } from '../admin/audit/audit.service.js';

/**
 * RBAC service.
 * Checks whether an account has a specific capability via its assigned roles.
 */
export const rbacService = {
  /**
   * Check if an account has permission to perform a capability.
   * @param {string} accountId
   * @param {string} capability  e.g. 'university-data:publish'
   * @returns {Promise<boolean>}
   */
  async can(accountId, capability) {
    const result = await knex('account_roles')
      .join('role_permissions', 'role_permissions.role_id', 'account_roles.role_id')
      .join('permissions', 'permissions.id', 'role_permissions.permission_id')
      .where('account_roles.account_id', accountId)
      .where('permissions.capability', capability)
      .first('permissions.id');

    return Boolean(result);
  },

  /**
   * Get all capabilities for an account.
   * @param {string} accountId
   * @returns {Promise<string[]>}
   */
  async getCapabilities(accountId) {
    return knex('account_roles')
      .join('role_permissions', 'role_permissions.role_id', 'account_roles.role_id')
      .join('permissions', 'permissions.id', 'role_permissions.permission_id')
      .where('account_roles.account_id', accountId)
      .pluck('permissions.capability');
  },

  /**
   * Get all roles for an account.
   * @param {string} accountId
   * @returns {Promise<string[]>}
   */
  async getRoles(accountId) {
    return knex('account_roles')
      .join('roles', 'roles.id', 'account_roles.role_id')
      .where('account_roles.account_id', accountId)
      .pluck('roles.name');
  },

  async listRoles() {
    return knex('roles').orderBy('name');
  },

  async createRole({ name, description }, actorAccountId, requestId, trx) {
    const [role] = await (trx || knex)('roles')
      .insert({ name, description })
      .returning('*');

    await auditService.record({
      actorAccountId,
      actionType: 'role.created',
      entityType: 'role',
      entityId: role.id,
      requestId,
      afterSummary: { name: role.name },
    }, trx);

    return role;
  },

  async updateRole(roleId, patch, actorAccountId, requestId, trx) {
    const before = await (trx || knex)('roles').where({ id: roleId }).first('name');
    const [role] = await (trx || knex)('roles')
      .where({ id: roleId })
      .update(patch)
      .returning('*');

    await auditService.record({
      actorAccountId,
      actionType: 'role.updated',
      entityType: 'role',
      entityId: roleId,
      requestId,
      beforeSummary: before ? { name: before.name } : undefined,
      afterSummary: role ? { name: role.name } : undefined,
    }, trx);

    return role;
  },

  async assignRole(accountId, roleName, assignedBy, requestId, trx) {
    const role = await (trx || knex)('roles').where({ name: roleName }).first('id');
    if (!role) throw new Error(`Role ${roleName} not found`);

    await (trx || knex)('account_roles')
      .insert({ account_id: accountId, role_id: role.id, assigned_by: assignedBy })
      .onConflict(['account_id', 'role_id'])
      .ignore();

    await auditService.record({
      actorAccountId: assignedBy,
      actionType: 'role.assigned',
      entityType: 'account',
      entityId: accountId,
      requestId,
      afterSummary: { roleName },
    }, trx);
  },

  async listPermissions() {
    return knex('permissions').orderBy('capability');
  },
};
