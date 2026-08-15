import express, { type Express } from 'express';
import helmet from 'helmet';
import cors, { type CorsOptions } from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './config/logger.js';
import { requestId } from './middleware/requestId.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { apiRouter } from './routes/index.js';
import { getRequestId } from './shared/types.js';

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
 * the tests never need a real port.
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
