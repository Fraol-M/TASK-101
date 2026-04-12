import { randomBytes, createHash } from 'crypto';

/**
 * Generates a cryptographically random opaque session token.
 * Returns a 64-character hex string (256 bits of entropy).
 * Never use UUID for session tokens — insufficient entropy.
 */
export function generateOpaqueToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Hashes a raw token with SHA-256 for database storage.
 * The raw token is never stored; only the hash.
 * @param {string} rawToken  The 64-char hex token returned by generateOpaqueToken()
 * @returns {Buffer}  32-byte Buffer (suitable for BYTEA column)
 */
export function hashToken(rawToken) {
  return createHash('sha256').update(rawToken, 'utf8').digest();
}

/**
 * Computes SHA-256 of a Buffer or string.
 * Used for attachment fingerprinting and idempotency key fingerprinting.
 * @param {Buffer|string} data
 * @returns {string}  64-char hex digest
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Recursively sorts all object keys so that JSON serialisation is canonical.
 * Arrays preserve order; object keys are sorted alphabetically.
 */
function deepSortKeys(value) {
  if (Array.isArray(value)) return value.map(deepSortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((k) => [k, deepSortKeys(value[k])]),
    );
  }
  return value;
}

/**
 * Generates a request fingerprint for idempotency key deduplication.
 * Canonical form: deep-sorted JSON of { method, path, body } ensures that
 * two requests with the same semantics always produce the same fingerprint,
 * and that different methods/paths/bodies never collide.
 *
 * @param {string} method  HTTP method (normalised to uppercase)
 * @param {string} path    Request path
 * @param {object} body    Request body object
 * @returns {string}  64-char hex digest
 */
export function requestFingerprint(method, path, body) {
  const canonical = deepSortKeys({ method: method.toUpperCase(), path, body: body ?? null });
  return sha256Hex(JSON.stringify(canonical));
}
