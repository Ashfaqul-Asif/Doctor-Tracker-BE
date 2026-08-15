import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './expressApp.js';
import { connectDb } from './config/db.js';

/**
 * Vercel's zero-configuration Express entry point.
 *
 * Per Vercel's own docs (https://vercel.com/docs/frameworks/backend/express), it
 * scans for a file at one of a fixed set of conventional locations — app, index, or
 * server, at the project root or under src/ — that imports `express` and exports the
 * application as a default export (or calls app.listen()). Finding such a file, it
 * deploys the whole thing as a single Vercel Function automatically: no api/ folder,
 * no vercel.json rewrites needed.
 *
 * This is exactly why earlier attempts at a hand-rolled api/index.ts + custom
 * vercel.json failed: src/app.ts ALSO matched that convention (it imports express
 * and lives at src/app.ts) but only exported a named factory function (`createApp`),
 * never a default export or a port listener. Vercel's scanner found it, expected a
 * default-exported app or server, and crashed with "Invalid export found... default
 * export must be a function or server" — before our custom api/ function was ever
 * involved. Renaming that file to expressApp.ts (see there) removes it from the scan
 * entirely; this file is the one Vercel is meant to find instead.
 *
 * The docs say the default export must be "a function or server" — a plain
 * (req, res) handler function satisfies that, which is what's needed here anyway to
 * gate every request on the database connection being ready first.
 */

const app = createApp();

/**
 * Cached on globalThis, not a module-level variable.
 *
 * A "warm" Vercel instance reuses this module between invocations, so caching the
 * connection PROMISE here means concurrent requests during a cold start all await
 * the same connect() call instead of racing to open their own — which is exactly
 * the failure mode that exhausts an Atlas free-tier connection limit under load.
 *
 * Deliberately never disconnected: closing the pool after each request would defeat
 * the entire point of reusing it across invocations.
 */
declare global {
  // eslint-disable-next-line no-var
  var __dbConnectPromise: ReturnType<typeof connectDb> | undefined;
}

function getConnection() {
  if (!globalThis.__dbConnectPromise) {
    globalThis.__dbConnectPromise = connectDb().catch((err) => {
      // A failed attempt must not be cached forever — clear it so the NEXT
      // invocation retries instead of every future request short-circuiting on a
      // transient connection error from cold-start.
      globalThis.__dbConnectPromise = undefined;
      throw err;
    });
  }
  return globalThis.__dbConnectPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await getConnection();
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Could not connect to the database' },
      }),
    );
    return;
  }

  app(req, res);
}
