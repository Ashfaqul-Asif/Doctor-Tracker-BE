import type { NextFunction, Request, Response } from 'express';
import { buildMeta, created, ok } from '../../shared/respond.js';
import * as service from './doctor.service.js';
import type { CreateDoctorInput, ListDoctorsQuery, UpdateDoctorInput } from './doctor.schema.js';

export async function listDoctorsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.query as ListDoctorsQuery;
    const { items, total, page, limit } = await service.listDoctors(query);
    return ok(res, items, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function doctorOptionsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    return ok(res, await service.doctorOptions());
  } catch (err) {
    next(err);
  }
}

export async function doctorFacetsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'private, max-age=30');
    return ok(res, await service.doctorFacets());
  } catch (err) {
    next(err);
  }
}

export async function getDoctorHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    const doctor = await service.getDoctor(id);
    return ok(res, doctor.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function createDoctorHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const doctor = await service.createDoctor(res.locals.body as CreateDoctorInput);
    return created(res, doctor.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function updateDoctorHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    const doctor = await service.updateDoctor(id, res.locals.body as UpdateDoctorInput);
    return ok(res, doctor.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function deleteDoctorHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    return ok(res, await service.softDeleteDoctor(id));
  } catch (err) {
    next(err);
  }
}

export async function restoreDoctorHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    return ok(res, await service.restoreDoctor(id));
  } catch (err) {
    next(err);
  }
}
