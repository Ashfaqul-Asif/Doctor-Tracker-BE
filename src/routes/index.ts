import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { doctorRouter } from '../modules/doctors/doctor.routes.js';
import { patientRouter } from '../modules/patients/patient.routes.js';
import { analyticsRouter } from '../modules/analytics/analytics.routes.js';

export const apiRouter = Router();

// /auth mounts its own per-route guards: login and refresh must stay public.
apiRouter.use('/auth', authRouter);

/**
 * Everything below this line requires a valid session. Mounting the guard on the
 * router rather than per-route means a newly added endpoint is protected by default
 * — the spec's "protect all routes" becomes structural rather than a thing to
 * remember on every new handler.
 */
apiRouter.use(authenticate, authorize('admin'));

apiRouter.use('/doctors', doctorRouter);
apiRouter.use('/patients', patientRouter);
apiRouter.use('/analytics', analyticsRouter);
