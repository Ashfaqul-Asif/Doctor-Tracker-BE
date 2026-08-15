/* eslint-disable no-console */
import { fileURLToPath } from 'node:url';
import { connectDb, disconnectDb } from '../config/db.js';
import { Doctor } from '../modules/doctors/doctor.model.js';
import { Patient } from '../modules/patients/patient.model.js';

/**
 * Recompute Doctor.patientCount from the patients themselves.
 *
 * The counter is maintained transactionally on every write, so it should never
 * drift. This exists because a denormalised value with no way to verify it is a
 * liability — aggregation remains the source of truth, and this proves it agrees.
 * Also used by the seed, which inserts patients directly.
 */
export async function reconcileCounts(
  opts: { apply?: boolean; quiet?: boolean } = {},
): Promise<{ checked: number; updated: number; drift: Array<{ id: string; was: number; is: number }> }> {
  const { apply = false, quiet = false } = opts;

  const actual = await Patient.aggregate<{ _id: unknown; count: number }>([
    { $match: { deletedAt: null } },
    { $group: { _id: '$doctorId', count: { $sum: 1 } } },
  ]);
  const actualById = new Map(actual.map((r) => [String(r._id), r.count]));

  // Every doctor, not just those with patients — a doctor whose patients were all
  // deleted must be corrected back down to zero.
  const doctors = await Doctor.find({}).select('patientCount').lean();

  const drift: Array<{ id: string; was: number; is: number }> = [];
  const writes = [];

  for (const doctor of doctors) {
    const id = String(doctor._id);
    const was = doctor.patientCount ?? 0;
    const is = actualById.get(id) ?? 0;
    if (was === is) continue;

    drift.push({ id, was, is });
    writes.push({ updateOne: { filter: { _id: doctor._id }, update: { $set: { patientCount: is } } } });
  }

  if (apply && writes.length > 0) await Doctor.bulkWrite(writes);

  if (!quiet) {
    if (drift.length === 0) console.log(`No drift across ${doctors.length} doctors.`);
    else {
      console.log(`${drift.length} doctor(s) ${apply ? 'corrected' : 'drifted'}:`);
      for (const d of drift) console.log(`  ${d.id}: ${d.was} -> ${d.is}`);
      if (!apply) console.log('\nRe-run with --apply to write these corrections.');
    }
  }

  return { checked: doctors.length, updated: apply ? drift.length : 0, drift };
}

// Only run as a CLI when invoked directly, so the seed can import it safely.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const apply = process.argv.includes('--apply');
  connectDb()
    .then(() => reconcileCounts({ apply }))
    .then(() => disconnectDb())
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error('reconcileCounts failed:', err instanceof Error ? err.message : err);
      await disconnectDb().catch(() => undefined);
      process.exit(1);
    });
}
