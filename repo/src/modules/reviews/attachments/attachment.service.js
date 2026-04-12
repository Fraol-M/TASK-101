import { createHash } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { fileTypeFromBuffer } from 'file-type';
import { withTransaction } from '../../../common/db/transaction.js';
import { auditService } from '../../admin/audit/audit.service.js';
import {
  NotFoundError,
  UnprocessableError,
  AuthorizationError,
} from '../../../common/errors/AppError.js';
import { storageConfig } from '../../../config/storage.js';
import { attachmentUploadFailuresTotal } from '../../../common/metrics/metrics.js';
import knex from '../../../common/db/knex.js';

export const attachmentService = {
  /**
   * Upload a file attachment for a review assignment.
   *
   * @param {object} params
   * @param {string} params.assignmentId
   * @param {object} params.file  koa-body file object { filepath, originalFilename, mimetype, size }
   * @param {string} actorId
   * @param {string} requestId
   */
  async upload({ assignmentId, file }, actorId, requestId) {
    // Validate declared MIME type against allow-list
    if (
      storageConfig.allowedMimeTypes.length > 0 &&
      !storageConfig.allowedMimeTypes.includes(file.mimetype)
    ) {
      attachmentUploadFailuresTotal.inc({ reason: 'disallowed_mime' });
      throw new UnprocessableError(`File type ${file.mimetype} is not allowed`);
    }

    // Validate file size (koa-body already enforces maxFileSize, this is belt-and-suspenders)
    if (file.size > storageConfig.maxFileBytes) {
      attachmentUploadFailuresTotal.inc({ reason: 'oversized' });
      throw new UnprocessableError(
        `File exceeds maximum size of ${storageConfig.maxFileBytes} bytes`,
      );
    }

    // Load assignment and check reviewer ownership
    const assignment = await knex('review_assignments').where({ id: assignmentId }).first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    const reviewerProfile = await knex('reviewer_profiles')
      .where({ account_id: actorId })
      .first('id');
    const isAdmin = false; // Enforced upstream by RBAC
    if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
      throw new AuthorizationError('You are not assigned to this review');
    }

    // Optimistic pre-check (no lock) — early exit before reading the file
    const preCount = await knex('review_attachments')
      .where({ assignment_id: assignmentId })
      .count('id as count')
      .first()
      .then((r) => Number(r.count));
    if (preCount >= storageConfig.maxFilesPerReview) {
      throw new UnprocessableError(
        `Maximum of ${storageConfig.maxFilesPerReview} attachments per review`,
      );
    }

    // Compute SHA-256 and verify magic bytes (prevents MIME-type spoofing)
    const fileBuffer = await fs.readFile(file.filepath);
    const detectedType = await fileTypeFromBuffer(fileBuffer);
    if (!detectedType || detectedType.mime !== file.mimetype) {
      attachmentUploadFailuresTotal.inc({ reason: 'magic_byte_mismatch' });
      throw new UnprocessableError(
        `File signature does not match declared type ${file.mimetype}`,
      );
    }
    const contentHash = createHash('sha256').update(fileBuffer).digest('hex');

    // Determine storage path — partitioned by assignment ID to avoid filesystem hotspots
    const ext = storageConfig.mimeToExt[file.mimetype] ?? path.extname(file.originalFilename) ?? '';
    const storagePath = path.join(
      assignmentId.substring(0, 2),
      assignmentId.substring(2, 4),
      `${assignmentId}_${contentHash}${ext}`,
    );
    const absolutePath = path.join(storageConfig.attachmentsRoot, storagePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    // Write file to storage
    await fs.copyFile(file.filepath, absolutePath);
    // Clean up temp file
    await fs.unlink(file.filepath).catch(() => {});

    try {
      return await withTransaction(async (trx) => {
        // Serialize concurrent uploads: lock the assignment row before re-checking the count
        await trx.raw('SELECT id FROM review_assignments WHERE id = ? FOR UPDATE', [assignmentId]);

        // Re-count under the lock to close the TOCTOU race window
        const countNow = await trx('review_attachments')
          .where({ assignment_id: assignmentId })
          .count('id as count')
          .first()
          .then((r) => Number(r.count));
        if (countNow >= storageConfig.maxFilesPerReview) {
          throw new UnprocessableError(
            `Maximum of ${storageConfig.maxFilesPerReview} attachments per review`,
          );
        }

        const [attachment] = await trx('review_attachments')
          .insert({
            assignment_id: assignmentId,
            uploaded_by: actorId,
            original_filename: file.originalFilename,
            storage_path: storagePath,
            mime_type: file.mimetype,
            file_size_bytes: file.size,
            content_hash: contentHash,
            virus_scan_status: 'pending',
          })
          .onConflict(['assignment_id', 'content_hash'])
          .ignore()
          .returning('*');

        if (!attachment) {
          throw new UnprocessableError('This file has already been uploaded for this assignment');
        }

        await auditService.record({
          actorAccountId: actorId,
          actionType: 'attachment.uploaded',
          entityType: 'review_attachment',
          entityId: attachment.id,
          requestId,
          afterSummary: {
            assignmentId,
            filename: file.originalFilename,
            mimeType: file.mimetype,
            sizeBytes: file.size,
          },
        }, trx);

        return attachment;
      });
    } catch (err) {
      // Compensating cleanup: remove the file we copied if the transaction was rejected
      await fs.unlink(absolutePath).catch(() => {});
      throw err;
    }
  },

  async listByAssignment(assignmentId, viewer) {
    const assignment = await knex('review_assignments').where({ id: assignmentId }).first();
    if (!assignment) throw new NotFoundError('Assignment not found');

    const isAdmin =
      viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');
    if (!isAdmin) {
      const reviewerProfile = await knex('reviewer_profiles')
        .where({ account_id: viewer.id })
        .first('id');
      if (!reviewerProfile || assignment.reviewer_id !== reviewerProfile.id) {
        throw new NotFoundError('Assignment not found');
      }
    }

    return knex('review_attachments')
      .where({ assignment_id: assignmentId })
      .select('id', 'original_filename', 'mime_type', 'file_size_bytes', 'virus_scan_status', 'created_at')
      .orderBy('created_at');
  },

  async delete(attachmentId, viewer, requestId) {
    const actorId = viewer.id;
    const attachment = await knex('review_attachments').where({ id: attachmentId }).first();
    if (!attachment) throw new NotFoundError('Attachment not found');

    // Uploader can always delete their own attachment.
    // SYSTEM_ADMIN and PROGRAM_ADMIN can delete any attachment for operational remediation.
    const isAdmin =
      viewer.roles?.includes('SYSTEM_ADMIN') || viewer.roles?.includes('PROGRAM_ADMIN');
    if (attachment.uploaded_by !== actorId && !isAdmin) {
      throw new AuthorizationError('You can only delete your own attachments');
    }

    await withTransaction(async (trx) => {
      await trx('review_attachments').where({ id: attachmentId }).delete();
      await auditService.record({
        actorAccountId: actorId,
        actionType: 'attachment.deleted',
        entityType: 'review_attachment',
        entityId: attachmentId,
        requestId,
        beforeSummary: { filename: attachment.original_filename },
      }, trx);
    });

    // Remove from filesystem (best effort)
    const absolutePath = path.join(storageConfig.attachmentsRoot, attachment.storage_path);
    await fs.unlink(absolutePath).catch(() => {});
  },
};
