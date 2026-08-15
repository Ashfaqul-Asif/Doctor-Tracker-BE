import { describe, expect, it } from 'vitest';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';
import { API, loginAgent, makeDoctor, makePatient } from './helpers/app.js';

const VALID = {
  name: 'Ashfaqul Asif',
  specialization: 'Cardiology',
  hospital: 'Square Hospital',
  phone: '+8801711000001',
  email: 'ashfaqul@test.dev',
};

describe('doctor CRUD + validation', () => {
  it('creates a doctor', async () => {
    const agent = await loginAgent();
    const res = await agent.post(`${API}/doctors`).send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: VALID.name, patientCount: 0, status: 'active' });
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).not.toHaveProperty('_id');
  });

  it('rejects a bad email and a bad phone with per-field details', async () => {
    const agent = await loginAgent();
    const res = await agent
      .post(`${API}/doctors`)
      .send({ ...VALID, email: 'nope', phone: 'abc!!' });

    expect(res.status).toBe(422);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['email', 'phone']));
  });

  it('rejects a duplicate live email with 409', async () => {
    const agent = await loginAgent();
    await agent.post(`${API}/doctors`).send(VALID).expect(201);

    const res = await agent.post(`${API}/doctors`).send(VALID);
    expect(res.status).toBe(409);
  });

  it('rejects unknown fields rather than silently dropping them', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor();

    // Guards against mass assignment: patientCount must never be client-writable.
    const res = await agent.patch(`${API}/doctors/${doctor.id}`).send({ patientCount: 999 });
    expect(res.status).toBe(422);
  });

  it('returns 400 for a malformed id and 404 for a missing one', async () => {
    const agent = await loginAgent();

    expect((await agent.get(`${API}/doctors/not-an-id`)).status).toBe(422);
    expect((await agent.get(`${API}/doctors/64b7f9c2e1a2b3c4d5e6f7a8`)).status).toBe(404);
  });

  it('serves /options and /facets rather than treating them as ids', async () => {
    const agent = await loginAgent();
    await makeDoctor({ specialization: 'Neurology', email: 'n@test.dev' });

    const options = await agent.get(`${API}/doctors/options`);
    expect(options.status).toBe(200);
    expect(options.body.data[0]).toHaveProperty('name');

    const facets = await agent.get(`${API}/doctors/facets`);
    expect(facets.status).toBe(200);
    expect(facets.body.data.specializations).toContain('Neurology');
  });
});

describe('doctor filters', () => {
  it('filters by specialization, hospital and status', async () => {
    const agent = await loginAgent();
    await makeDoctor({ specialization: 'Cardiology', hospital: 'A', status: 'active', email: 'a@t.dev' });
    await makeDoctor({ specialization: 'Neurology', hospital: 'B', status: 'on-leave', email: 'b@t.dev' });

    expect((await agent.get(`${API}/doctors`).query({ specialization: 'Cardiology' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/doctors`).query({ hospital: 'B' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/doctors`).query({ status: 'on-leave' })).body.data).toHaveLength(1);
    // Multi-select
    expect(
      (await agent.get(`${API}/doctors`).query({ specialization: 'Cardiology,Neurology' })).body.data,
    ).toHaveLength(2);
  });

  it('filters by patient load', async () => {
    const agent = await loginAgent();
    const busy = await makeDoctor({ email: 'busy@t.dev' });
    await makeDoctor({ email: 'idle@t.dev' });
    await makePatient(busy);
    await Doctor.updateOne({ _id: busy._id }, { $set: { patientCount: 1 } });

    expect((await agent.get(`${API}/doctors`).query({ hasPatients: 'true' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/doctors`).query({ hasPatients: 'false' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/doctors`).query({ minPatients: 1 })).body.data).toHaveLength(1);
  });

  /**
   * Regression guard. `mongoose.set('sanitizeFilter', true)` wraps any object with
   * `$`-prefixed keys in `$eq`, turning our own `{ patientCount: { $lte: 0 } }` into
   * `{ patientCount: { $eq: { $lte: 0 } } }` — which fails to cast and 400s. It broke
   * every range filter (patient load, age, and all date windows) while the suite
   * stayed green, because the test setup was not applying the same Mongoose config.
   */
  it('range filters build real Mongo operators and do not 400', async () => {
    const agent = await loginAgent();
    const busy = await makeDoctor({ email: 'range-busy@t.dev' });
    await makeDoctor({ email: 'range-idle@t.dev' });
    await Doctor.updateOne({ _id: busy._id }, { $set: { patientCount: 5 } });

    for (const query of [
      { hasPatients: 'false' },
      { hasPatients: 'true' },
      { minPatients: 1 },
      { maxPatients: 0 },
      { minPatients: 1, maxPatients: 10 },
      { datePreset: 'last30d' },
      { dateFrom: '2020-01-01', dateTo: '2030-01-01' },
    ]) {
      const res = await agent.get(`${API}/doctors`).query(query);
      expect(res.status, `query ${JSON.stringify(query)} should not error`).toBe(200);
    }
  });

  it('rejects a contradictory range instead of returning a confusing empty page', async () => {
    const agent = await loginAgent();
    const res = await agent.get(`${API}/doctors`).query({ minPatients: 10, maxPatients: 2 });
    expect(res.status).toBe(422);
  });

  it('rejects an unknown sortBy (injection + unindexed-sort hazard)', async () => {
    const agent = await loginAgent();
    expect((await agent.get(`${API}/doctors`).query({ sortBy: '__proto__' })).status).toBe(422);
  });

  it('rejects a limit above the maximum', async () => {
    const agent = await loginAgent();
    const res = await agent.get(`${API}/doctors`).query({ limit: 1000 });
    expect(res.status).toBe(422); // above the schema max, rejected outright
  });

  /**
   * Express 5 defaults to the `simple` query parser, so `page[$ne]=1` never becomes
   * a nested object — the literal key `page[$ne]` is simply unknown and dropped.
   * Combined with zod coercion, an operator cannot reach Mongoose by either route.
   */
  it('cannot be made to inject a Mongo operator through the query string', async () => {
    const agent = await loginAgent();
    await makeDoctor({ email: 'only@t.dev' });

    const injected = await agent.get(`${API}/doctors?specialization[$ne]=zzz&page[$ne]=1`);
    const clean = await agent.get(`${API}/doctors`);

    expect(injected.status).toBe(200);
    // The operator changed nothing: identical result to the unfiltered query.
    expect(injected.body.data).toHaveLength(clean.body.data.length);
    expect(injected.body.meta.page).toBe(1);
  });
});

describe('pagination', () => {
  it('reports correct meta across first, middle and last pages', async () => {
    const agent = await loginAgent();
    for (let i = 0; i < 25; i++) await makeDoctor({ email: `p${i}@t.dev` });

    const first = await agent.get(`${API}/doctors`).query({ page: 1, limit: 10 });
    expect(first.body.meta).toMatchObject({ page: 1, total: 25, totalPages: 3, hasNext: true, hasPrev: false });

    const middle = await agent.get(`${API}/doctors`).query({ page: 2, limit: 10 });
    expect(middle.body.meta).toMatchObject({ hasNext: true, hasPrev: true });

    const last = await agent.get(`${API}/doctors`).query({ page: 3, limit: 10 });
    expect(last.body.data).toHaveLength(5);
    expect(last.body.meta).toMatchObject({ hasNext: false, hasPrev: true });
  });

  /**
   * The regression this guards against is subtle and silent: sorting by a field
   * with duplicate values gives MongoDB no total order, so paging can repeat one
   * record and skip another. Nothing errors — it just looks like a frontend bug.
   * The `_id` tiebreaker in buildListQuery is what makes this pass.
   */
  it('is stable when every record shares the same sort value', async () => {
    const agent = await loginAgent();

    const sameInstant = new Date('2026-01-01T00:00:00.000Z');
    await Doctor.collection.insertMany(
      Array.from({ length: 30 }, (_, i) => ({
        name: `Tied Doctor ${i}`,
        specialization: 'Cardiology',
        hospital: 'H',
        phone: '+8801700000000',
        email: `tied-${i}@t.dev`,
        status: 'active',
        patientCount: 0,
        deletedAt: null,
        searchSuffixes: [],
        createdAt: sameInstant,
        updatedAt: sameInstant,
      })),
    );

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await agent.get(`${API}/doctors`).query({ page, limit: 10 });
      seen.push(...res.body.data.map((d: { id: string }) => d.id));
    }

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30); // no duplicates, nothing skipped
  });
});

describe('soft delete, cascade and restore', () => {
  it('archives the doctor and cascades to their patients', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'cascade@t.dev' });
    await makePatient(doctor, { name: 'P1' });
    await makePatient(doctor, { name: 'P2' });

    const res = await agent.delete(`${API}/doctors/${doctor.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cascadedPatients).toBe(2);

    expect((await agent.get(`${API}/doctors`)).body.data).toHaveLength(0);
    expect((await agent.get(`${API}/patients`)).body.data).toHaveLength(0);

    // Soft, not hard — the rows are still there.
    expect(await Doctor.countDocuments({})).toBe(1);
    expect(await Patient.countDocuments({})).toBe(2);
  });

  it('frees the email for reuse once archived', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'reuse@t.dev' });
    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);

    const res = await agent.post(`${API}/doctors`).send({ ...VALID, email: 'reuse@t.dev' });
    expect(res.status).toBe(201);
  });

  it('returns 404 on a second delete rather than re-stamping', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'twice@t.dev' });

    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);
    expect((await agent.delete(`${API}/doctors/${doctor.id}`)).status).toBe(404);
  });

  it('lists archived records with includeDeleted', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'arch@t.dev' });
    await makeDoctor({ email: 'live@t.dev' });
    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);

    expect((await agent.get(`${API}/doctors`).query({ includeDeleted: 'only' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/doctors`).query({ includeDeleted: 'true' })).body.data).toHaveLength(2);
    expect((await agent.get(`${API}/doctors`).query({ includeDeleted: 'false' })).body.data).toHaveLength(1);
  });

  /**
   * Restore must undo exactly what the delete did — no more. A patient archived
   * separately BEFORE the doctor was deleted should stay archived.
   */
  it('restores only the patients that this delete cascaded', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'restore@t.dev' });
    const cascaded = await makePatient(doctor, { name: 'Cascaded' });
    const preArchived = await makePatient(doctor, { name: 'PreArchived' });

    await agent.delete(`${API}/patients/${preArchived.id}`).expect(200);
    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);

    const res = await agent.post(`${API}/doctors/${doctor.id}/restore`);
    expect(res.status).toBe(200);
    expect(res.body.data.restoredPatients).toBe(1);

    expect((await Patient.findById(cascaded.id))!.deletedAt).toBeNull();
    expect((await Patient.findById(preArchived.id))!.deletedAt).not.toBeNull();
  });

  it('refuses to restore a doctor whose email was taken meanwhile', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'clash@t.dev' });
    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);
    await makeDoctor({ email: 'clash@t.dev' });

    const res = await agent.post(`${API}/doctors/${doctor.id}/restore`);
    expect(res.status).toBe(409);
  });
});

describe('doctor rename fans out to patients', () => {
  it('updates doctorName and keeps the patient searchable by the new name', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ name: 'Original Name', email: 'rename@t.dev' });
    await makePatient(doctor, { name: 'Some Patient' });

    await agent.patch(`${API}/doctors/${doctor.id}`).send({ name: 'Ashfaqul Asif' }).expect(200);

    const patient = await Patient.findOne({ doctorId: doctor._id });
    expect(patient!.doctorName).toBe('Ashfaqul Asif');

    // Searchable from the patient list by the doctor's new name, mid-word.
    const found = await agent.get(`${API}/patients`).query({ search: 'qul' });
    expect(found.body.data).toHaveLength(1);

    const stale = await agent.get(`${API}/patients`).query({ search: 'Original' });
    expect(stale.body.data).toHaveLength(0);
  });
});
