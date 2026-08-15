import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { loginLimiter } from '../../middleware/rateLimit.js';
import { loginSchema } from './auth.schema.js';
import { loginHandler, logoutHandler, meHandler, refreshHandler } from './auth.controller.js';

export const authRouter = Router();

// Public — these two are the only unauthenticated routes under /api/v1.
authRouter.post('/login', loginLimiter, validate({ body: loginSchema }), loginHandler);
authRouter.post('/refresh', refreshHandler);

// Authenticated.
authRouter.post('/logout', authenticate, logoutHandler);
authRouter.get('/me', authenticate, meHandler);
