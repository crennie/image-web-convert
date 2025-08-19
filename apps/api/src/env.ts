import { z } from 'zod';

const EnvSchema = z.object({
    APP_VERSION: z.string().default('0.0.0'),

    PORT: z.coerce.number().int().positive().default(3333),

    BODY_LIMIT_JSON: z.string().default('2mb'),
    BODY_LIMIT_URLENCODED: z.string().default('2mb'),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

    // "false" (case-insensitive) disables CORS; otherwise use the string as origin
    CORS_ORIGIN: z
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
