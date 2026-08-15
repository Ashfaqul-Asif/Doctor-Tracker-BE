import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

/**
 * The suite creates, mutates, and deletes doctors and patients. Pointed at the real
 * `careguide` cluster it would destroy production data — so the connection is
 * replaced with an in-memory server BEFORE any application module reads env.
 *
 * A replica set (not a standalone) because the doctor delete cascade and every
 * patientCount adjustment run inside transactions, which require one.
 */
let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();

  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB_NAME = 'doctor_tracker_test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret-value-0123456789';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-9876543210';
  process.env.DEFAULT_TIMEZONE = 'Asia/Dhaka';
  process.env.LOG_LEVEL = 'silent';

  /**
   * Hard guard, not a comment. If anything ever rewires the URI back to a hosted
   * cluster, fail the run rather than silently writing to it.
   */
  if (/^mongodb\+srv:/i.test(process.env.MONGODB_URI)) {
    throw new Error(
      'Refusing to run tests against a remote cluster — MONGODB_URI must be the in-memory server',
    );
  }

  /**
   * Apply the SAME global Mongoose settings production uses.
   *
   * Connecting here with different settings than connectDb() meant the suite was
   * testing a differently-configured Mongoose — which is how a broken range filter
   * (sanitizeFilter mangling `$lte`) passed every test and still failed on the real
   * server. Importing the real config closes that gap.
   */
  const { applyMongooseSettings } = await import('../src/config/db.js');
  applyMongooseSettings();

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME });
  // Tests rely on the indexes existing (indexes.test.ts asserts on plan choice).
  mongoose.set('autoIndex', true);
});

afterEach(async () => {
  // Clear between tests so ordering never matters, but keep indexes — dropping the
  // database would discard them and make the index assertions meaningless.
  const collections = await mongoose.connection.db!.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));

  // The count/facet caches are module-level and survive a collection wipe, so
  // without this a `total` computed in one test leaks into the next and the suite
  // reports counts for data that no longer exists.
  const { cacheClear } = await import('../src/shared/cache.js');
  cacheClear();
});

afterAll(async () => {
  await mongoose.connection.close(false);
  await replSet?.stop();
});
