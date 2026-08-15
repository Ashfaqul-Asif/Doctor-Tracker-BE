import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../shared/ApiError.js';
import type { JwtPayload } from '../../shared/types.js';
import { User, type UserDoc } from './user.model.js';
import { RefreshToken } from './refreshToken.model.js';
import { getDummyDigest, verifyPassword } from './password.js';

/** Refresh tokens are opaque random strings — only their hash is stored. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  return value * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
}

export const REFRESH_TTL_MS = ttlToMs(env.REFRESH_TOKEN_TTL);

export function signAccessToken(user: { id: string; email: string; role: 'admin' }): string {
  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

async function issueRefreshToken(
  userId: string,
  family: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

  await RefreshToken.create({
    userId,
    tokenHash: sha256(token),
    family,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });

  return { token, expiresAt };
}

export async function login(
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: UserDoc; tokens: IssuedTokens }> {
  const user = await User.findOne({ email }).select('+passwordHash');

  // Both branches do the same amount of work — see password.ts getDummyDigest.
  const digest = user?.passwordHash ?? (await getDummyDigest());
  const valid = await verifyPassword(digest, password).catch(() => false);

  // Identical error for "no such account" and "wrong password": anything else
  // turns the login form into an account-enumeration oracle.
  if (!user || !valid) throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');

  user.lastLoginAt = new Date();
  await user.save();

  const family = randomUUID();
  const { token: refreshToken, expiresAt } = await issueRefreshToken(user.id, family, meta);

  return {
    user,
    tokens: {
      accessToken: signAccessToken({ id: user.id, email: user.email, role: user.role }),
      refreshToken,
      expiresAt,
    },
  };
}

/**
 * Rotate a refresh token: the presented token is revoked and a new one issued.
 *
 * If a token that was ALREADY revoked is presented, that means either a replay or a
 * stolen token being used after the legitimate holder rotated. Either way the family
 * is compromised, so every token in it is revoked and the user must log in again.
 */
export async function rotateRefreshToken(
  presented: string,
  meta: { userAgent?: string; ip?: string },
): Promise<{ user: UserDoc; tokens: IssuedTokens }> {
  const tokenHash = sha256(presented);
  const stored = await RefreshToken.findOne({ tokenHash });

  if (!stored) throw ApiError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');

  if (stored.revokedAt) {
    logger.warn(
      { userId: String(stored.userId), family: stored.family },
      'Refresh token reuse detected — revoking family',
    );
    await RefreshToken.updateMany(
      { family: stored.family, revokedAt: null },
      { revokedAt: new Date() },
    );
    throw ApiError.unauthorized('Refresh token reuse detected', 'TOKEN_REUSE_DETECTED');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  }

  const user = await User.findById(stored.userId);
  if (!user) throw ApiError.unauthorized('Account no longer exists', 'INVALID_REFRESH_TOKEN');

  const { token: refreshToken, expiresAt } = await issueRefreshToken(
    user.id,
    stored.family,
    meta,
  );

  stored.revokedAt = new Date();
  stored.replacedByHash = sha256(refreshToken);
  await stored.save();

  return {
    user,
    tokens: {
      accessToken: signAccessToken({ id: user.id, email: user.email, role: user.role }),
      refreshToken,
      expiresAt,
    },
  };
}

export async function revokeRefreshToken(presented: string): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: sha256(presented), revokedAt: null },
    { revokedAt: new Date() },
  );
}
