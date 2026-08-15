import type { Response } from 'express';

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * One envelope shape for every successful response, so the client needs a single
 * parser: { success, data, meta? }.
 */
export function ok<T>(res: Response, data: T, meta?: PageMeta, statusCode = 200): Response {
  return res.status(statusCode).json(meta ? { success: true, data, meta } : { success: true, data });
}

export function created<T>(res: Response, data: T): Response {
  return ok(res, data, undefined, 201);
}

export function buildMeta(page: number, limit: number, total: number): PageMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1 && total > 0,
  };
}
