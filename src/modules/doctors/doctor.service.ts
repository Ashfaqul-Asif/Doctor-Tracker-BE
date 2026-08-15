import type { FilterQuery } from 'mongoose';
import { ApiError } from '../../shared/ApiError.js';
import { buildListQuery } from '../../shared/listQuery.js';
import { countFor } from '../../shared/pagination.js';
import { withTransaction } from '../../shared/withTransaction.js';
import { cached, cacheInvalidatePrefix } from '../../shared/cache.js';
import { buildSearchSuffixes } from '../../shared/searchIndex.js';
import { toApiList } from '../../shared/serialize.js';
import { Doctor, DOCTOR_SEARCH_FIELDS, type DoctorAttrs, type DoctorDoc } from './doctor.model.js';
import { Patient } from '../patients/patient.model.js';
import type { CreateDoctorInput, ListDoctorsQuery, UpdateDoctorInput } from './doctor.schema.js';

const LIST_PROJECTION =
  'name specialization hospital phone email status patientCount createdAt updatedAt deletedAt';

const listConfig = {
  inFields: ['specialization', 'hospital', 'status'],
  rangeFields: { patientCount: ['minPatients', 'maxPatients'] as [string, string] },
  sortable: ['createdAt', 'updatedAt', 'name', 'patientCount', 'specialization'],
  dateFields: ['createdAt', 'updatedAt'],
  searchRawFields: DOCTOR_SEARCH_FIELDS,
};

export async function listDoctors(query: ListDoctorsQuery) {
  const { filter, sort, pagination } = buildListQuery<DoctorAttrs>(listConfig, query);

  // hasPatients is a one-click shortcut over the same indexed patientCount range.
  if (query.hasPatients !== undefined) {
    const existing = (filter.patientCount as Record<string, number>) ?? {};
    filter.patientCount = query.hasPatients ? { ...existing, $gte: 1 } : { ...existing, $lte: 0 };
  }

  const [items, total] = await Promise.all([
    Doctor.find(filter)
      .select(LIST_PROJECTION)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    countFor(Doctor, filter),
  ]);

  // .lean() skips the toJSON transform, so normalise _id -> id here or the list
  // and single-document endpoints would disagree on the response shape.
  return { items: toApiList(items), total, page: pagination.page, limit: pagination.limit };
}

export async function getDoctor(id: string): Promise<DoctorDoc> {
  const doctor = await Doctor.findOne({ _id: id });
  if (!doctor) throw ApiError.notFound('Doctor');
  return doctor;
}

export async function createDoctor(input: CreateDoctorInput): Promise<DoctorDoc> {
  // Explicit check so a collision returns a helpful message; the partial unique
  // index is still the real guarantee under concurrency (errorHandler maps 11000).
  const clash = await Doctor.findOne({ email: input.email, deletedAt: null }).lean();
  if (clash) throw ApiError.conflict('A doctor with this email already exists');

  const doctor = await Doctor.create(input);
  cacheInvalidatePrefix('doctor:facets');
  return doctor;
}

export async function updateDoctor(id: string, input: UpdateDoctorInput): Promise<DoctorDoc> {
  const doctor = await getDoctor(id);

  if (input.email && input.email !== doctor.email) {
    const clash = await Doctor.findOne({
      email: input.email,
      deletedAt: null,
      _id: { $ne: doctor._id },
    }).lean();
    if (clash) throw ApiError.conflict('A doctor with this email already exists');
  }

  const nameChanged = input.name !== undefined && input.name !== doctor.name;

  // set() + save() rather than findOneAndUpdate, so the pre('save') hook sees a
  // complete document and can rebuild searchSuffixes correctly.
  doctor.set(input);

  if (!nameChanged) {
    await doctor.save();
    cacheInvalidatePrefix('doctor:facets');
    return doctor;
  }

  /**
   * A rename must fan out to the denormalised Patient.doctorName, and each of those
   * patients needs its own searchSuffixes rebuilt (the doctor's name is searchable
   * from the patient list). Renames are rare; patient-list reads are constant — the
   * trade is deliberate, and it runs in a transaction so the two can never diverge.
   */
  await withTransaction(async (session) => {
    await doctor.save({ session });

    const patients = await Patient.find({ doctorId: doctor._id })
      .select('name condition phone email doctorName')
      .session(session);

    for (const patient of patients) {
      patient.set('doctorName', doctor.name);
      patient.set(
        'searchSuffixes',
        buildSearchSuffixes([
          patient.get('name'),
          patient.get('condition'),
          patient.get('phone'),
          patient.get('email'),
          doctor.name,
        ]),
      );
      await patient.save({ session });
    }
  });

  cacheInvalidatePrefix('doctor:facets');
  cacheInvalidatePrefix('patient:facets');
  return doctor;
}

/**
 * Soft delete, cascading to the doctor's patients in one transaction.
 *
 * The updateOne matched-count check makes a double delete safe: the second call
 * matches nothing (deletedAt is no longer null) and returns 404 rather than
 * re-stamping a new timestamp and breaking restore's grouping.
 */
export async function softDeleteDoctor(id: string) {
  return withTransaction(async (session) => {
    const deletedAt = new Date();

    const result = await Doctor.updateOne(
      { _id: id, deletedAt: null },
      { $set: { deletedAt } },
      { session },
    );
    if (result.matchedCount === 0) throw ApiError.notFound('Doctor');

    const cascade = await Patient.updateMany(
      { doctorId: id, deletedAt: null },
      { $set: { deletedAt } },
      { session },
    );

    cacheInvalidatePrefix('doctor:facets');
    cacheInvalidatePrefix('patient:facets');
    return { id, deletedAt, cascadedPatients: cascade.modifiedCount };
  });
}

/**
 * Restore, undoing exactly what the delete did.
 *
 * Patients are matched on the doctor's own deletedAt timestamp, so patients that
 * were archived separately *before* the doctor was deleted stay archived.
 */
export async function restoreDoctor(id: string) {
  return withTransaction(async (session) => {
    const doctor = await Doctor.findById(id).session(session);
    if (!doctor) throw ApiError.notFound('Doctor');
    if (!doctor.deletedAt) throw ApiError.conflict('Doctor is not archived');

    const cascadeStamp = doctor.deletedAt;

    const clash = await Doctor.findOne({
      email: doctor.email,
      deletedAt: null,
      _id: { $ne: doctor._id },
    })
      .session(session)
      .lean();
    if (clash) {
      throw ApiError.conflict(
        'Another live doctor now uses this email — change it before restoring',
      );
    }

    doctor.set('deletedAt', null);
    await doctor.save({ session });

    const restored = await Patient.updateMany(
      { doctorId: id, deletedAt: cascadeStamp },
      { $set: { deletedAt: null } },
      { session },
    );

    cacheInvalidatePrefix('doctor:facets');
    cacheInvalidatePrefix('patient:facets');
    return { id, restoredPatients: restored.modifiedCount };
  });
}

/** Lightweight id+name list, so a client dropdown never pulls the full records. */
export async function doctorOptions(limit = 500) {
  const docs = await Doctor.find({ deletedAt: null })
    .select('name specialization')
    .sort({ name: 1, _id: 1 })
    .limit(limit)
    .lean();
  return toApiList(docs);
}

/** Distinct values powering the filter dropdowns. Cached — it changes rarely. */
export async function doctorFacets() {
  return cached('doctor:facets:all', 60_000, async () => {
    const base: FilterQuery<DoctorAttrs> = { deletedAt: null };
    const [specializations, hospitals, statusCounts] = await Promise.all([
      Doctor.distinct('specialization', base),
      Doctor.distinct('hospital', base),
      Doctor.aggregate<{ _id: string; count: number }>([
        { $match: base },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      specializations: specializations.filter(Boolean).sort(),
      hospitals: hospitals.filter(Boolean).sort(),
      statuses: statusCounts.map((s) => ({ value: s._id, count: s.count })),
    };
  });
}
