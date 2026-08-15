import type { ClientSession } from 'mongoose';
import { ApiError } from '../../shared/ApiError.js';
import { buildListQuery } from '../../shared/listQuery.js';
import { countFor } from '../../shared/pagination.js';
import { withTransaction } from '../../shared/withTransaction.js';
import { cached, cacheInvalidatePrefix } from '../../shared/cache.js';
import { toApiList } from '../../shared/serialize.js';
import { Doctor } from '../doctors/doctor.model.js';
import {
  Patient,
  PATIENT_SEARCH_FIELDS,
  type PatientAttrs,
  type PatientDoc,
} from './patient.model.js';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.schema.js';

const LIST_PROJECTION =
  'name doctorId doctorName age gender condition status admittedAt phone email createdAt updatedAt deletedAt';

const listConfig = {
  inFields: ['doctorId', 'condition', 'status', 'gender'],
  rangeFields: { age: ['ageMin', 'ageMax'] as [string, string] },
  sortable: ['createdAt', 'updatedAt', 'admittedAt', 'name', 'age', 'doctorName'],
  dateFields: ['admittedAt', 'createdAt', 'updatedAt'],
  searchRawFields: PATIENT_SEARCH_FIELDS,
};

/**
 * One implementation serves both `GET /patients` and `GET /doctors/:id/patients` —
 * the nested route just pins doctorId, so the two can never drift in behaviour.
 */
export async function listPatients(query: ListPatientsQuery, pinnedDoctorId?: string) {
  const { filter, sort, pagination } = buildListQuery<PatientAttrs>(listConfig, query);

  if (pinnedDoctorId) filter.doctorId = pinnedDoctorId;

  const [items, total] = await Promise.all([
    Patient.find(filter)
      .select(LIST_PROJECTION)
      .sort(sort)
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    countFor(Patient, filter),
  ]);

  // See doctor.service.listDoctors — .lean() skips the toJSON transform.
  return { items: toApiList(items), total, page: pagination.page, limit: pagination.limit };
}

export async function getPatient(id: string): Promise<PatientDoc> {
  const patient = await Patient.findOne({ _id: id });
  if (!patient) throw ApiError.notFound('Patient');
  return patient;
}

/** A patient may only ever be attached to a live doctor. */
async function requireLiveDoctor(doctorId: string, session?: ClientSession) {
  const q = Doctor.findOne({ _id: doctorId, deletedAt: null }).select('name');
  const doctor = await (session ? q.session(session) : q);
  if (!doctor) {
    throw ApiError.unprocessable('Doctor not found or archived', [
      { path: 'doctorId', message: 'Must reference a live doctor' },
    ]);
  }
  return doctor;
}

export async function createPatient(
  input: CreatePatientInput,
  pinnedDoctorId?: string,
): Promise<PatientDoc> {
  const doctorId = pinnedDoctorId ?? input.doctorId;
  if (!doctorId) {
    throw ApiError.unprocessable('doctorId is required', [
      { path: 'doctorId', message: 'Required' },
    ]);
  }
  // On the nested route, a body doctorId that disagrees with the URL is a client
  // bug — silently preferring one would attach the patient to the wrong doctor.
  if (pinnedDoctorId && input.doctorId && input.doctorId !== pinnedDoctorId) {
    throw ApiError.unprocessable('doctorId in body does not match the URL', [
      { path: 'doctorId', message: 'Must match the doctor in the path' },
    ]);
  }

  return withTransaction(async (session) => {
    const doctor = await requireLiveDoctor(doctorId, session);

    const [patient] = await Patient.create(
      [{ ...input, doctorId, doctorName: doctor.name }],
      { session },
    );

    await Doctor.updateOne({ _id: doctorId }, { $inc: { patientCount: 1 } }, { session });

    cacheInvalidatePrefix('patient:facets');
    return patient!;
  });
}

export async function updatePatient(id: string, input: UpdatePatientInput): Promise<PatientDoc> {
  const reassigning = input.doctorId !== undefined;

  if (!reassigning) {
    const patient = await getPatient(id);
    patient.set(input);
    await patient.save();
    cacheInvalidatePrefix('patient:facets');
    return patient;
  }

  // Reassignment moves the counter between two doctors and rewrites the
  // denormalised doctorName — all three must land together or not at all.
  return withTransaction(async (session) => {
    const patient = await Patient.findById(id).session(session);
    if (!patient) throw ApiError.notFound('Patient');

    const nextDoctorId = String(input.doctorId);
    const prevDoctorId = String(patient.doctorId);

    if (nextDoctorId === prevDoctorId) {
      patient.set(input);
      await patient.save({ session });
      return patient;
    }

    const nextDoctor = await requireLiveDoctor(nextDoctorId, session);

    patient.set({ ...input, doctorName: nextDoctor.name });
    await patient.save({ session });

    // Only a live patient contributes to a count.
    if (!patient.deletedAt) {
      await Doctor.updateOne(
        { _id: prevDoctorId },
        { $inc: { patientCount: -1 } },
        { session },
      );
      await Doctor.updateOne({ _id: nextDoctorId }, { $inc: { patientCount: 1 } }, { session });
    }

    cacheInvalidatePrefix('patient:facets');
    return patient;
  });
}

export async function softDeletePatient(id: string) {
  return withTransaction(async (session) => {
    const result = await Patient.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { session, new: true },
    );
    if (!result) throw ApiError.notFound('Patient');

    await Doctor.updateOne(
      { _id: result.doctorId, patientCount: { $gt: 0 } },
      { $inc: { patientCount: -1 } },
      { session },
    );

    cacheInvalidatePrefix('patient:facets');
    return { id, deletedAt: result.deletedAt };
  });
}

export async function restorePatient(id: string) {
  return withTransaction(async (session) => {
    const patient = await Patient.findById(id).session(session);
    if (!patient) throw ApiError.notFound('Patient');
    if (!patient.deletedAt) throw ApiError.conflict('Patient is not archived');

    // Restoring under an archived doctor would produce a live patient with no live
    // doctor — restore the doctor first, which cascades.
    const doctor = await Doctor.findOne({ _id: patient.doctorId, deletedAt: null })
      .session(session)
      .select('_id');
    if (!doctor) {
      throw ApiError.conflict('Cannot restore: the assigned doctor is archived');
    }

    patient.set('deletedAt', null);
    await patient.save({ session });

    await Doctor.updateOne(
      { _id: patient.doctorId },
      { $inc: { patientCount: 1 } },
      { session },
    );

    cacheInvalidatePrefix('patient:facets');
    return { id, restored: true };
  });
}

export async function patientFacets() {
  return cached('patient:facets:all', 60_000, async () => {
    const base = { deletedAt: null };
    const [conditions, statusCounts] = await Promise.all([
      Patient.distinct('condition', base),
      Patient.aggregate<{ _id: string; count: number }>([
        { $match: base },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return {
      conditions: conditions.filter(Boolean).sort(),
      statuses: statusCounts.map((s) => ({ value: s._id, count: s.count })),
    };
  });
}
