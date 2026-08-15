import mongoose from 'mongoose';
import { env, isProd } from './env.js';
import { logger } from './logger.js';

/**
 * Strip credentials before anything touches a log line.
 */
function safeUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}

/**
 * Global Mongoose configuration.
 *
 * Exported so the test setup applies the identical settings. Configuring these only
 * inside connectDb would let tests run against a differently-configured Mongoose
 * than production — which is exactly how a whole class of bug reaches production
 * with a green test suite.
 */
export function applyMongooseSettings(): void {
  // An unknown key in a filter should raise, not silently match every document.
  mongoose.set('strictQuery', true);

  /**
   * `sanitizeFilter` is deliberately NOT enabled.
   *
   * It wraps any object containing `$`-prefixed keys in `$eq`, which is right for a
   * raw user-supplied object but wrong for the operator objects this codebase builds
   * itself. It turns a legitimate `{ patientCount: { $lte: 0 } }` into
   * `{ patientCount: { $eq: { $lte: 0 } } }`, and every range filter — patient load,
   * age, and all date windows — fails to cast.
   *
   * The actual injection defence is zod: every query parameter is coerced to a
   * primitive before it reaches a filter, so an attacker-supplied operator is
   * rejected with a 422 rather than sanitised. See middleware/validate.ts.
   */

  // Building indexes on every production boot is a startup stall; production runs
  // `npm run sync-indexes` as an explicit deploy step instead.
  mongoose.set('autoIndex', !isProd);
}

let connected = false;

export async function connectDb(uriOverride?: string): Promise<typeof mongoose> {
  const uri = uriOverride ?? env.MONGODB_URI;

  applyMongooseSettings();

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));

  await mongoose.connect(uri, {
    // The Atlas URI carries no database in its path, so it must be supplied here.
    // Omitting it silently writes everything to a database called `test`.
    dbName: env.MONGODB_DB_NAME,
    /**
     * On Vercel (VERCEL=1 is set automatically) each serverless instance keeps its
     * own pool, and many instances can run concurrently under load. 10 connections
     * x N concurrent instances exhausts an Atlas free-tier cluster's connection
     * limit fast. A always-on host runs exactly one process, where 10 is fine.
     */
    maxPoolSize: process.env.VERCEL ? 2 : 10,
    minPoolSize: 1,
    // 10s, not 5s: Atlas shared tiers idle down, and a cold first connection plus
    // TLS and SRV resolution regularly exceeds five seconds. A tight timeout here
    // produces an intermittent boot failure that looks like a bad URI.
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
  });

  connected = true;
  logger.info(
    { uri: safeUri(uri), db: mongoose.connection.db?.databaseName },
    'MongoDB connected',
  );
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return;
  await mongoose.connection.close(false);
  connected = false;
  logger.info('MongoDB connection closed');
}

export function dbHealth() {
  return {
    readyState: mongoose.connection.readyState, // 1 === connected
    db: mongoose.connection.db?.databaseName ?? null,
  };
}

export async function pingDb(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    await admin.ping();
    return true;
  } catch {
    return false;
  }
}
