/* eslint-disable no-console */
import { fileURLToPath } from 'node:url';
import { connectDb, disconnectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../modules/auth/user.model.js';
import { hashPassword } from '../modules/auth/password.js';
import { Doctor } from '../modules/doctors/doctor.model.js';
import { Patient } from '../modules/patients/patient.model.js';
import { SEED_DOCTORS, SEED_PATIENTS } from './seedData.js';
import { reconcileCounts } from './reconcileCounts.js';

/**
 * Bootstraps the live `careguide` database with the essential records.
 *
 * This writes to a real cluster, so it is deliberately defensive:
 *   - upsert-only; it never calls deleteMany or drop
 *   - existing records are left untouched (the live row is newer than this script)
 *   - it aborts unless SEED_CONFIRM matches the target database name
 *   - the admin password is never overwritten without an explicit flag
 *
 * Re-running it is therefore safe and idempotent.
 */

const RESET_ADMIN_PASSWORD = process.argv.includes('--reset-admin-password');

interface Tally {
  created: number;
  skipped: number;
}

function fail(message: string): never {
  console.error(`\n  Seed aborted: ${message}\n`);
  process.exit(1);
}

async function seedAdmin(): Promise<Tally> {
  const { SEED_ADMIN_EMAIL, SEED_ADMIN_NAME, SEED_ADMIN_PASSWORD } = env;

  if (!SEED_ADMIN_EMAIL) fail('SEED_ADMIN_EMAIL is not set');
  if (!SEED_ADMIN_PASSWORD || SEED_ADMIN_PASSWORD.length < 12) {
    fail('SEED_ADMIN_PASSWORD must be set and at least 12 characters');
  }

  const existing = await User.findOne({ email: SEED_ADMIN_EMAIL });

  if (existing) {
    if (!RESET_ADMIN_PASSWORD) {
      console.log(`  admin      : exists, unchanged (${SEED_ADMIN_EMAIL})`);
      return { created: 0, skipped: 1 };
    }
    existing.passwordHash = await hashPassword(SEED_ADMIN_PASSWORD);
    await existing.save();
    console.log(`  admin      : password reset (${SEED_ADMIN_EMAIL})`);
    return { created: 0, skipped: 0 };
  }

  await User.create({
    email: SEED_ADMIN_EMAIL,
    name: SEED_ADMIN_NAME ?? 'Administrator',
    role: 'admin',
    passwordHash: await hashPassword(SEED_ADMIN_PASSWORD),
  });
  console.log(`  admin      : created (${SEED_ADMIN_EMAIL})`);
  return { created: 1, skipped: 0 };
}

async function seedDoctors(): Promise<Tally> {
  const tally: Tally = { created: 0, skipped: 0 };

  for (const entry of SEED_DOCTORS) {
    // Natural key. Matching on any deletedAt state means an archived seed doctor is
    // not silently duplicated as a second live row.
    const existing = await Doctor.findOne({ email: entry.email });
    if (existing) {
      tally.skipped++;
      continue;
    }
    // create() runs the pre-save hook, so searchSuffixes is built by the same code
    // path the API uses — the seed can never produce unsearchable records.
    await Doctor.create(entry);
    tally.created++;
  }

  console.log(`  doctors    : ${tally.created} created, ${tally.skipped} skipped`);
  return tally;
}

async function seedPatients(): Promise<Tally> {
  const tally: Tally = { created: 0, skipped: 0 };

  const doctors = await Doctor.find({ deletedAt: null }).select('name email').lean();
  const byEmail = new Map(doctors.map((d) => [d.email, d]));

  for (const entry of SEED_PATIENTS) {
    const doctor = byEmail.get(entry.doctorEmail);
    if (!doctor) {
      console.warn(`  ! skipping ${entry.name}: doctor ${entry.doctorEmail} not found`);
      tally.skipped++;
      continue;
    }

    const existing = await Patient.findOne({ name: entry.name, doctorId: doctor._id });
    if (existing) {
      tally.skipped++;
      continue;
    }

    await Patient.create({
      name: entry.name,
      doctorId: doctor._id,
      doctorName: doctor.name,
      age: entry.age,
      gender: entry.gender,
      condition: entry.condition,
      status: entry.status,
      admittedAt: new Date(Date.now() - entry.admittedDaysAgo * 86_400_000),
      phone: entry.phone,
      email: entry.email,
    });
    tally.created++;
  }

  console.log(`  patients   : ${tally.created} created, ${tally.skipped} skipped`);
  return tally;
}

/**
 * Seed an already-connected database.
 *
 * Exported separately from the CLI entry point so `dev:memory` can reuse it without
 * the module also connecting, disconnecting, and calling process.exit on import.
 */
export async function seedAll(): Promise<void> {
  console.log(`\nSeeding "${env.MONGODB_DB_NAME}" (upsert-only, nothing is deleted)\n`);

  await seedAdmin();
  await seedDoctors();
  await seedPatients();

  // patientCount is maintained transactionally by the API, but the seed inserts
  // patients directly — recompute so the denormalised counter is correct.
  const drift = await reconcileCounts({ apply: true, quiet: true });
  console.log(`  counters   : ${drift.updated} doctor(s) recomputed`);
}

async function main(): Promise<void> {
  /**
   * Safety latch. Typing the target database name is a deliberate speed bump
   * against running this against the wrong cluster.
   */
  if (!env.SEED_CONFIRM || env.SEED_CONFIRM !== env.MONGODB_DB_NAME) {
    fail(
      `SEED_CONFIRM must equal MONGODB_DB_NAME ("${env.MONGODB_DB_NAME}") to run against this database.\n` +
        `  Set SEED_CONFIRM=${env.MONGODB_DB_NAME} in .env once you are sure.`,
    );
  }

  await connectDb();
  await seedAll();
  console.log('\nDone.\n');
}

// Only run as a CLI when invoked directly, so importing seedAll is side-effect free.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  main()
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('\nSeed failed:', err instanceof Error ? err.message : err);
      await disconnectDb().catch(() => undefined);
      process.exit(1);
    });
}
