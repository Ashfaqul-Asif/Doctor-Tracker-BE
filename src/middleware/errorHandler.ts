import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { ApiError, type ErrorDetail } from '../shared/ApiError.js';
import { logger } from '../config/logger.js';
import { isProd } from '../config/env.js';
import { getRequestId } from '../shared/types.js';

interface MongoDuplicateKeyError {
  code: number;
  keyValue?: Record<string, unknown>;
}

function isDuplicateKeyError(err: unknown): err is MongoDuplicateKeyError {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * The single place any error becomes a response. Nothing else formats errors, so
 * the client sees one shape and secrets never leak through a stack trace.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = getRequestId(req);

  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: ErrorDetail[] | undefined;

  if (err instanceof ApiError) {
    ({ statusCode, code, message } = err);
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Document validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    code = 'INVALID_ID';
    message = `Invalid value for '${err.path}'`;
  } else if (isDuplicateKeyError(err)) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    const field = Object.keys(err.keyValue ?? {})[0] ?? 'field';
    message = `A record with this ${field} already exists`;
    details = [{ path: field, message: 'must be unique' }];
  } else if (err instanceof Error && err.name === 'TokenExpiredError') {
    statusCode = 401;
    // Distinct from INVALID_TOKEN so the client knows to try /auth/refresh
    // rather than bouncing the user to the login screen.
    code = 'TOKEN_EXPIRED';
    message = 'Access token expired';
  } else if (err instanceof Error && err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid authentication token';
  }

  const logPayload = { err, requestId, method: req.method, url: req.originalUrl, statusCode };
  if (statusCode >= 500) logger.error(logPayload, 'Unhandled error');
  else logger.warn(logPayload, 'Request failed');

  // A 500 in production must never echo the underlying message — it can carry a
  // connection string, a query, or a file path.
  const safeMessage = statusCode >= 500 && isProd ? 'Internal server error' : message;

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: safeMessage,
      ...(details?.length ? { details } : {}),
      ...(isProd || statusCode < 500 ? {} : { stack: (err as Error)?.stack }),
    },
    requestId,
  });
}
