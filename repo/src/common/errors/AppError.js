/**
 * Base application error.
 * All domain errors extend this class.
 * The error handler middleware serialises AppError instances into the standard
 * response envelope: { error: { code, message, details }, meta: { requestId } }
 */
export class AppError extends Error {
  /**
   * @param {string} message  Human-readable message (safe to expose to clients)
   * @param {number} statusCode  HTTP status code
   * @param {string} code  Machine-readable error code (e.g. 'VALIDATION_ERROR')
   * @param {Array}  details  Optional field-level error details
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = []) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — Request body / query / params failed Zod validation */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details = []) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/** 401 — Missing or invalid session token */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/** 403 — Authenticated but insufficient permissions */
export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/** 404 — Entity not found (use generic message to avoid leaking what was not found) */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

/** 409 — Duplicate idempotency key with different body, or publish version conflict */
export class ConflictError extends AppError {
  constructor(message = 'Conflict', details = []) {
    super(message, 409, 'CONFLICT', details);
  }
}

/** 413 — Attachment too large */
export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large') {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
  }
}

/** 415 — Unsupported attachment MIME type */
export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(message, 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

/** 422 — Semantically invalid business rule input (weights don't sum to 100, COI detected, etc.) */
export class UnprocessableError extends AppError {
  constructor(message = 'Unprocessable request', details = []) {
    super(message, 422, 'UNPROCESSABLE', details);
  }
}
