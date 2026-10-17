import { z } from 'zod';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bool = (def: string) =>
  z
    .string()
    .default(def)
    .transform((v) => ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase()));

const envSchema = z.object({
  ALLOW_OFFLINE: bool('true'),
  LLM_PROVIDER: z.enum(['scripted', 'gemini', 'groq']).default('scripted'),
  GEMINI_API_KEY: z.string().default(''),
  GROQ_API_KEY: z.string().default(''),
  DATABASE_URL: z.string().default('sqlite:///./setu.db'),
  JWT_SECRET: z.string().default('dev-only-jwt-secret-change-me-0123456789abcdef'),
  HMAC_KEY: z.string().default('dev-only-hmac-key-change-me-0123456789abcdef'),
  AES_KEY_B64: z.string().default('ZGV2LW9ubHktYWVzLWtleS0zMi1ieXRlcy1sb25nISE='),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  DEMO_MODE: bool('false'),
  FX_MODE: z.enum(['fixture', 'live']).default('fixture'),
  ADMIN_TOKEN: z.string().optional(),
  PORT: z.coerce.number().int().default(8000),
  SETU_DATA_DIR: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(120),
  JWT_TTL_SECONDS: z.coerce.number().int().default(3600),
  COOLING_OFF_HOURS: z.coerce.number().int().default(24),
  T2_CAP_CNY: z.string().default('2000'),
  TOTP_MAX_FAILURES: z.coerce.number().int().default(5),
  FIXED_TODAY: z.string().default(''),
  TOTP_LOCK_SECONDS: z.coerce.number().int().default(300),
});

export type Config = z.infer<typeof envSchema> & { 
  corsOrigins: string[]; 
  dataDir: string;
  jwtTtlSeconds: number;
  coolingOffHours: number;
  t2CapCny: string;
  totpMaxFailures: number;
  fixedToday: string;
  totpLockSeconds: number;
};

const here = dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = envSchema.parse(env);
  return {
    ...c,
    corsOrigins: c.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    dataDir: c.SETU_DATA_DIR ?? resolve(here, '../../data'),
    jwtTtlSeconds: c.JWT_TTL_SECONDS,
    coolingOffHours: c.COOLING_OFF_HOURS,
    t2CapCny: c.T2_CAP_CNY,
    totpMaxFailures: c.TOTP_MAX_FAILURES,
    fixedToday: c.FIXED_TODAY,
    totpLockSeconds: c.TOTP_LOCK_SECONDS,
  };
}
