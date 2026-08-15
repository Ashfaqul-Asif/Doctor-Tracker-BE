/* eslint-disable no-console */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Run the API against a throwaway in-memory MongoDB.
 *
 * Useful when Atlas credentials are unavailable, when working offline, or for a
 * quick clean-slate demo. Data lives only for the lifetime of the process.
 *
 * A replica set rather than a standalone, because the doctor-delete cascade and
 * every patientCount adjustment run inside transactions, which need one.
 *
 * Usage: npm run dev:memory
 */
async function main(): Promise<void> {
  console.log('\nStarting in-memory MongoDB (first run downloads a binary)…');

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();

  // Set before anything imports config/env.ts, which reads process.env at load time.
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB_NAME = 'careguide_dev';
  process.env.SEED_CONFIRM = 'careguide_dev';
  process.env.NODE_ENV = 'development';
  process.env.SEED_ADMIN_EMAIL ??= 'admin@doctortracker.dev';
  process.env.SEED_ADMIN_NAME ??= 'Local Admin';
  process.env.SEED_ADMIN_PASSWORD ??= 'LocalDevPassword123';
  process.env.JWT_ACCESS_SECRET ??= 'local-dev-access-secret-not-for-production';
  process.env.JWT_REFRESH_SECRET ??= 'local-dev-refresh-secret-not-for-production';

  console.log(`Connected to ephemeral database "careguide_dev"`);

  // Imported dynamically so the env above is already in place.
  const { connectDb } = await import('../config/db.js');
  const { seedAll } = await import('./seed.js');

  await connectDb();
  await seedAll();

  const { createApp } = await import('../app.js');
  const { env } = await import('../config/env.js');

  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`\n  API      http://localhost:${env.PORT}`);
    console.log(`  Health   http://localhost:${env.PORT}/health/ready`);
    console.log(`  Login    ${process.env.SEED_ADMIN_EMAIL} / ${process.env.SEED_ADMIN_PASSWORD}`);
    console.log('\n  Data is in-memory and disappears when this process exits.\n');
  });

  const shutdown = async () => {
    await replSet.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('Failed to start in-memory server:', err);
  process.exit(1);
});
