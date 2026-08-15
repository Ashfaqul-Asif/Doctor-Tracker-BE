import { Schema, model, type InferSchemaType } from 'mongoose';
import { buildSearchSuffixes } from '../../shared/searchIndex.js';

export const DOCTOR_STATUSES = ['active', 'on-leave', 'inactive'] as const;
export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

/** Fields the substring search covers, and the raw paths used to verify long terms. */
export const DOCTOR_SEARCH_FIELDS = ['name', 'specialization', 'hospital', 'email', 'phone'];

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    specialization: { type: String, required: true, trim: true, maxlength: 120 },
    hospital: { type: String, required: true, trim: true, maxlength: 160 },
    phone: { type: String, required: true, trim: true, maxlength: 32 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },

    status: { type: String, enum: DOCTOR_STATUSES, default: 'active', required: true },

    /**
     * Denormalised counter, maintained transactionally by the patients module.
     * Rendering "patients per doctor" via a per-row $lookup is the classic N+1
     * shape; this makes the doctor list join-free and lets patientCount be sorted
     * and range-filtered from an index.
     */
    patientCount: { type: Number, default: 0, min: 0 },

    /** See shared/searchIndex.ts. select:false keeps it off every API response. */
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
 * Indexes — ESR order (Equality, Sort, Range).
 *
 * Every index leads with `deletedAt` because soft delete makes it an equality
 * predicate on every single query; leading with it means the filter is served by
 * the index rather than post-filtered.
 *
 * Every sort-bearing index terminates in `_id` because buildListQuery always
 * appends `_id` to the sort for a total order (see listQuery.ts). Without the
 * trailing key MongoDB would satisfy the leading fields from the index and then
 * run a blocking in-memory SORT to break ties.
 */
doctorSchema.index({ deletedAt: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ deletedAt: 1, status: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ deletedAt: 1, specialization: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ deletedAt: 1, hospital: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ deletedAt: 1, patientCount: -1, _id: -1 });
doctorSchema.index({ deletedAt: 1, name: 1, _id: 1 });
/** Multikey — backs the substring search. */
doctorSchema.index({ deletedAt: 1, searchSuffixes: 1 });
/**
 * Partial unique index: a soft-deleted doctor's email is freed for reuse, but two
 * live doctors can never collide. Requires `deletedAt` to always exist as null,
 * which the schema default guarantees.
 */
doctorSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

/**
 * Keep the search index in step with the document. Writes go through
 * findById -> set -> save() in the service layer so this hook always sees a
 * complete document; a bare findOneAndUpdate would only see the patch.
 */
doctorSchema.pre('save', function rebuildSearchSuffixes(next) {
  if (
    this.isNew ||
    DOCTOR_SEARCH_FIELDS.some((f) => this.isModified(f))
  ) {
    this.set(
      'searchSuffixes',
      buildSearchSuffixes(DOCTOR_SEARCH_FIELDS.map((f) => this.get(f) as string)),
    );
  }
  next();
});

export type DoctorAttrs = InferSchemaType<typeof doctorSchema>;

export const Doctor = model('Doctor', doctorSchema);

export type DoctorDoc = InstanceType<typeof Doctor>;
