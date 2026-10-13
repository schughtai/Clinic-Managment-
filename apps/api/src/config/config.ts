import { z } from 'zod';

export const CONFIG = Symbol('CONFIG');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value.trim() === '' ? undefined : value.trim()));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Connection string for the restricted application role. Row-level security applies to it. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Connection string for migrations. Only the migration command needs it. */
  ADMIN_DATABASE_URL: optionalString,
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** Comma-separated list of web origins allowed to call the API with cookies. */
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  /** Set to true when the API is served over HTTPS. Forced on in production. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  /** Shared invite code that allows creating a new clinic. Signup is disabled when unset. */
  SIGNUP_CODE: optionalString,
  UPLOAD_DIR: z.string().default('./data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(5_000_000).default(5_000_000),
  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL: z.string().default('claude-opus-5'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(45_000),
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
  sessionSecret: string;
  sessionHours: number;
  allowedOrigins: readonly string[];
  cookieSecure: boolean;
  signupCode: string | undefined;
  uploadDir: string;
  uploadMaxBytes: number;
  anthropicApiKey: string | undefined;
  aiModel: string;
  aiTimeoutMs: number;
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

  if (isProduction && /dev|change|secret|password/i.test(value.SESSION_SECRET)) {
    throw new ConfigError('SESSION_SECRET looks like a placeholder. Generate a random value for production.');
  }

  const allowedOrigins = value.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (allowedOrigins.length === 0) {
    throw new ConfigError('ALLOWED_ORIGINS must list at least one origin.');
  }
  if (isProduction && allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw new ConfigError('ALLOWED_ORIGINS must use https in production.');
  }
  if (value.SIGNUP_CODE !== undefined && value.SIGNUP_CODE.length < 8) {
    throw new ConfigError('SIGNUP_CODE must be at least 8 characters when set.');
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    adminDatabaseUrl: value.ADMIN_DATABASE_URL,
    sessionSecret: value.SESSION_SECRET,
    sessionHours: value.SESSION_HOURS,
    allowedOrigins,
    cookieSecure: isProduction || value.COOKIE_SECURE === 'true',
    signupCode: value.SIGNUP_CODE,
    uploadDir: value.UPLOAD_DIR,
    uploadMaxBytes: value.UPLOAD_MAX_BYTES,
    anthropicApiKey: value.ANTHROPIC_API_KEY,
    aiModel: value.AI_MODEL,
    aiTimeoutMs: value.AI_TIMEOUT_MS,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
    loginRatePerMinute: value.LOGIN_RATE_PER_MINUTE,
  };
}
