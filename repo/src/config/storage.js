import path from 'path';
import { fileURLToPath } from 'url';
import config from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../');

/**
 * Attachment storage configuration.
 * All paths are resolved relative to the repo root unless absolute.
 */
export const storageConfig = Object.freeze({
  attachmentsRoot: path.isAbsolute(config.attachments.storageRoot)
    ? config.attachments.storageRoot
    : path.resolve(repoRoot, config.attachments.storageRoot),
  maxFileBytes: config.attachments.maxFileBytes,
  maxFilesPerReview: config.attachments.maxFilesPerReview,
  allowedMimeTypes: config.attachments.allowedMimeTypes,
  // Map MIME types to canonical file extensions
  mimeToExt: {
    'application/pdf': '.pdf',
    'image/png': '.png',
    'image/jpeg': '.jpg',
  },
});
