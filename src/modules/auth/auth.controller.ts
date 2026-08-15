import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../../shared/ApiError.js';
import { ok } from '../../shared/respond.js';
import type { AuthedRequest } from '../../shared/types.js';
import { login, revokeRefreshToken, rotateRefreshToken } from './auth.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies.js';
import { User } from './user.model.js';
import type { LoginInput } from './auth.schema.js';

function requestMeta(req: Request) {
  return { userAgent: req.headers['user-agent'], ip: req.ip };
}

/**
 * Bearer mode is opt-in via `X-Auth-Mode: bearer`.
 *
 * The default path (cookies, including the same-origin proxy the Next.js client
 * uses) never sends this header, so tokens stay out of the response body entirely
 * and remain unreadable by JavaScript. A client that genuinely cannot receive
 * cookies — a direct cross-origin SPA, curl, Postman — opts in and receives the
 * refresh token it would otherwise have no way to obtain.
 */
function wantsBearer(req: Request): boolean {
  return String(req.headers['x-auth-mode'] ?? '').toLowerCase() === 'bearer';
}

/** The refresh token may arrive by cookie or, in Bearer mode, in the body. */
function presentedRefreshToken(req: Request): string | undefined {
  const fromCookie = req.cookies?.[REFRESH_COOKIE];
  if (typeof fromCookie === 'string' && fromCookie) return fromCookie;

  const fromBody = (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
  return typeof fromBody === 'string' && fromBody ? fromBody : undefined;
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = res.locals.body as LoginInput;
    const { user, tokens } = await login(email, password, requestMeta(req));

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    // The access token always comes back so a cookie-blocked client can fall back to
    // the Authorization header. The refresh token only comes back in Bearer mode —
    // without it such a client authenticates once and is stranded when the 15-minute
    // access token expires, with no way to renew.
    return ok(res, {
      user: user.toJSON(),
      accessToken: tokens.accessToken,
      ...(wantsBearer(req) ? { refreshToken: tokens.refreshToken } : {}),
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const presented = presentedRefreshToken(req);
    if (!presented) {
      throw ApiError.unauthorized('Refresh token missing', 'REFRESH_TOKEN_MISSING');
    }

    const { user, tokens } = await rotateRefreshToken(presented, requestMeta(req));
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    // Rotation means the presented token is now revoked, so a Bearer client must be
    // handed its replacement here or rotation works exactly once.
    return ok(res, {
      user: user.toJSON(),
      accessToken: tokens.accessToken,
      ...(wantsBearer(req) ? { refreshToken: tokens.refreshToken } : {}),
    });
  } catch (err) {
    // A failed refresh must not leave a stale cookie behind, or the client retries
    // the same dead token forever.
    clearAuthCookies(res);
    next(err);
  }
}

export async function logoutHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Must accept the body form too. Reading only the cookie meant a Bearer client's
    // logout returned 200 while its refresh token stayed valid for a further 7 days —
    // a logout that reported success without revoking anything.
    const presented = presentedRefreshToken(req);
    if (presented) await revokeRefreshToken(presented);
    clearAuthCookies(res);
    return ok(res, { message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const authed = (req as AuthedRequest).user!;
    const user = await User.findById(authed.sub);
    if (!user) throw ApiError.unauthorized('Account no longer exists');
    return ok(res, user.toJSON());
  } catch (err) {
    next(err);
  }
}
