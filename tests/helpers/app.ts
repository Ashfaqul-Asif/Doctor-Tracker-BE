import request, { type Agent } from 'supertest';
import type { Express } from 'express';
import { User } from '../../src/modules/auth/user.model.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { Doctor } from '../../src/modules/doctors/doctor.model.js';
import { Patient } from '../../src/modules/patients/patient.model.js';

export const API = '/api/v1';

export const ADMIN = {
  email: 'admin@test.dev',
  password: 'TestAdminPassw0rd!',
  name: 'Test Admin',
};

let cachedApp: Express | null = null;

/**
 * Imported lazily: createApp reads env at module load, and tests/setup.ts must have
 * rewritten MONGODB_URI to the in-memory server first.
 */
export async function getApp(): Promise<Express> {
  if (!cachedApp) {
    const { createApp } = await import('../../src/expressApp.js');
    cachedApp = createApp();
  }
  return cachedApp;
}

/** A supertest agent that persists the httpOnly auth cookies across requests. */
export async function loginAgent(): Promise<Agent> {
  const app = await getApp();
  await User.create({
    email: ADMIN.email,
    name: ADMIN.name,
    role: 'admin',
    passwordHash: await hashPassword(ADMIN.password),
  });

  const agent = request.agent(app);
  const res = await agent
    .post(`${API}/auth/login`)
    .send({ email: ADMIN.email, password: ADMIN.password });

  if (res.status !== 200) {
    throw new Error(`Login failed in test helper: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

export async function makeDoctor(overrides: Partial<Record<string, unknown>> = {}) {
  return Doctor.create({
    name: 'Test Doctor',
    specialization: 'Cardiology',
    hospital: 'Test Hospital',
    phone: '+8801700000000',
    email: `doc-${Math.random().toString(36).slice(2, 10)}@test.dev`,
    status: 'active',
    ...overrides,
  });
}

export async function makePatient(
  doctor: { _id: unknown; name: string },
  overrides: Partial<Record<string, unknown>> = {},
) {
  return Patient.create({
    name: 'Test Patient',
    doctorId: doctor._id,
    doctorName: doctor.name,
    age: 40,
    gender: 'male',
    condition: 'Hypertension',
    status: 'active',
    admittedAt: new Date(),
    ...overrides,
  });
}
