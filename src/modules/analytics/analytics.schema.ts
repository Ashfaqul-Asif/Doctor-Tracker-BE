import { z } from 'zod';
import { env } from '../../config/env.js';

const supportedTimeZones = new Set(Intl.supportedValuesOf('timeZone'));

const timezone = z
  .string()
  .optional()
  .transform((tz) => tz || env.DEFAULT_TIMEZONE)
  .refine((tz) => supportedTimeZones.has(tz), 'Must be a valid IANA timezone');

export const dashboardSchema = z.object({
  granularity: z.enum(['day', 'week', 'month']).default('month'),
  months: z.coerce.number().int().min(1).max(36).default(12),
  timezone,
});

export const timeseriesSchema = z
  .object({
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    from: z.string().trim().optional(),
    to: z.string().trim().optional(),
    months: z.coerce.number().int().min(1).max(36).default(6),
    timezone,
  })
  .refine((v) => !(v.from && v.to) || v.from <= v.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export const perDoctorSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  // `asc` surfaces the idle doctors — same index, read from the other end.
  sort: z.enum(['asc', 'desc']).default('desc'),
});

export type DashboardQuery = z.infer<typeof dashboardSchema>;
export type TimeseriesQuery = z.infer<typeof timeseriesSchema>;
export type PerDoctorQuery = z.infer<typeof perDoctorSchema>;
