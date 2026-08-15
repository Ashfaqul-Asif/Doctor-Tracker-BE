import rateLimit from 'express-rate-limit';
import { env, isTest } from '../config/env.js';

/**
 * NOTE (scalability): the default store is in-process, so with more than one
 * replica each instance keeps its own counter and the effective limit multiplies.
 * Fine for a single instance; the multi-instance answer is a Redis store, noted in
 * the README rather than left as an undiscovered flaw.
 */

const skip = () => isTest; // limiters would make the suite flaky and slow

/**
 * Collapse an IPv6 address to its /64 prefix.
 *
 * A single IPv6 allocation routinely hands out 2^64 addresses, so keying the limit
 * on the full address lets one client rotate addresses and bypass it entirely.
 * IPv4 is returned unchanged.
 *
 * (express-rate-limit exports `ipKeyGenerator` for this from v8; this project is
 * on 7.5.1, so it is done here.)
 */
export function normalizeIp(ip: string): string {
  if (!ip.includes(':')) return ip;

  // Strip a zone index and any IPv4-mapped prefix noise before splitting.
  const bare = ip.split('%')[0]!;
  if (bare.includes('.')) return bare; // ::ffff:127.0.0.1 — treat as the IPv4 form

  const expanded = bare.includes('::')
    ? (() => {
        const [head = '', tail = ''] = bare.split('::');
        const h = head ? head.split(':') : [];
        const t = tail ? tail.split(':') : [];
        return [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
      })()
    : bare.split(':');

  return expanded.slice(0, 4).join(':') + '::/64';
}

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => normalizeIp(req.ip ?? 'unknown'),
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

/**
 * Login is limited per IP *and* per submitted email, so one attacker cannot lock
 * every account from a single address, and a distributed attack still hits a
 * per-account ceiling.
 */
export const loginLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === 'string' ? raw.toLowerCase().slice(0, 200) : '';
    return `${normalizeIp(req.ip ?? 'unknown')}:${email}`;
  },
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' },
  },
});
