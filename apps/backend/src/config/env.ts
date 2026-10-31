import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017'),
    CORE_DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/).default('mizan_core'),
    TENANT_DB_PREFIX: z.string().regex(/^[a-zA-Z0-9_]+$/).default('mizan_t_'),
    JWT_ACCESS_SECRET: z.string().min(32).default('change-me-dev-access-secret-32chars!'),
    JWT_REFRESH_SECRET: z.string().min(32).default('change-me-dev-refresh-secret-32chars'),
    JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(604800),
    CORS_ORIGINS: z.string().default('http://localhost:4200'),
    PLATFORM_ADMIN_EMAIL: z.string().email().optional(),
    PLATFORM_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      // Fail safely: refuse to boot production with development fallback secrets.
      if (env.JWT_ACCESS_SECRET.startsWith('change-me') || env.JWT_REFRESH_SECRET.startsWith('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT secrets must be explicitly set in production',
        });
      }
      if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'JWT access and refresh secrets must differ',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
