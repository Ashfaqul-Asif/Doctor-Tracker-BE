import { z } from 'zod';
import { env } from '../config/env.js';
import { DATE_PRESETS, type DatePreset } from './dateRange.js';
import { MIN_QUERY_LEN } from './searchIndex.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from './pagination.js';

/** 24-char hex ObjectId. Rejecting early gives 422 with a field name instead of a CastError. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid 24-character id');

export const idParamSchema = z.object({ id: objectIdSchema });

const supportedTimeZones = new Set(Intl.supportedValuesOf('timeZone'));

/**
 * Query fragments shared by every list endpoint. Coercion here is what stops NoSQL
 * injection: `?page[$ne]=1` arrives as an object and fails, never reaching Mongoose.
 */
export const listQueryBase = {
  search: z.string().trim().min(MIN_QUERY_LEN, `Search term must be at least ${MIN_QUERY_LEN} characters`).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),

  dateFrom: z.string().trim().min(1).optional(),
  dateTo: z.string().trim().min(1).optional(),
  // Cast preserves the literal union — a bare `[string, ...string[]]` would widen
  // datePreset to `string` and break assignment to DatePreset downstream.
  datePreset: z.enum([...DATE_PRESETS] as [DatePreset, ...DatePreset[]]).optional(),
  timezone: z
    .string()
    .optional()
    .transform((tz) => tz || env.DEFAULT_TIMEZONE)
    .refine((tz) => supportedTimeZones.has(tz), 'Must be a valid IANA timezone'),

  includeDeleted: z.enum(['false', 'true', 'only']).default('false'),
};

/** Comma-separated multi-select, e.g. `condition=Diabetes,Asthma`. */
export const csvString = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .optional()
  .transform((v) =>
    v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
  );

/**
 * Cross-field checks. Without these an incoherent combination silently returns an
 * empty page, which reads as "no data" rather than "your filter is contradictory".
 */
export function refineRanges<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (v: Record<string, unknown>) =>
        !(v.dateFrom && v.dateTo) || String(v.dateFrom) <= String(v.dateTo),
      { message: 'dateFrom must be on or before dateTo', path: ['dateFrom'] },
    )
    .refine((v: Record<string, unknown>) => !(v.datePreset && (v.dateFrom || v.dateTo)), {
      message: 'Use either datePreset or dateFrom/dateTo, not both',
      path: ['datePreset'],
    });
}
