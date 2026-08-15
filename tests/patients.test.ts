import { describe, expect, it } from 'vitest';
import { Doctor } from '../src/modules/doctors/doctor.model.js';
import { Patient } from '../src/modules/patients/patient.model.js';
import { API, loginAgent, makeDoctor, makePatient } from './helpers/app.js';

describe('patient CRUD', () => {
  it('creates a patient under a doctor and denormalises the doctor name', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ name: 'Ashfaqul Asif', email: 'd@t.dev' });

    const res = await agent.post(`${API}/patients`).send({
      name: 'Kamal Uddin',
      doctorId: doctor.id,
      age: 58,
      gender: 'male',
      condition: 'Hypertension',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.doctorName).toBe('Ashfaqul Asif');
  });

  it('creates via the nested route without a body doctorId', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'nested@t.dev' });

    const res = await agent
      .post(`${API}/doctors/${doctor.id}/patients`)
      .send({ name: 'Nested Patient', condition: 'Asthma' });

    expect(res.status).toBe(201);
    expect(String(res.body.data.doctorId)).toBe(doctor.id);
  });

  it('rejects a body doctorId that contradicts the URL', async () => {
    const agent = await loginAgent();
    const a = await makeDoctor({ email: 'a@t.dev' });
    const b = await makeDoctor({ email: 'b@t.dev' });

    // Silently preferring one would attach the patient to the wrong doctor.
    const res = await agent
      .post(`${API}/doctors/${a.id}/patients`)
      .send({ name: 'Xavier', condition: 'Flu', doctorId: b.id });

    expect(res.status).toBe(422);
  });

  it('refuses to attach a patient to a missing or archived doctor', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'gone@t.dev' });
    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);

    const res = await agent
      .post(`${API}/patients`)
      .send({ name: 'Orphan', condition: 'Flu', doctorId: doctor.id });

    expect(res.status).toBe(422);
  });

  it('edits patient information', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'e@t.dev' });
    const patient = await makePatient(doctor);

    const res = await agent
      .patch(`${API}/patients/${patient.id}`)
      .send({ condition: 'Diabetes', status: 'recovered' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ condition: 'Diabetes', status: 'recovered' });
  });
});

describe('patientCount stays correct', () => {
  it('increments on create and decrements on delete', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'count@t.dev' });

    const created = await agent
      .post(`${API}/doctors/${doctor.id}/patients`)
      .send({ name: 'P1', condition: 'Flu' })
      .expect(201);

    expect((await Doctor.findById(doctor.id))!.patientCount).toBe(1);

    await agent.delete(`${API}/patients/${created.body.data.id}`).expect(200);
    expect((await Doctor.findById(doctor.id))!.patientCount).toBe(0);
  });

  it('moves the count between doctors on reassignment', async () => {
    const agent = await loginAgent();
    const from = await makeDoctor({ name: 'From Doctor', email: 'from@t.dev' });
    const to = await makeDoctor({ name: 'To Doctor', email: 'to@t.dev' });

    const created = await agent
      .post(`${API}/doctors/${from.id}/patients`)
      .send({ name: 'Mover', condition: 'Flu' })
      .expect(201);

    await agent
      .patch(`${API}/patients/${created.body.data.id}`)
      .send({ doctorId: to.id })
      .expect(200);

    expect((await Doctor.findById(from.id))!.patientCount).toBe(0);
    expect((await Doctor.findById(to.id))!.patientCount).toBe(1);
    // The denormalised name must move with the patient.
    expect((await Patient.findById(created.body.data.id))!.doctorName).toBe('To Doctor');
  });

  it('restores the count when an archived patient is restored', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'restore@t.dev' });
    const created = await agent
      .post(`${API}/doctors/${doctor.id}/patients`)
      .send({ name: 'Patient One', condition: 'Flu' })
      .expect(201);

    await agent.delete(`${API}/patients/${created.body.data.id}`).expect(200);
    await agent.post(`${API}/patients/${created.body.data.id}/restore`).expect(200);

    expect((await Doctor.findById(doctor.id))!.patientCount).toBe(1);
  });

  it('refuses to restore a patient whose doctor is still archived', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'arch@t.dev' });
    const created = await agent
      .post(`${API}/doctors/${doctor.id}/patients`)
      .send({ name: 'Patient One', condition: 'Flu' })
      .expect(201);

    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);

    // Would otherwise create a live patient with no live doctor.
    const res = await agent.post(`${API}/patients/${created.body.data.id}/restore`);
    expect(res.status).toBe(409);
  });

  it('agrees with the aggregation — reconcileCounts finds no drift', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'drift@t.dev' });

    for (let i = 0; i < 4; i++) {
      await agent.post(`${API}/doctors/${doctor.id}/patients`).send({ name: `Patient ${i}`, condition: 'Flu' });
    }
    const list = await agent.get(`${API}/doctors/${doctor.id}/patients`);
    await agent.delete(`${API}/patients/${list.body.data[0].id}`).expect(200);

    const { reconcileCounts } = await import('../src/db/reconcileCounts.js');
    const result = await reconcileCounts({ quiet: true });

    expect(result.drift).toHaveLength(0);
    expect((await Doctor.findById(doctor.id))!.patientCount).toBe(3);
  });
});

describe('patient filters', () => {
  it('filters by condition, status, gender and age range', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'f@t.dev' });
    await makePatient(doctor, { name: 'Amina Rahman', condition: 'Diabetes', status: 'active', gender: 'male', age: 30 });
    await makePatient(doctor, { name: 'Bashir Ahmed', condition: 'Asthma', status: 'recovered', gender: 'female', age: 70 });

    expect((await agent.get(`${API}/patients`).query({ condition: 'Diabetes' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/patients`).query({ status: 'recovered' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/patients`).query({ gender: 'female' })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/patients`).query({ ageMin: 60 })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/patients`).query({ ageMin: 25, ageMax: 40 })).body.data).toHaveLength(1);
    expect((await agent.get(`${API}/patients`).query({ condition: 'Diabetes,Asthma' })).body.data).toHaveLength(2);
  });

  it('rejects an inverted age range', async () => {
    const agent = await loginAgent();
    expect((await agent.get(`${API}/patients`).query({ ageMin: 60, ageMax: 20 })).status).toBe(422);
  });

  it('scopes the nested route to that doctor only', async () => {
    const agent = await loginAgent();
    const a = await makeDoctor({ email: 'a@t.dev' });
    const b = await makeDoctor({ email: 'b@t.dev' });
    await makePatient(a, { name: 'A-1' });
    await makePatient(b, { name: 'B-1' });

    const res = await agent.get(`${API}/doctors/${a.id}/patients`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('A-1');
  });

  it('exposes conditions for the filter dropdown', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'fac@t.dev' });
    await makePatient(doctor, { condition: 'Diabetes' });

    const res = await agent.get(`${API}/patients/facets`);
    expect(res.body.data.conditions).toContain('Diabetes');
  });
});

describe('date filtering respects the timezone', () => {
  /**
   * A patient admitted 00:30 local on 15 Aug in Asia/Dhaka is 18:30 UTC on the
   * 14th. Bucketing naively by UTC files them under the wrong day — the chart then
   * disagrees with the list view and neither looks broken.
   */
  it('places a just-after-midnight local admission in the local day', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'tz@t.dev' });

    const localMidnightThirty = new Date('2026-08-14T18:30:00.000Z'); // 00:30 Aug 15 in Dhaka
    await makePatient(doctor, { name: 'Late Night', admittedAt: localMidnightThirty });

    const inLocalDay = await agent.get(`${API}/patients`).query({
      dateField: 'admittedAt',
      dateFrom: '2026-08-15',
      dateTo: '2026-08-15',
      timezone: 'Asia/Dhaka',
    });
    expect(inLocalDay.body.data).toHaveLength(1);

    // ...and NOT in the previous local day.
    const previousDay = await agent.get(`${API}/patients`).query({
      dateField: 'admittedAt',
      dateFrom: '2026-08-14',
      dateTo: '2026-08-14',
      timezone: 'Asia/Dhaka',
    });
    expect(previousDay.body.data).toHaveLength(0);
  });

  it('treats dateTo as an inclusive day, not an exclusive midnight', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'tz2@t.dev' });
    // Midday local on the 15th.
    await makePatient(doctor, { admittedAt: new Date('2026-08-15T06:00:00.000Z') });

    const res = await agent.get(`${API}/patients`).query({
      dateFrom: '2026-08-15',
      dateTo: '2026-08-15',
      timezone: 'Asia/Dhaka',
    });
    expect(res.body.data).toHaveLength(1);
  });

  it('rejects an invalid timezone and an inverted range', async () => {
    const agent = await loginAgent();
    expect((await agent.get(`${API}/patients`).query({ timezone: 'Mars/Olympus' })).status).toBe(422);
    expect(
      (await agent.get(`${API}/patients`).query({ dateFrom: '2026-08-20', dateTo: '2026-08-01' })).status,
    ).toBe(422);
  });

  it('rejects datePreset combined with an explicit range', async () => {
    const agent = await loginAgent();
    const res = await agent
      .get(`${API}/patients`)
      .query({ datePreset: 'last7d', dateFrom: '2026-08-01' });
    expect(res.status).toBe(422);
  });
});
