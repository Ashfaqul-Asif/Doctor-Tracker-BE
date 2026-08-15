import type { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin';
}

/**
 * `id` is intentionally NOT redeclared here: pino-http already augments Express's
 * Request with `id: ReqId`, and narrowing it to `string | undefined` conflicts with
 * that declaration. Use `getRequestId(req)` to read it as a string.
 */
export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function getRequestId(req: Request): string | undefined {
  const id = (req as unknown as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

export function setRequestId(req: Request, id: string): void {
  (req as unknown as { id: string }).id = id;
}

export type SortOrder = 'asc' | 'desc';

/** How a soft-deleted record is treated by a list query. */
export type IncludeDeleted = 'false' | 'true' | 'only';

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
