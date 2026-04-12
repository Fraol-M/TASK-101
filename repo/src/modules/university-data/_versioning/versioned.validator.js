import { z } from 'zod';

/**
 * Shared Zod schemas for versioned entity operations.
 */

/**
 * Validate a YYYY-MM-DD string as a real calendar date.
 * new Date('2026-02-30') normalises silently in JS, so we verify by round-tripping
 * through UTC component values — if the normalised result differs from the input,
 * the date is out of range for that month.
 */
function isRealCalendarDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d
  );
}

// MM/DD/YYYY → YYYY-MM-DD conversion and validation
const effectiveDateSchema = z
  .string()
  .regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Date must be MM/DD/YYYY format')
  .transform((s) => {
    const [mm, dd, yyyy] = s.split('/');
    return `${yyyy}-${mm}-${dd}`;
  })
  .refine(isRealCalendarDate, { message: 'Invalid date' })
  .or(
    // Also accept ISO format directly
    z.string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(isRealCalendarDate, { message: 'Invalid date' })
  );

export const publishVersionSchema = z.object({
  effectiveFrom: effectiveDateSchema.optional(),
});

export const createDraftSchema = z.object({
  effectiveFrom: effectiveDateSchema.optional(),
  changeSummary: z.string().max(500).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const versionParamsSchema = z.object({
  stableId: z.string().uuid(),
  versionId: z.string().uuid().optional(),
});

/**
 * Creates a standard "create entity" schema with a required name + optional description.
 */
export function makeCreateEntitySchema(extraFields = {}) {
  return z.object({
    name: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    effectiveFrom: effectiveDateSchema.optional(),
    changeSummary: z.string().max(500).optional(),
    ...extraFields,
  });
}
