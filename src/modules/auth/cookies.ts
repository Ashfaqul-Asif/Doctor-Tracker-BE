import type { CookieOptions, Response } from 'express';
import { env } from '../../config/env.js';
import { REFRESH_TTL_MS } from './auth.service.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/** Path-scoping the refresh cookie means it is never sent on data requests. */
export const REFRESH_COOKIE_PATH = `${env.API_PREFIX}/auth`;

function baseOptions(): CookieOptions {
  return {
    httpOnly: true, // unreadable from JS, so XSS cannot exfiltrate it
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...baseOptions(),
    path: '/',
    // Deliberately not tied to the JWT's own expiry: the cookie outliving the token
    // by a little lets the client detect TOKEN_EXPIRED and refresh, rather than the
    // cookie vanishing and looking like a logout.
    maxAge: REFRESH_TTL_MS,
  });

  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseOptions(),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TTL_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  // Clearing requires the same flags the cookie was written with, or the browser
  // treats it as a different cookie and the old one survives.
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions(), path: REFRESH_COOKIE_PATH });
}
