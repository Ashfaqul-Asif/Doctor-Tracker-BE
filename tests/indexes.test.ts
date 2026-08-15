import { beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';
import { buildSearchSuffixes } from '../src/shared/searchIndex.js';

/**
 * Index-usage regression guard.
 *
 * A dropped index is a SILENT failure: adding an `i` flag to the search regex,
 * changing a default sort to a field with no matching compound index, or deleting
 * an index() line while tidying a schema all leave the endpoint returning perfectly
 * correct data. Every functional test still passes. The query has simply gone from
 * reading 12 documents to reading all of them, and it surfaces in production.
 *
 * These tests assert the PLAN, not the result.
 *
 * This file seeds its own few hundred rows because the query planner legitimately
 * prefers a COLLSCAN on a tiny collection — scanning 24 documents is cheaper than
 * walking an index. Without enough data these tests would fail for a reason that
 * has nothing to do with the indexes. Note also that `.hint()` is never used:
 * forcing the index would defeat the point, which is that the planner CHOOSES it.
 */

const DOCTOR_COUNT = 400;
const PATIENT_COUNT = 600;

const SPECIALIZATIONS = ['Cardiology', 'Neurology', 'Oncology', 'Pediatrics', 'Dermatology'];
const CONDITIONS = ['Diabetes', 'Asthma', 'Hypertension', 'Migraine', 'Arthritis'];
const STATUSES = ['active', 'under-observation', 'recovered', 'discharged'] as const;

let doctorIds: mongoose.Types.ObjectId[] = [];

interface ExplainResult {
  queryPlanner: { winningPlan: unknown };
  executionStats: { nReturned: number; totalDocsExamined: number; totalKeysExamined: number };
}

function planOf(explain: ExplainResult): string {
  return JSON.stringify(explain.queryPlanner.winningPlan);
}

/** Precise: "SORT_KEY_GENERATOR" must not count as a blocking SORT stage. */
function hasBlockingSort(plan: string): boolean {
  return /"stage"\s*:\s*"SORT"/.test(plan);
}

beforeAll(async () => {
  // afterEach in setup.ts clears collections, so this file builds its dataset once
  // and each test re-seeds via the helper below.
  await Doctor.syncIndexes();
  await Patient.syncIndexes();
});

async function seedBulk() {
  const now = Date.now();

  const doctors = Array.from({ length: DOCTOR_COUNT }, (_, i) => {
    const name = i === 0 ? 'Ashfaqul Asif' : `Doctor Number ${i}`;
    const specialization = SPECIALIZATIONS[i % SPECIALIZATIONS.length]!;
    const hospital = `Hospital ${i % 12}`;
    const email = `bulk-doctor-${i}@test.dev`;
    const phone = `+88017000${String(i).padStart(5, '0')}`;
    return {
      _id: new mongoose.Types.ObjectId(),
      name,
      specialization,
      hospital,
      phone,
      email,
      status: 'active',
      patientCount: i % 17,
      deletedAt: null,
      searchSuffixes: buildSearchSuffixes([name, specialization, hospital, email, phone]),
      createdAt: new Date(now - i * 60_000),
      updatedAt: new Date(now - i * 60_000),
    };
  });

  await Doctor.collection.insertMany(doctors);
  doctorIds = doctors.map((d) => d._id);

  const patients = Array.from({ length: PATIENT_COUNT }, (_, i) => {
    const doctor = doctors[i % DOCTOR_COUNT]!;
    const name = `Patient Number ${i}`;
    const condition = CONDITIONS[i % CONDITIONS.length]!;
    return {
      _id: new mongoose.Types.ObjectId(),
      name,
      doctorId: doctor._id,
      doctorName: doctor.name,
      age: 20 + (i % 60),
      gender: i % 2 === 0 ? 'male' : 'female',
      condition,
      status: STATUSES[i % STATUSES.length],
      admittedAt: new Date(now - i * 3_600_000),
      deletedAt: null,
      searchSuffixes: buildSearchSuffixes([name, condition, doctor.name]),
      createdAt: new Date(now - i * 60_000),
      updatedAt: new Date(now - i * 60_000),
    };
  });

  await Patient.collection.insertMany(patients);
}

describe('index usage — the queries must use indexes, not scan', () => {
  it('substring search uses an IXSCAN and examines ~only what it returns', async () => {
    await seedBulk();

    const explain = (await Doctor.find({ deletedAt: null, searchSuffixes: /^qul/ })
      .explain('executionStats')) as unknown as ExplainResult;

    expect(planOf(explain)).toContain('IXSCAN');
    expect(planOf(explain)).not.toContain('COLLSCAN');

    const { nReturned, totalDocsExamined } = explain.executionStats;
    expect(nReturned).toBe(1);
    // The whole point: reading 1 document, not 400.
    expect(totalDocsExamined).toBeLessThanOrEqual(nReturned * 2);
  });

  /**
   * The contrast that justifies the whole suffix-index design.
   *
   * Note what this asserts and what it does NOT. The naive query does not report
   * COLLSCAN here — MongoDB picks the { deletedAt, name, _id } index and reports
   * IXSCAN. But the index bounds are `name: ["", {})`, i.e. the entire range of
   * strings: it walks every index entry and applies the regex as a filter. That is
   * a FULL INDEX SCAN, asymptotically the same O(N) work as a collection scan.
   *
   * So the stage name is not the measure — examination count is. An unanchored
   * regex with the `i` flag can never produce a bounded range, which is exactly
   * what the suffix index provides.
   */
  it('CONTRAST: the naive case-insensitive regex examines every record', async () => {
    await seedBulk();

    const naive = (await Doctor.find({
      deletedAt: null,
      name: { $regex: 'qul', $options: 'i' },
    }).explain('executionStats')) as unknown as ExplainResult;

    const suffix = (await Doctor.find({ deletedAt: null, searchSuffixes: /^qul/ }).explain(
      'executionStats',
    )) as unknown as ExplainResult;

    // Both return the same single doctor...
    expect(naive.executionStats.nReturned).toBe(1);
    expect(suffix.executionStats.nReturned).toBe(1);

    // ...but the naive one reads all 400 to find it.
    const naiveExamined = Math.max(
      naive.executionStats.totalKeysExamined,
      naive.executionStats.totalDocsExamined,
    );
    const suffixExamined = Math.max(
      suffix.executionStats.totalKeysExamined,
      suffix.executionStats.totalDocsExamined,
    );

    expect(naiveExamined).toBeGreaterThanOrEqual(DOCTOR_COUNT);
    expect(suffixExamined).toBeLessThanOrEqual(5);
    // The headline number for the README.
    expect(naiveExamined / suffixExamined).toBeGreaterThan(50);
  });

  it("a doctor's patient list uses the compound index and does not blocking-sort", async () => {
    await seedBulk();

    const explain = (await Patient.find({ deletedAt: null, doctorId: doctorIds[0] })
      .sort({ admittedAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats')) as unknown as ExplainResult;

    const plan = planOf(explain);
    expect(plan).toContain('IXSCAN');
    expect(hasBlockingSort(plan)).toBe(false);
  });

  it('condition filter + default sort is index-served', async () => {
    await seedBulk();

    const explain = (await Patient.find({ deletedAt: null, condition: 'Diabetes' })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats')) as unknown as ExplainResult;

    const plan = planOf(explain);
    expect(plan).toContain('IXSCAN');
    expect(hasBlockingSort(plan)).toBe(false);
  });

  it('date-range filter on admittedAt is index-served', async () => {
    await seedBulk();

    const explain = (await Patient.find({
      deletedAt: null,
      admittedAt: { $gte: new Date(Date.now() - 86_400_000) },
    })
      .sort({ admittedAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats')) as unknown as ExplainResult;

    const plan = planOf(explain);
    expect(plan).toContain('IXSCAN');
    expect(hasBlockingSort(plan)).toBe(false);
  });

  it('sortBy=patientCount is index-served (this is why the counter is denormalised)', async () => {
    await seedBulk();

    const explain = (await Doctor.find({ deletedAt: null })
      .sort({ patientCount: -1, _id: -1 })
      .limit(10)
      .explain('executionStats')) as unknown as ExplainResult;

    const plan = planOf(explain);
    expect(plan).toContain('IXSCAN');
    expect(hasBlockingSort(plan)).toBe(false);
  });

  it('the default doctor list sort is index-served', async () => {
    await seedBulk();

    const explain = (await Doctor.find({ deletedAt: null })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats')) as unknown as ExplainResult;

    const plan = planOf(explain);
    expect(plan).toContain('IXSCAN');
    expect(hasBlockingSort(plan)).toBe(false);
  });
});

describe('index declarations', () => {
  it('declares the partial unique email index that makes soft delete work', async () => {
    const indexes = await Doctor.collection.indexes();
    const emailIndex = indexes.find((i) => i.name?.startsWith('email_1'));

    expect(emailIndex).toBeDefined();
    expect(emailIndex!.unique).toBe(true);
    // Partial, so an archived doctor's email is freed for reuse.
    expect(emailIndex!.partialFilterExpression).toEqual({ deletedAt: null });
  });

  it('every sort-bearing index terminates in _id for a total order', async () => {
    const indexes = await Patient.collection.indexes();
    const sortIndexes = indexes.filter(
      (i) => i.key && ('createdAt' in i.key || 'admittedAt' in i.key),
    );

    expect(sortIndexes.length).toBeGreaterThan(0);
    for (const idx of sortIndexes) {
      const keys = Object.keys(idx.key);
      expect(keys[keys.length - 1]).toBe('_id');
    }
  });
});
