import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

/** Used only outside production so `npm run dev` and tests need no setup. Never valid in production. */
export const DEV_MFA_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Connection string for the restricted application role. Row-level security applies to it. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Connection string for migrations and operator commands. The running API never uses it. */
  ADMIN_DATABASE_URL: optionalString,
  SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** 32 bytes as 64 hex characters. Encrypts authenticator secrets at rest. */
  MFA_ENCRYPTION_KEY: optionalString,
  /** Comma-separated list of web origins allowed to call the API with cookies. The first one is used in links. */
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  /** Set to true when the API is served over HTTPS. Forced on in production. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  /** Folder with the built web app. When set, the API also serves the web app on the same origin. */
  WEB_DIST_DIR: optionalString,
  /** Number of reverse proxies in front of the API, so client IP addresses are read correctly. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(300),
  LOGIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(10),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  adminDatabaseUrl: string | undefined;
  sessionHours: number;
  mfaKey: Buffer;
  allowedOrigins: readonly string[];
  /** Origin used to build invitation and reset links. */
  publicOrigin: string;
  cookieSecure: boolean;
  webDistDir: string | undefined;
  logLevel: string;
  trustProxy: number;
  rateLimitPerMinute: number;
  loginRatePerMinute: number;
}

export class ConfigError extends Error {}

/** Reads and validates environment variables. Fails fast with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n- ${problems.join('\n- ')}`);
  }
  const value = parsed.data;
  const isProduction = value.NODE_ENV === 'production';

  const mfaKeyHex = value.MFA_ENCRYPTION_KEY ?? (isProduction ? undefined : DEV_MFA_KEY);
  if (mfaKeyHex === undefined) {
    throw new ConfigError('MFA_ENCRYPTION_KEY is required in production (64 hex characters).');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(mfaKeyHex)) {
    throw new ConfigError('MFA_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  }
  if (isProduction && mfaKeyHex.toLowerCase() === DEV_MFA_KEY) {
    throw new ConfigError('MFA_ENCRYPTION_KEY is the development value. Generate a random key for production.');
  }

  const allowedOrigins = value.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const publicOrigin = allowedOrigins[0];
  if (publicOrigin === undefined) {
    throw new ConfigError('ALLOWED_ORIGINS must list at least one origin.');
  }
  if (isProduction && allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw new ConfigError('ALLOWED_ORIGINS must use https in production.');
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    adminDatabaseUrl: value.ADMIN_DATABASE_URL,
    sessionHours: value.SESSION_HOURS,
    mfaKey: Buffer.from(mfaKeyHex, 'hex'),
    allowedOrigins,
    publicOrigin,
    cookieSecure: isProduction || value.COOKIE_SECURE === 'true',
    webDistDir: value.WEB_DIST_DIR,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
    loginRatePerMinute: value.LOGIN_RATE_PER_MINUTE,
  };
}
