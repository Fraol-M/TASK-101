/**
 * Review aggregation and assignment policy configuration.
 * Centralises all configurable thresholds used by the aggregation and
 * assignment services.
 */
import config from './env.js';

export const reviewPolicies = Object.freeze({
  aggregation: {
    trimEnabled: config.review.trimEnabled,
    trimPercent: config.review.trimPercent,
    trimMinCount: config.review.trimMinCount,
    varianceThreshold: config.review.varianceThreshold,
    secondPassRequiredReviewerCount: 2,
  },
  assignment: {
    // Years to look back for institution COI check
    coiInstitutionWindowYears: 5,
    // Minimum reviewers required per application
    minReviewersPerApplication: 2,
  },
  scoring: {
    minScore: 0,
    maxScore: 10,
    scoreStep: 0.5,
    maxAttachmentsPerReview: config.attachments.maxFilesPerReview,
    maxAttachmentBytes: config.attachments.maxFileBytes,
    allowedMimeTypes: config.attachments.allowedMimeTypes,
  },
});
