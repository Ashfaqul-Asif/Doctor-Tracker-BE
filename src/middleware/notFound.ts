import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../shared/ApiError.js';

export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
}
