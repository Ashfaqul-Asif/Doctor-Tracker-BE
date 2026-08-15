import { describe, expect, it } from 'vitest';
import { API, loginAgent, makeDoctor, makePatient } from './helpers/app.js';

describe('GET /analytics/dashboard', () => {
  it('returns every tile in one request', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ specialization: 'Cardiology', email: 'a@t.dev' });
    await makePatient(doctor, { name: 'One Patient', condition: 'Diabetes', status: 'active' });
    await makePatient(doctor, { name: 'Two Patient', condition: 'Asthma', status: 'recovered' });

    const res = await agent.get(`${API}/analytics/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ doctors: 1, patients: 2, avgPatientsPerDoctor: 2 });
    expect(res.body.data.patients.byCondition).toEqual(
      expect.arrayContaining([{ label: 'Diabetes', count: 1 }, { label: 'Asthma', count: 1 }]),
    );
    expect(res.body.data.doctors.bySpecialization).toEqual([{ label: 'Cardiology', count: 1 }]);
  });

  it('does not divide by zero when there are no doctors', async () => {
    const agent = await loginAgent();
    const res = await agent.get(`${API}/analytics/dashboard`);

    // Infinity would serialise to null and break the tile.
    expect(res.body.data.totals.avgPatientsPerDoctor).toBe(0);
  });

  it('excludes archived records from every total', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'arch@t.dev' });
    await makePatient(doctor, { name: 'Will Vanish' });
    await agent.delete(`${API}/doctors/${doctor.id}`).expect(200);

    const res = await agent.get(`${API}/analytics/dashboard`);
    expect(res.body.data.totals).toMatchObject({ doctors: 0, patients: 0 });
  });

  it('agrees with the list endpoint on totals', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'agree@t.dev' });
    for (let i = 0; i < 5; i++) await makePatient(doctor, { name: `Patient ${i}` });

    const dashboard = await agent.get(`${API}/analytics/dashboard`);
    const list = await agent.get(`${API}/patients`).query({ limit: 1 });

    // Aggregation and find must never disagree.
    expect(dashboard.body.data.totals.patients).toBe(list.body.meta.total);
  });

  it('emits a continuous trend axis, zero-filling quiet periods', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'trend@t.dev' });
    await makePatient(doctor, { name: 'Recent Patient', admittedAt: new Date() });

    const res = await agent.get(`${API}/analytics/dashboard`).query({ granularity: 'month', months: 6 });
    const trend = res.body.data.patients.trend;

    // A quiet month must appear as zero, not vanish from the series.
    expect(trend).toHaveLength(6);
    expect(trend.every((b: { count: number }) => typeof b.count === 'number')).toBe(true);
    expect(trend.reduce((a: number, b: { count: number }) => a + b.count, 0)).toBe(1);
  });
});

describe('GET /analytics/patients-per-doctor', () => {
  /**
   * The reason this reads the Doctor collection rather than grouping patients:
   * a $group on patients only ever yields doctors who HAVE patients, so a doctor
   * with zero silently disappears — precisely the fact an admin most needs to see.
   */
  it('includes doctors who have no patients at all', async () => {
    const agent = await loginAgent();
    const busy = await makeDoctor({ name: 'Busy Doctor', email: 'busy@t.dev' });
    await makeDoctor({ name: 'Idle Doctor', email: 'idle@t.dev' });
    await agent.post(`${API}/doctors/${busy.id}/patients`).send({ name: 'Some One', condition: 'Flu' });

    const res = await agent.get(`${API}/analytics/patients-per-doctor`);
    const names = res.body.data.map((d: { name: string }) => d.name);

    expect(names).toContain('Idle Doctor');
    expect(res.body.data.find((d: { name: string }) => d.name === 'Idle Doctor').patientCount).toBe(0);
  });

  it('sorts ascending to surface idle doctors', async () => {
    const agent = await loginAgent();
    const busy = await makeDoctor({ name: 'Busy Doctor', email: 'b@t.dev' });
    await makeDoctor({ name: 'Idle Doctor', email: 'i@t.dev' });
    await agent.post(`${API}/doctors/${busy.id}/patients`).send({ name: 'Some One', condition: 'Flu' });

    const res = await agent.get(`${API}/analytics/patients-per-doctor`).query({ sort: 'asc' });
    expect(res.body.data[0].name).toBe('Idle Doctor');
  });
});

describe('GET /analytics/timeseries', () => {
  it('buckets by the requested granularity in the caller timezone', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ email: 'ts@t.dev' });
    // 00:30 on 15 Aug in Dhaka == 18:30 on 14 Aug UTC.
    await makePatient(doctor, {
      name: 'Late Night',
      admittedAt: new Date('2026-08-14T18:30:00.000Z'),
    });

    const res = await agent.get(`${API}/analytics/timeseries`).query({
      granularity: 'day',
      from: '2026-08-10T00:00:00.000Z',
      to: '2026-08-20T00:00:00.000Z',
      timezone: 'Asia/Dhaka',
    });

    const nonZero = res.body.data.patients.filter((b: { count: number }) => b.count > 0);
    expect(nonZero).toHaveLength(1);
    // Dhaka is UTC+6, so the local day starts at 18:00 UTC the previous date.
    expect(nonZero[0].date).toBe('2026-08-14T18:00:00.000Z');
  });

  it('rejects an invalid granularity', async () => {
    const agent = await loginAgent();
    expect((await agent.get(`${API}/analytics/timeseries`).query({ granularity: 'decade' })).status).toBe(422);
  });
});

describe('distribution endpoints', () => {
  it('returns specialization and condition breakdowns', async () => {
    const agent = await loginAgent();
    const doctor = await makeDoctor({ specialization: 'Neurology', email: 'd@t.dev' });
    await makePatient(doctor, { name: 'Some One', condition: 'Migraine' });

    const spec = await agent.get(`${API}/analytics/by-specialization`);
    expect(spec.body.data).toEqual([{ label: 'Neurology', count: 1 }]);

    const cond = await agent.get(`${API}/analytics/by-condition`);
    expect(cond.body.data).toEqual([{ label: 'Migraine', count: 1 }]);
  });
});
