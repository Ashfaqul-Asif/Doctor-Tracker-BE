import type { NextFunction, Request, Response } from 'express';
import { ok } from '../../shared/respond.js';
import * as service from './analytics.service.js';
import type { DashboardQuery, PerDoctorQuery, TimeseriesQuery } from './analytics.schema.js';

/** Analytics is read-only and mildly stale by design — see the TTL cache. */
function shortCache(res: Response) {
  res.setHeader('Cache-Control', 'private, max-age=30');
}

export async function dashboardHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    shortCache(res);
    return ok(res, await service.dashboard(res.locals.query as DashboardQuery));
  } catch (err) {
    next(err);
  }
}

export async function patientsPerDoctorHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    shortCache(res);
    return ok(res, await service.patientsPerDoctor(res.locals.query as PerDoctorQuery));
  } catch (err) {
    next(err);
  }
}

export async function timeseriesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    shortCache(res);
    return ok(res, await service.timeseries(res.locals.query as TimeseriesQuery));
  } catch (err) {
    next(err);
  }
}

export async function bySpecializationHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    shortCache(res);
    return ok(res, await service.bySpecialization());
  } catch (err) {
    next(err);
  }
}

export async function byConditionHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    shortCache(res);
    return ok(res, await service.byCondition());
  } catch (err) {
    next(err);
  }
}
