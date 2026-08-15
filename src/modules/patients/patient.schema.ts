import { z } from 'zod';
import { csvString, listQueryBase, objectIdSchema } from '../../shared/commonSchemas.js';
import { GENDERS, PATIENT_STATUSES } from './patient.model.js';

const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[+()\-\s\d]+$/, 'Phone may contain only digits, spaces, +, -, and parentheses');

export const createPatientSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  // Optional here because the nested route supplies it from the URL; the service
  // requires one of the two and rejects a mismatch.
  doctorId: objectIdSchema.optional(),
  age: z.coerce.number().int().min(0).max(130).optional(),
  gender: z.enum(GENDERS).optional(),
  condition: z.string().trim().min(2, 'Condition is required').max(160),
  status: z.enum(PATIENT_STATUSES).default('active'),
  admittedAt: z.coerce.date().optional(),
  phone: phoneSchema.optional(),
  email: z.string().trim().toLowerCase().email().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updatePatientSchema = createPatientSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const listPatientsSchema = z
  .object({
    ...listQueryBase,
    doctorId: csvString,
    condition: csvString,
    status: csvString,
    gender: z.enum(GENDERS).optional(),
    ageMin: z.coerce.number().int().min(0).max(130).optional(),
    ageMax: z.coerce.number().int().min(0).max(130).optional(),
    sortBy: z
      .enum(['createdAt', 'updatedAt', 'admittedAt', 'name', 'age', 'doctorName'])
      .default('createdAt'),
    /**
     * "date-wise" is ambiguous — admission date and record-entry date answer
     * different questions, so the caller picks. Defaults to admittedAt, the one a
     * clinician means.
     */
    dateField: z.enum(['admittedAt', 'createdAt', 'updatedAt']).default('admittedAt'),
  })
  .refine((v) => !(v.dateFrom && v.dateTo) || v.dateFrom <= v.dateTo, {
    message: 'dateFrom must be on or before dateTo',
    path: ['dateFrom'],
  })
  .refine((v) => !(v.datePreset && (v.dateFrom || v.dateTo)), {
    message: 'Use either datePreset or dateFrom/dateTo, not both',
    path: ['datePreset'],
  })
  .refine((v) => v.ageMin === undefined || v.ageMax === undefined || v.ageMin <= v.ageMax, {
    message: 'ageMin must be less than or equal to ageMax',
    path: ['ageMin'],
  });

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;
export type ListPatientsQuery = z.infer<typeof listPatientsSchema>;
