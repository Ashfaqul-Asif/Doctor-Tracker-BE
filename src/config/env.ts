import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment value the server depends on, parsed once at import time.
 * A malformed .env fails the process here rather than surfacing as a confusing
 * runtime error three layers deep.
 */

const booleanish = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0'), z.literal('')])
  .transform((v) => v === 'true' || v === '1');

/** `Intl.supportedValuesOf` is the only reliable way to validate an IANA zone. */
const supportedTimeZones = new Set(Intl.supportedValuesOf('timeZone'));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    API_PREFIX: z.string().startsWith('/').default('/api/v1'),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_DB_NAME: z.string().min(1, 'MONGODB_DB_NAME is required'),

    CLIENT_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    DEFAULT_TIMEZONE: z
      .string()
      .default('Asia/Dhaka')
      .refine((tz) => supportedTimeZones.has(tz), {
        message: 'DEFAULT_TIMEZONE must be a valid IANA timezone (e.g. Asia/Dhaka)',
      }),

    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL: z.string().default('7d'),

    COOKIE_SECURE: booleanish.default('false'),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().optional(),

    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_NAME: z.string().optional(),
    SEED_ADMIN_PASSWORD: z.string().optional(),
    SEED_CONFIRM: z.string().optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    // 'silent' is a real pino level and is what the test setup uses.
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((v, ctx) => {
    if (v.JWT_ACCESS_SECRET === v.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET — sharing one secret lets a ' +
          'refresh token be presented as an access token.',
      });
    }
    // SameSite=None cookies are ignored by browsers unless they are also Secure.
    if (v.COOKIE_SAME_SITE === 'none' && !v.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SAME_SITE=none requires COOKIE_SECURE=true (browsers reject it otherwise)',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Logger depends on env, so this one case writes directly to stderr.
  console.error(`\nInvalid environment configuration:\n${details}\n`);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
