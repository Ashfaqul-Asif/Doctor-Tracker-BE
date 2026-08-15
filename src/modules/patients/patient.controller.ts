import type { NextFunction, Request, Response } from 'express';
import { buildMeta, created, ok } from '../../shared/respond.js';
import * as service from './patient.service.js';
import type { CreatePatientInput, ListPatientsQuery, UpdatePatientInput } from './patient.schema.js';

/** The nested route (`/doctors/:id/patients`) pins the doctor from the URL. */
function pinnedDoctorId(res: Response): string | undefined {
  return (res.locals.params as { id?: string } | undefined)?.id;
}

export async function listPatientsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.query as ListPatientsQuery;
    const { items, total, page, limit } = await service.listPatients(query);
    return ok(res, items, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function listDoctorPatientsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const query = res.locals.query as ListPatientsQuery;
    const { items, total, page, limit } = await service.listPatients(query, pinnedDoctorId(res));
    return ok(res, items, buildMeta(page, limit, total));
  } catch (err) {
    next(err);
  }
}

export async function patientFacetsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.setHeader('Cache-Control', 'private, max-age=30');
    return ok(res, await service.patientFacets());
  } catch (err) {
    next(err);
  }
}

export async function getPatientHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    const patient = await service.getPatient(id);
    return ok(res, patient.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function createPatientHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const patient = await service.createPatient(res.locals.body as CreatePatientInput);
    return created(res, patient.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function createDoctorPatientHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const patient = await service.createPatient(
      res.locals.body as CreatePatientInput,
      pinnedDoctorId(res),
    );
    return created(res, patient.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function updatePatientHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    const patient = await service.updatePatient(id, res.locals.body as UpdatePatientInput);
    return ok(res, patient.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function deletePatientHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    return ok(res, await service.softDeletePatient(id));
  } catch (err) {
    next(err);
  }
}

export async function restorePatientHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = res.locals.params as { id: string };
    return ok(res, await service.restorePatient(id));
  } catch (err) {
    next(err);
  }
}
