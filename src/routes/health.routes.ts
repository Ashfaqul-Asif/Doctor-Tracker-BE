import { Router } from 'express';
import { dbHealth, pingDb } from '../config/db.js';

export const healthRouter = Router();

/**
 * Liveness — deliberately does NOT touch the database.
 *
 * A liveness probe that pings Atlas turns a brief database hiccup into a restart
 * loop, and gives anyone an unauthenticated way to generate database load.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() },
  });
});

/** Readiness — used at deploy time and to confirm the connection landed in the right database. */
healthRouter.get('/health/ready', async (_req, res) => {
  const { readyState, db } = dbHealth();
  const reachable = readyState === 1 && (await pingDb());

  res.status(reachable ? 200 : 503).json({
    success: reachable,
    data: {
      status: reachable ? 'ready' : 'not-ready',
      readyState,
      // Surfaced because a missing dbName silently writes everything to a database
      // called `test` — this is the cheapest way to notice.
      db,
    },
  });
});
