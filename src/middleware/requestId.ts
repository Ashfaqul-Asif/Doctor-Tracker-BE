import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { setRequestId } from '../shared/types.js';

/**
 * Attach a correlation id to every request and echo it back. A user-reported
 * failure ("it said error, here's the id") maps to exactly one log line.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && incoming.slice(0, 64)) || randomUUID();
  setRequestId(req, id);
  res.setHeader('X-Request-Id', id);
  next();
}
