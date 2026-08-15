import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { idParamSchema } from '../../shared/commonSchemas.js';
import { createDoctorSchema, listDoctorsSchema, updateDoctorSchema } from './doctor.schema.js';
import { listPatientsSchema, createPatientSchema } from '../patients/patient.schema.js';
import {
  createDoctorPatientHandler,
  listDoctorPatientsHandler,
} from '../patients/patient.controller.js';
import {
  createDoctorHandler,
  deleteDoctorHandler,
  doctorFacetsHandler,
  doctorOptionsHandler,
  getDoctorHandler,
  listDoctorsHandler,
  restoreDoctorHandler,
  updateDoctorHandler,
} from './doctor.controller.js';

export const doctorRouter = Router();

/**
 * Literal paths MUST be declared before `/:id`, or `:id` swallows them and the
 * ObjectId check rejects "options" with a 422.
 */
doctorRouter.get('/options', doctorOptionsHandler);
doctorRouter.get('/facets', doctorFacetsHandler);

doctorRouter.get('/', validate({ query: listDoctorsSchema }), listDoctorsHandler);
doctorRouter.post('/', validate({ body: createDoctorSchema }), createDoctorHandler);

doctorRouter.get('/:id', validate({ params: idParamSchema }), getDoctorHandler);
doctorRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateDoctorSchema }),
  updateDoctorHandler,
);
doctorRouter.delete('/:id', validate({ params: idParamSchema }), deleteDoctorHandler);
doctorRouter.post('/:id/restore', validate({ params: idParamSchema }), restoreDoctorHandler);

// Nested patients — same filter contract as /patients, with doctorId pinned.
doctorRouter.get(
  '/:id/patients',
  validate({ params: idParamSchema, query: listPatientsSchema }),
  listDoctorPatientsHandler,
);
doctorRouter.post(
  '/:id/patients',
  validate({ params: idParamSchema, body: createPatientSchema }),
  createDoctorPatientHandler,
);
