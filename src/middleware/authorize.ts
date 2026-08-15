import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../shared/ApiError.js';
import type { AuthedRequest } from '../shared/types.js';

/**
 * Role guard. Only 'admin' exists today, but routing authorisation through a guard
 * rather than assuming the role means adding a second role later is a one-line
 * change per route instead of an audit of every handler.
 */
export function authorize(...roles: Array<'admin'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as AuthedRequest).user;
    if (!user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }
    if (roles.length > 0 && !roles.includes(user.role)) {
      next(ApiError.forbidden());
      return;
    }
    next();
  };
}
