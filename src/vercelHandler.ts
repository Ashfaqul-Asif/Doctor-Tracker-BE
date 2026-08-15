import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';

/**
 * Vercel serverless entry point — SOURCE file.
 *
 * This is bundled by `scripts/build-vercel-function.mjs` into a single flat
 * `api/index.cjs`, which is what Vercel actually deploys. It does not live directly
 * under `api/` as source, because the earlier version did (importing across the
 * `api/` -> `src/` boundary with relative `../src/...js` paths) and Vercel's
 * zero-config Node builder mis-resolved that: production logs showed it trying to
 * invoke `/var/task/src/app.js` itself as the function handler and rejecting it for
 * having no default export, instead of treating `api/index.ts` as the entry and
 * `src/app.ts` as its dependency. Pre-bundling into one file removes that class of
 * cross-directory-import ambiguity entirely — there is nothing left for a builder to
 * misidentify.
 *
 * server.ts's app.listen() has no meaning here — there is no long-lived process to
 * bind a port on. Vercel instead calls this file's default export as a plain
 * (req, res) handler for every request, per invocation. vercel.json rewrites every
 * path to this one function, so it must handle /health as well as everything under
 * /api/v1 — exactly what createApp() already does.
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
