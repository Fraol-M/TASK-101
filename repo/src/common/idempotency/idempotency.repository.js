import knex from '../db/knex.js';

/**
 * Idempotency key repository.
 * Stores request fingerprints and cached responses to prevent duplicate submissions.
 */
export const idempotencyRepository = {
  /**
   * Look up an existing idempotency record for this account + key.
   * @param {string} accountId
   * @param {string} key  Client-supplied Idempotency-Key header value
   * @param {object} [trx]
   * @returns {object|undefined}
   */
  async findByAccountAndKey(accountId, key, trx) {
    return (trx || knex)('idempotency_keys')
      .where({ account_id: accountId, key })
      .where('expires_at', '>', knex.fn.now())
      .first();
  },

  /**
   * Atomically reserve a new idempotency slot before executing the handler.
   * Uses INSERT … ON CONFLICT DO NOTHING so only one concurrent request wins the slot.
   * response_status = 0 is the "pending" sentinel (no real HTTP status is 0).
   *
   * @param {string} accountId
   * @param {string} key
   * @param {string} requestFingerprint
   * @returns {boolean} true if the slot was reserved by this call, false if already existed
   */
  async reserve(accountId, key, requestFingerprint) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const rows = await knex('idempotency_keys')
      .insert({
        account_id: accountId,
        key,
        request_fingerprint: requestFingerprint,
        response_status: 0, // pending sentinel
        response_body: JSON.stringify({}),
        expires_at: expiresAt,
      })
      .onConflict(['account_id', 'key'])
      .ignore()
      .returning('id');
    return rows.length > 0;
  },

  /**
   * Transition a pending slot to completed by writing the real response.
   * Only updates rows still in pending state (response_status = 0) to avoid
   * overwriting a legitimate cached response on retry.
   *
   * @param {string} accountId
   * @param {string} key
   * @param {number} responseStatus
   * @param {object} responseBody
   */
  async complete(accountId, key, responseStatus, responseBody) {
    return knex('idempotency_keys')
      .where({ account_id: accountId, key, response_status: 0 })
      .update({
        response_status: responseStatus,
        response_body: JSON.stringify(responseBody),
      });
  },

  /**
   * Remove a pending slot when the handler fails.
   * Only deletes rows still in pending state so a successful record is never removed.
   *
   * @param {string} accountId
   * @param {string} key
   */
  async deletePending(accountId, key) {
    return knex('idempotency_keys')
      .where({ account_id: accountId, key, response_status: 0 })
      .delete();
  },

  /**
   * Store a completed response for future deduplication.
   * @param {object} record
   * @param {object} [trx]
   */
  async insert(record, trx) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return (trx || knex)('idempotency_keys').insert({
      account_id: record.accountId,
      key: record.key,
      request_fingerprint: record.requestFingerprint,
      response_status: record.responseStatus,
      response_body: JSON.stringify(record.responseBody),
      expires_at: expiresAt,
    });
  },

  /**
   * Delete expired idempotency records. Called by purge-history script.
   */
  async deleteExpired(trx) {
    return (trx || knex)('idempotency_keys')
      .where('expires_at', '<', knex.fn.now())
      .delete();
  },
};
