import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../config/logger.js';

/**
 * Run `fn` inside a MongoDB transaction, retrying transient failures.
 *
 * Atlas clusters are replica sets, so transactions work without any extra setup.
 * Used wherever two collections must move together: the doctor delete cascade, and
 * every patientCount adjustment (a counter that drifts is worse than no counter).
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result: T;
      await session.withTransaction(async () => {
        result = await fn(session);
      });
      return result!;
    } catch (err) {
      lastError = err;

      // TransientTransactionError means a write conflict — the safe response is to
      // retry the whole transaction, not to unpick it.
      const labels = (err as { errorLabels?: string[] })?.errorLabels ?? [];
      const transient = labels.includes('TransientTransactionError');

      if (!transient || attempt === maxRetries) throw err;

      logger.warn({ attempt, err }, 'Transient transaction error, retrying');
      await new Promise((r) => setTimeout(r, 50 * attempt));
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
}
