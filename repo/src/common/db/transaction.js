import knex from './knex.js';

/**
 * Wraps an async function in a Knex transaction.
 * Automatically commits on success and rolls back on error.
 * Re-throws the original error so callers can respond appropriately.
 *
 * Usage:
 *   const result = await withTransaction(async (trx) => {
 *     await repo.create(data, trx);
 *     await auditRepo.insert(event, trx);
 *     return result;
 *   });
 *
 * Every repository method accepts an optional `trx` parameter.
 * Pass `(trx || knex)` as the query builder inside repositories.
 */
export async function withTransaction(fn) {
  const trx = await knex.transaction();
  try {
    const result = await fn(trx);
    await trx.commit();
    return result;
  } catch (err) {
    await trx.rollback();
    throw err;
  }
}
