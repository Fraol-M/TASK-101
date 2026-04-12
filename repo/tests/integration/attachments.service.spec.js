import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, unlink, access } from 'fs/promises';

/**
 * Integration tests for attachmentService against a real PostgreSQL database.
 *
 * Covers the paths that tests/api/attachments.spec.js cannot reach because it
 * mocks attachmentService entirely:
 *
 * - listByAssignment: reviewer sees their own attachments; a different reviewer
 *   gets 404 (information-safe); SYSTEM_ADMIN sees all attachments.
 * - delete: uploader can delete their own attachment; a different non-admin
 *   account is rejected (403); SYSTEM_ADMIN can delete any attachment.
 * - upload (DB-layer checks): the reviewer-ownership guard fires before the
 *   filesystem is touched, so tests pass a fake file object whose MIME/size
 *   satisfy the allow-list and size checks.  The file-count limit (maxFilesPerReview)
 *   is also verified by pre-seeding the maximum number of stub records.
 *
 * Filesystem interactions in upload/delete are either bypassed (ownership
 * rejection fires first) or handled by the service's .catch(() => {}) guards,
 * so no real files are written or read.
 *
 * Requires a real PostgreSQL test database (graddb_test).
 * Run with: npm run test:integration
 */

const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/NRhE6nJhbZgJkSta2';
const TS = Date.now();

let knex;
let attachmentService;

// Shared fixtures
let cycleId;
let applicationId;
let assignmentId;
let reviewerAccountId;
let reviewerProfileId;
let otherReviewerAccountId;
let otherReviewerProfileId;
let adminAccountId;

const cleanup = {
  attachmentIds: [],
  assignmentIds: [],
  reviewerProfileIds: [],
  applicationIds: [],
  cycleIds: [],
  accountIds: [],
};

async function createAccount(suffix) {
  const [acc] = await knex('accounts')
    .insert({ username: `attach-int-${TS}-${suffix}`, password_hash: DUMMY_HASH })
    .returning('id');
  cleanup.accountIds.push(acc.id);
  return acc;
}

async function seedAttachmentStub(assignmentId, uploadedBy, suffix) {
  const [att] = await knex('review_attachments')
    .insert({
      assignment_id: assignmentId,
      uploaded_by: uploadedBy,
      original_filename: `stub-${suffix}.pdf`,
      storage_path: `00/00/stub-${suffix}.pdf`,
      mime_type: 'application/pdf',
      file_size_bytes: 1024,
      content_hash: `deadbeef${suffix.toString().padStart(56, '0')}`,
      virus_scan_status: 'clean',
    })
    .returning('id');
  cleanup.attachmentIds.push(att.id);
  return att;
}

beforeAll(async () => {
  const { default: k } = await import('../../src/common/db/knex.js');
  knex = k;
  await knex.migrate.latest();
  const mod = await import('../../src/modules/reviews/attachments/attachment.service.js');
  attachmentService = mod.attachmentService;

  // Admin (no reviewer profile)
  const adminAcc = await createAccount('admin');
  adminAccountId = adminAcc.id;

  // Cycle
  const [cycle] = await knex('application_cycles')
    .insert({ name: `Attach Integration ${TS}`, year: 2099, status: 'open' })
    .returning('id');
  cycleId = cycle.id;
  cleanup.cycleIds.push(cycleId);

  // Applicant + application
  const applicantAcc = await createAccount('applicant');
  const [app] = await knex('applications')
    .insert({ cycle_id: cycleId, account_id: applicantAcc.id, status: 'submitted' })
    .returning('id');
  applicationId = app.id;
  cleanup.applicationIds.push(applicationId);

  // Reviewer (owns the assignment)
  const revAcc = await createAccount('reviewer');
  reviewerAccountId = revAcc.id;
  const [revProfile] = await knex('reviewer_profiles')
    .insert({ account_id: reviewerAccountId })
    .returning('id');
  reviewerProfileId = revProfile.id;
  cleanup.reviewerProfileIds.push(reviewerProfileId);

  // Other reviewer (no connection to this assignment)
  const otherAcc = await createAccount('other-reviewer');
  otherReviewerAccountId = otherAcc.id;
  const [otherProfile] = await knex('reviewer_profiles')
    .insert({ account_id: otherReviewerAccountId })
    .returning('id');
  otherReviewerProfileId = otherProfile.id;
  cleanup.reviewerProfileIds.push(otherReviewerProfileId);

  // Assignment owned by reviewer
  const [assignment] = await knex('review_assignments')
    .insert({
      application_id: applicationId,
      reviewer_id: reviewerProfileId,
      cycle_id: cycleId,
      assignment_mode: 'manual',
      blind_mode: 'blind',
      assigned_by: adminAccountId,
    })
    .returning('id');
  assignmentId = assignment.id;
  cleanup.assignmentIds.push(assignmentId);
});

afterAll(async () => {
  if (cleanup.attachmentIds.length) {
    await knex('review_attachments').whereIn('id', cleanup.attachmentIds).delete();
  }
  if (cleanup.assignmentIds.length) {
    await knex('review_assignments').whereIn('id', cleanup.assignmentIds).delete();
  }
  if (cleanup.reviewerProfileIds.length) {
    await knex('reviewer_profiles').whereIn('id', cleanup.reviewerProfileIds).delete();
  }
  if (cleanup.applicationIds.length) {
    await knex('applications').whereIn('id', cleanup.applicationIds).delete();
  }
  if (cleanup.cycleIds.length) {
    await knex('application_cycles').whereIn('id', cleanup.cycleIds).delete();
  }
  if (cleanup.accountIds.length) {
    await knex('accounts').whereIn('id', cleanup.accountIds).delete();
  }
  await knex.destroy();
});

// ── listByAssignment ──────────────────────────────────────────────────────────

describe('attachmentService.listByAssignment', () => {
  it('returns the attachment list for the assigned reviewer', async () => {
    const att = await seedAttachmentStub(assignmentId, reviewerAccountId, 'list1');

    const result = await attachmentService.listByAssignment(assignmentId, {
      id: reviewerAccountId,
      roles: [],
    });

    expect(result.some((r) => r.id === att.id)).toBe(true);
  });

  it('returns 404 when a different non-admin reviewer requests the attachment list', async () => {
    // Uses information-safe 404 to avoid revealing the assignment exists
    await expect(
      attachmentService.listByAssignment(assignmentId, {
        id: otherReviewerAccountId,
        roles: [],
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('allows SYSTEM_ADMIN to list attachments for any assignment', async () => {
    const result = await attachmentService.listByAssignment(assignmentId, {
      id: adminAccountId,
      roles: ['SYSTEM_ADMIN'],
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it('allows PROGRAM_ADMIN to list attachments for any assignment', async () => {
    const result = await attachmentService.listByAssignment(assignmentId, {
      id: adminAccountId,
      roles: ['PROGRAM_ADMIN'],
    });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── delete ────────────────────────────────────────────────────────────────────

describe('attachmentService.delete', () => {
  it('allows the uploader to delete their own attachment', async () => {
    const att = await seedAttachmentStub(assignmentId, reviewerAccountId, 'del1');

    await attachmentService.delete(att.id, { id: reviewerAccountId, roles: [] }, `req-del-${TS}`);

    const row = await knex('review_attachments').where({ id: att.id }).first();
    expect(row).toBeUndefined();

    // Remove from cleanup since it's already deleted
    const idx = cleanup.attachmentIds.indexOf(att.id);
    if (idx !== -1) cleanup.attachmentIds.splice(idx, 1);
  });

  it('throws AuthorizationError (403) when a different non-admin account tries to delete', async () => {
    const att = await seedAttachmentStub(assignmentId, reviewerAccountId, 'del2');

    await expect(
      attachmentService.delete(att.id, { id: otherReviewerAccountId, roles: [] }, `req-del-bad-${TS}`),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Attachment must still exist
    const row = await knex('review_attachments').where({ id: att.id }).first();
    expect(row).toBeDefined();
  });

  it('allows SYSTEM_ADMIN to delete any attachment', async () => {
    const att = await seedAttachmentStub(assignmentId, reviewerAccountId, 'del3');

    await attachmentService.delete(att.id, { id: adminAccountId, roles: ['SYSTEM_ADMIN'] }, `req-del-admin-${TS}`);

    const row = await knex('review_attachments').where({ id: att.id }).first();
    expect(row).toBeUndefined();

    const idx = cleanup.attachmentIds.indexOf(att.id);
    if (idx !== -1) cleanup.attachmentIds.splice(idx, 1);
  });

  it('allows PROGRAM_ADMIN to delete any attachment', async () => {
    const att = await seedAttachmentStub(assignmentId, reviewerAccountId, 'del4');

    await attachmentService.delete(att.id, { id: adminAccountId, roles: ['PROGRAM_ADMIN'] }, `req-del-prog-admin-${TS}`);

    const row = await knex('review_attachments').where({ id: att.id }).first();
    expect(row).toBeUndefined();

    const idx = cleanup.attachmentIds.indexOf(att.id);
    if (idx !== -1) cleanup.attachmentIds.splice(idx, 1);
  });
});

// ── upload (DB-layer guards, no real file I/O needed) ─────────────────────────

describe('attachmentService.upload — DB-layer guard checks', () => {
  // A fake file object that passes MIME allow-list (empty = allow all) and size
  // checks, so the service reaches the DB-layer ownership and count guards.
  const fakeFile = {
    filepath: '/nonexistent/fake-test-file.pdf',
    originalFilename: 'test.pdf',
    mimetype: 'application/pdf',
    size: 1024,
  };

  it('throws AuthorizationError (403) when the uploader is not the assigned reviewer', async () => {
    // otherReviewerAccountId has a reviewer_profile but is NOT assigned to this assignment
    await expect(
      attachmentService.upload(
        { assignmentId, file: fakeFile },
        otherReviewerAccountId,
        `req-upload-wrong-rev-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws NotFoundError (404) when the assignment does not exist', async () => {
    const nonExistentId = '00000000-0000-0000-0000-000000000000';
    await expect(
      attachmentService.upload(
        { assignmentId: nonExistentId, file: fakeFile },
        reviewerAccountId,
        `req-upload-no-assign-${TS}`,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws UnprocessableError (422) when the per-review attachment limit is reached', async () => {
    // Seed exactly maxFilesPerReview (5) stub records so the count guard fires
    // before any filesystem access.
    const MAX = 5; // matches ATTACHMENT_MAX_FILES_PER_REVIEW default
    const seeded = [];
    for (let i = 0; i < MAX; i++) {
      const att = await seedAttachmentStub(assignmentId, reviewerAccountId, `cap${i}`);
      seeded.push(att.id);
    }

    try {
      await expect(
        attachmentService.upload(
          { assignmentId, file: fakeFile },
          reviewerAccountId,
          `req-upload-limit-${TS}`,
        ),
      ).rejects.toMatchObject({ statusCode: 422 });
    } finally {
      // Remove the seeded stubs so they don't affect other tests
      await knex('review_attachments').whereIn('id', seeded).delete();
      for (const id of seeded) {
        const idx = cleanup.attachmentIds.indexOf(id);
        if (idx !== -1) cleanup.attachmentIds.splice(idx, 1);
      }
    }
  });

  it('successfully uploads a valid PNG file (full read/hash/write path)', async () => {
    // Minimal valid PNG: 8-byte magic + IHDR chunk header (enough for fileTypeFromBuffer)
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = Buffer.from([
      0x00, 0x00, 0x00, 0x0D, // chunk length = 13
      0x49, 0x48, 0x44, 0x52, // 'IHDR'
      0x00, 0x00, 0x00, 0x01, // width = 1
      0x00, 0x00, 0x00, 0x01, // height = 1
      0x08, 0x02,             // bit depth 8, color type RGB
      0x00, 0x00, 0x00,       // compression, filter, interlace
      0x90, 0x77, 0x53, 0xDE, // CRC (arbitrary — file type detection only needs magic + IHDR tag)
    ]);
    const pngBuffer = Buffer.concat([pngMagic, ihdr]);

    const tmpPath = join(tmpdir(), `test-upload-${TS}.png`);
    await writeFile(tmpPath, pngBuffer);

    const realFile = {
      filepath: tmpPath,
      originalFilename: `test-${TS}.png`,
      mimetype: 'image/png',
      size: pngBuffer.length,
    };

    let storagePath;
    try {
      const attachment = await attachmentService.upload(
        { assignmentId, file: realFile },
        reviewerAccountId,
        `req-upload-happy-${TS}`,
      );

      cleanup.attachmentIds.push(attachment.id);
      storagePath = attachment.storage_path;

      expect(attachment.assignment_id).toBe(assignmentId);
      expect(attachment.mime_type).toBe('image/png');
      expect(attachment.original_filename).toBe(`test-${TS}.png`);
      expect(attachment.content_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(attachment.virus_scan_status).toBe('pending');
      expect(Number(attachment.file_size_bytes)).toBe(pngBuffer.length);
    } finally {
      await unlink(tmpPath).catch(() => {});
      if (storagePath) {
        const { storageConfig } = await import('../../src/config/storage.js');
        await unlink(join(storageConfig.attachmentsRoot, storagePath)).catch(() => {});
      }
    }
  });
});
