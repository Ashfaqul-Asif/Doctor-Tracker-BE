import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import express, { type Express } from 'express';
import helmet from 'helmet';
import cors, { type CorsOptions } from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { requestId } from './middleware/requestId.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { apiRouter } from './routes/index.js';
import { getRequestId } from './shared/types.js';

/**
 * The single entry point — deliberately not split across files.
 *
 * Vercel's zero-configuration Express support (vercel.com/docs/frameworks/backend/
 * express) scans app/index/server at the project root or under src/ for a file that
 * ITSELF contains `import express` and either exports the app as a default export or
 * calls app.listen(). A previous version of this file only imported a `createApp`
 * factory from a separate module — which meant it never literally imported express
 * — and Vercel rejected it: "No entrypoint found which imports express. Found
 * possible entrypoint: src/index.ts". Every example in Vercel's own docs constructs
 * the app inline in the one conventionally-named file; splitting it out is what
 * broke detection. So express is imported and called here directly.
 *
 * `createApp` stays an exported named function (not just inline app-building code)
 * so tests can still get a fresh, unlistened Express instance per run via
 * `import { createApp } from '../../src/index.js'`.
 */

/**
 * Vercel preview deployments get a new hostname per commit, so a bare string
 * allowlist blocks every preview URL. Any origin ending in `.vercel.app` that also
 * appears as a configured origin's preview sibling is permitted.
 */
function buildCorsOptions(): CorsOptions {
  const allowed = new Set(env.CLIENT_ORIGINS);
  const previewPattern = /^https:\/\/[\w-]+\.vercel\.app$/;
  const allowPreviews = env.CLIENT_ORIGINS.some((o) => o.endsWith('.vercel.app'));

  return {
    origin(origin, callback) {
      // Same-origin requests, curl, and server-to-server calls send no Origin.
      if (!origin) return callback(null, true);
      if (allowed.has(origin)) return callback(null, true);
      if (allowPreviews && previewPattern.test(origin)) return callback(null, true);
      return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    // Required for the httpOnly cookies to cross origins at all. Note that
    // `credentials: true` is incompatible with `origin: '*'` — browsers reject it.
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  };
}

/**
 * Builds the app without calling listen(), so supertest can drive it directly and
 * tests never need a real port.
 */
export function createApp(): Express {
  const app = express();

  // Trust the platform proxy so req.ip is the client address, not the load
  // balancer's — otherwise every request shares one rate-limit bucket.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(requestId);

  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => getRequestId(req as never) ?? '',
        autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      }),
    );
  }

  // Health is public and mounted above the API prefix so probes need no auth.
  app.use(healthRouter);

  app.use(env.API_PREFIX, globalLimiter, apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

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

/**
 * The Vercel entry point. Docs say the default export must be "a function or
 * server" — a plain (req, res) handler satisfies that, and lets every request be
 * gated on the database connection being ready first.
 */
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

/**
 * Standalone/local mode — runs ONLY when this file is executed directly (`tsx
 * src/index.ts`, or `node dist/index.js` on a Render/Railway-style always-on host),
 * never when Vercel imports the module and calls the default export per-invocation.
 * Vercel never sets argv[1] to this file, so `isMainModule` is false there and this
 * whole block — the app.listen() port bind, connectDb() call, graceful shutdown —
 * is skipped entirely, which is what keeps the default export the only thing Vercel
 * ever touches.
 */
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const main = async (): Promise<void> => {
    // Connect BEFORE listen(), so a bad URI or a missing Atlas IP allowlist entry
    // fails loudly at boot instead of serving 500s to every request.
    await connectDb();

    const server: Server = app.listen(env.PORT, () => {
      logger.info(
        { port: env.PORT, env: env.NODE_ENV, prefix: env.API_PREFIX },
        `Doctor Tracker API listening on http://localhost:${env.PORT}`,
      );
    });

    let shuttingDown = false;

    async function shutdown(signal: string): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info({ signal }, 'Shutting down');

      // Stop accepting new connections, let in-flight requests finish, then close
      // the database. Closing Mongoose first would fail those in-flight requests.
      const forced = setTimeout(() => {
        logger.error('Forced shutdown after 10s timeout');
        process.exit(1);
      }, 10_000);
      forced.unref();

      await new Promise<void>((resolve) => server.close(() => resolve()));
      await disconnectDb();
      clearTimeout(forced);
      process.exit(0);
    }

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error({ reason }, 'Unhandled promise rejection');
    });
    process.on('uncaughtException', (err) => {
      logger.fatal({ err }, 'Uncaught exception — exiting');
      process.exit(1);
    });
  };

  main().catch((err) => {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  });
}
