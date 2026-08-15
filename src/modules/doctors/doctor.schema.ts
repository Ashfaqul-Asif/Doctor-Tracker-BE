import { z } from 'zod';
import { csvString, listQueryBase } from '../../shared/commonSchemas.js';
import { DOCTOR_STATUSES } from './doctor.model.js';

/** Permissive by design: E.164, local formats, spaces, dashes and parentheses. */
const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Phone number is too short')
  .max(32)
  .regex(/^[+()\-\s\d]+$/, 'Phone may contain only digits, spaces, +, -, and parentheses');

export const createDoctorSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  specialization: z.string().trim().min(2).max(120),
  hospital: z.string().trim().min(2).max(160),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email('Must be a valid email address').max(160),
  status: z.enum(DOCTOR_STATUSES).default('active'),
});

/**
 * Partial update. `.strict()` rejects unknown keys outright rather than ignoring
 * them, so a client typo surfaces as 422 instead of a silently dropped field —
 * and a `patientCount` or `deletedAt` in the body can never reach the document.
 */
export const updateDoctorSchema = createDoctorSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const listDoctorsSchema = z
  .object({
    ...listQueryBase,
    specialization: csvString,
    hospital: csvString,
    status: csvString,
    minPatients: z.coerce.number().int().min(0).optional(),
    maxPatients: z.coerce.number().int().min(0).optional(),
    hasPatients: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'patientCount', 'specialization']).default('createdAt'),
    dateField: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  })
  .refine((v) => !(v.dateFrom && v.dateTo) || v.dateFrom <= v.dateTo, {
    message: 'dateFrom must be on or before dateTo',
    path: ['dateFrom'],
  })
  .refine((v) => !(v.datePreset && (v.dateFrom || v.dateTo)), {
    message: 'Use either datePreset or dateFrom/dateTo, not both',
    path: ['datePreset'],
  })
  .refine(
    (v) => v.minPatients === undefined || v.maxPatients === undefined || v.minPatients <= v.maxPatients,
    { message: 'minPatients must be less than or equal to maxPatients', path: ['minPatients'] },
  );

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type ListDoctorsQuery = z.infer<typeof listDoctorsSchema>;
