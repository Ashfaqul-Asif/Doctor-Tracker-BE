import { Schema, model, Types, type InferSchemaType } from 'mongoose';
import { buildSearchSuffixes } from '../../shared/searchIndex.js';

export const PATIENT_STATUSES = ['active', 'under-observation', 'recovered', 'discharged'] as const;
export type PatientStatus = (typeof PATIENT_STATUSES)[number];

export const GENDERS = ['male', 'female', 'other'] as const;

/**
 * Includes the denormalised doctorName, so a patient can be found by their treating
 * doctor's name without a $lookup on the search path.
 */
export const PATIENT_SEARCH_FIELDS = ['name', 'condition', 'phone', 'email', 'doctorName'];

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },

    doctorId: { type: Types.ObjectId, ref: 'Doctor', required: true },
    /**
     * Denormalised from Doctor.name. The patient table shows the doctor's name, so
     * without this every page costs a populate round trip. Kept in step by
     * doctor.service.updateDoctor inside a transaction.
     */
    doctorName: { type: String, required: true, trim: true, maxlength: 120 },

    age: { type: Number, min: 0, max: 130 },
    gender: { type: String, enum: GENDERS },
    condition: { type: String, required: true, trim: true, maxlength: 160 },
    status: { type: String, enum: PATIENT_STATUSES, default: 'active', required: true },

    admittedAt: { type: Date, default: () => new Date(), required: true },

    phone: { type: String, trim: true, maxlength: 32 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    notes: { type: String, trim: true, maxlength: 2000 },

    searchSuffixes: { type: [String], default: [], select: false },

    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.searchSuffixes;
        return ret;
      },
    },
  },
);

/**
 * Indexes — ESR order, every one leading with `deletedAt` and every sort-bearing
 * one terminating in `_id` (see doctor.model.ts for the reasoning).
 */
patientSchema.index({ deletedAt: 1, createdAt: -1, _id: -1 });
/** The hottest path: a doctor's patient list. */
patientSchema.index({ deletedAt: 1, doctorId: 1, admittedAt: -1, _id: -1 });
patientSchema.index({ deletedAt: 1, doctorId: 1, createdAt: -1, _id: -1 });
patientSchema.index({ deletedAt: 1, condition: 1, createdAt: -1, _id: -1 });
patientSchema.index({ deletedAt: 1, status: 1, createdAt: -1, _id: -1 });
/** Date-wise filtering and the analytics time series. */
patientSchema.index({ deletedAt: 1, admittedAt: -1, _id: -1 });
patientSchema.index({ deletedAt: 1, age: 1 });
/** Multikey — backs the substring search. */
patientSchema.index({ deletedAt: 1, searchSuffixes: 1 });

/**
 * NOT indexed, deliberately: `gender`. Three values over N documents is roughly 33%
 * selectivity — the planner would reject the index in favour of a scan anyway, and
 * it would still cost write throughput. It rides along as a post-filter on a more
 * selective index.
 */

patientSchema.pre('save', function rebuildSearchSuffixes(next) {
  if (this.isNew || PATIENT_SEARCH_FIELDS.some((f) => this.isModified(f))) {
    this.set(
      'searchSuffixes',
      buildSearchSuffixes(PATIENT_SEARCH_FIELDS.map((f) => this.get(f) as string)),
    );
  }
  next();
});

export type PatientAttrs = InferSchemaType<typeof patientSchema>;

export const Patient = model('Patient', patientSchema);

export type PatientDoc = InstanceType<typeof Patient>;
