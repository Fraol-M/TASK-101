import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import config from '../../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV for GCM
const TAG_BYTES = 16;  // 128-bit authentication tag

/**
 * Encrypts a UTF-8 string value using AES-256-GCM.
 * Returns a base64-encoded string in the format: iv:ciphertext:tag
 * Suitable for storing in a TEXT column.
 *
 * @param {string} plaintext
 * @returns {string}  Encrypted value
 */
export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const key = Buffer.from(config.localEncryptionKey, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv) : base64(ciphertext) : base64(tag)
  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

/**
 * Decrypts a value previously encrypted with encrypt().
 * @param {string} encryptedValue
 * @returns {string}  Plaintext
 */
export function decrypt(encryptedValue) {
  if (encryptedValue == null) return null;
  const key = Buffer.from(config.localEncryptionKey, 'hex');
  const [ivB64, dataB64, tagB64] = encryptedValue.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Returns a masked representation for use in audit views.
 * Shows first 2 and last 2 characters; middle is replaced with ***
 * @param {string} plaintext
 * @returns {string}
 */
export function maskField(plaintext) {
  if (!plaintext || plaintext.length <= 4) return '***';
  return `${plaintext.slice(0, 2)}***${plaintext.slice(-2)}`;
}
