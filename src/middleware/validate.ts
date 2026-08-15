import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ApiError } from '../shared/ApiError.js';

export interface ValidateSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validate and coerce a request, writing the parsed result to res.locals.
 *
 * Two things matter here.
 *
 * 1. Output goes to res.locals, never back onto req.query. In Express 5 `req.query`
 *    is a getter and assigning to it throws — this is also why express-mongo-sanitize
 *    cannot be used on this stack.
 *
 * 2. This is the primary NoSQL-injection defence. Every param is coerced to a
 *    primitive by its schema, so `?doctorId[$ne]=` arrives as an object and fails
 *    with 422 rather than reaching Mongoose as an operator.
 */
export function validate(schemas: ValidateSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) res.locals.params = schemas.params.parse(req.params);
      if (schemas.query) res.locals.query = schemas.query.parse(req.query);
      if (schemas.body) res.locals.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          ApiError.unprocessable(
            'Request validation failed',
            err.issues.map((i) => ({
              path: i.path.join('.') || '(root)',
              message: i.message,
            })),
          ),
        );
        return;
      }
      next(err);
    }
  };
}
