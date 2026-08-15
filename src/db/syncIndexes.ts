/* eslint-disable no-console */
import { connectDb, disconnectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../modules/auth/user.model.js';
import { RefreshToken } from '../modules/auth/refreshToken.model.js';
import { Doctor } from '../modules/doctors/doctor.model.js';
import { Patient } from '../modules/patients/patient.model.js';

/**
 * Build every declared index.
 *
 * autoIndex is off in production (building indexes on each boot is a startup
 * stall), so this is a REQUIRED deploy step. Skip it and every query in the
 * indexing plan silently degrades to a collection scan while still returning
 * correct results — the most likely way this project ships slow but looking fine.
 *
 * syncIndexes also DROPS indexes that are no longer declared in a schema, which is
 * what keeps the database honest as the models change.
 */
async function main(): Promise<void> {
  await connectDb();
  console.log(`\nSyncing indexes on "${env.MONGODB_DB_NAME}"\n`);

  const models = [User, RefreshToken, Doctor, Patient];

  for (const model of models) {
    const dropped = await model.syncIndexes();
    const current = await model.collection.indexes();
    console.log(`  ${model.modelName.padEnd(13)}: ${current.length} indexes` +
      (dropped.length ? ` (dropped ${dropped.length}: ${dropped.join(', ')})` : ''));
    for (const idx of current) {
      console.log(`      - ${idx.name}  ${JSON.stringify(idx.key)}`);
    }
  }

  console.log('\nDone.\n');
}

main()
  .then(() => disconnectDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nsyncIndexes failed:', err instanceof Error ? err.message : err);
    await disconnectDb().catch(() => undefined);
    process.exit(1);
  });
