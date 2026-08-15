import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { idParamSchema } from '../../shared/commonSchemas.js';
import { createPatientSchema, listPatientsSchema, updatePatientSchema } from './patient.schema.js';
import {
  createPatientHandler,
  deletePatientHandler,
  getPatientHandler,
  listPatientsHandler,
  patientFacetsHandler,
  restorePatientHandler,
  updatePatientHandler,
} from './patient.controller.js';

export const patientRouter = Router();

// Literal path before /:id — see doctor.routes.ts.
patientRouter.get('/facets', patientFacetsHandler);

patientRouter.get('/', validate({ query: listPatientsSchema }), listPatientsHandler);
patientRouter.post('/', validate({ body: createPatientSchema }), createPatientHandler);

patientRouter.get('/:id', validate({ params: idParamSchema }), getPatientHandler);
patientRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updatePatientSchema }),
  updatePatientHandler,
);
patientRouter.delete('/:id', validate({ params: idParamSchema }), deletePatientHandler);
patientRouter.post('/:id/restore', validate({ params: idParamSchema }), restorePatientHandler);
