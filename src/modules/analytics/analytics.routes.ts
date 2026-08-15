import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { dashboardSchema, perDoctorSchema, timeseriesSchema } from './analytics.schema.js';
import {
  byConditionHandler,
  bySpecializationHandler,
  dashboardHandler,
  patientsPerDoctorHandler,
  timeseriesHandler,
} from './analytics.controller.js';

export const analyticsRouter = Router();

analyticsRouter.get('/dashboard', validate({ query: dashboardSchema }), dashboardHandler);
analyticsRouter.get(
  '/patients-per-doctor',
  validate({ query: perDoctorSchema }),
  patientsPerDoctorHandler,
);
analyticsRouter.get('/timeseries', validate({ query: timeseriesSchema }), timeseriesHandler);
analyticsRouter.get('/by-specialization', bySpecializationHandler);
analyticsRouter.get('/by-condition', byConditionHandler);
