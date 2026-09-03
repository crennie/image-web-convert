import { z } from 'zod';
import type { SessionImageConfig } from '@image-web-convert/schemas';

const EnvSchema = z.object({
    APP_VERSION: z.string().default('0.0.0'),

    PORT: z.coerce.number().int().positive().default(4201),

    BODY_LIMIT_JSON: z.string().default('2mb'),
    BODY_LIMIT_URLENCODED: z.string().default('2mb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

    SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(15),
    SESSION_MAX_FILES: z.coerce.number().int().positive().default(20),
    SESSION_PER_FILE_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(20_000_000),
    SESSION_MAX_TOTAL_BYTES: z.coerce
        .number()
        .int()
        .positive()
        .default(500_000_000),

    // "false" (case-insensitive) disables CORS; otherwise use the string as origin
    CORS_ORIGIN: z
        .string()
        .transform((v) => (String(v).toLowerCase() === 'false' ? false : v))
        .default('false') as z.ZodType<string | false>,

    ENABLE_OTEL: z
        .string()
        .transform((v) => (String(v).toLowerCase() === 'false' ? false : v))
        .default('false') as z.ZodType<string | false>,
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(src: NodeJS.ProcessEnv = process.env): Env {
    const parsed = EnvSchema.safeParse(src);
    if (!parsed.success) {
        // Compact error for startup logs
        const issues = parsed.error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; ');
        throw new Error(`Invalid environment: ${issues}`);
    }
    return parsed.data;
}

export function getSessionImageConfig(
    src: NodeJS.ProcessEnv = process.env,
): SessionImageConfig {
    const env = loadEnv(src);
    return {
        ttlMinutes: env.SESSION_TTL_MINUTES,
        maxFiles: env.SESSION_MAX_FILES,
        maxBytesPerFile: env.SESSION_PER_FILE_BYTES,
        maxTotalBytes: env.SESSION_MAX_TOTAL_BYTES,
    };
}
