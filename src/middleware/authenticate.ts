import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../shared/ApiError.js';
import type { AuthedRequest, JwtPayload } from '../shared/types.js';
import { verifyAccessToken } from '../modules/auth/auth.service.js';
import { ACCESS_COOKIE } from '../modules/auth/cookies.js';

/**
 * Resolve the access token: httpOnly cookie first, Authorization header second.
 *
 * The cookie is the primary mechanism and the security posture is unchanged. The
 * Bearer fallback exists because a cookie is third-party whenever the client and API
 * sit on unrelated domains (app.vercel.app -> api.onrender.com); Safari blocks those
 * outright, so login would return 200 and every subsequent request 401. The fallback
 * also makes the API usable from curl and Postman without a cookie jar.
 */
function extractToken(req: Request): string | null {
  const fromCookie = req.cookies?.[ACCESS_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie.length > 0) return fromCookie;

  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }

  return null;
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    next(ApiError.unauthorized('Authentication required'));
    return;
  }

  try {
    // Throws TokenExpiredError / JsonWebTokenError, both mapped by errorHandler.
    (req as AuthedRequest).user = verifyAccessToken(token) as JwtPayload;
    next();
  } catch (err) {
    next(err);
  }
}
