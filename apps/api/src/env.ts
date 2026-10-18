import { z } from 'zod';
import { isIP } from 'node:net';
import type { SessionImageConfig } from '@image-web-convert/schemas';

const bodyLimit = z.string().refine((value) => {
    const match = /^([1-9]\d*)(b|kb|mb|gb)?$/i.exec(value);
    if (!match) return false;
    const multiplier = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[
        (match[2] ?? 'b').toLowerCase() as 'b' | 'kb' | 'mb' | 'gb'
    ];
    return Number.isSafeInteger(Number(match[1]) * multiplier);
}, 'Expected a positive byte count (for example, 2mb)');

const trustedProxyIps = z
    .string()
    .default('')
    .transform((value, ctx) => {
        if (value === '') return [];
        const addresses = value.split(',').map((address) => address.trim());
        if (addresses.some((address) => !isIP(address))) {
            ctx.addIssue({
                code: 'custom',
                message: 'Expected comma-separated proxy IP addresses',
            });
            return z.NEVER;
        }
        return addresses;
    });

const EnvSchema = z.object({
    APP_VERSION: z.string().default('0.0.0'),

    PORT: z.coerce.number().int().positive().default(4201),

    BODY_LIMIT_JSON: bodyLimit.default('2mb'),
    BODY_LIMIT_URLENCODED: bodyLimit.default('2mb'),
    RATE_LIMIT_WINDOW_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(2_147_483_647)
        .default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    // Only these immediate proxy peers may supply X-Forwarded-For.
    TRUSTED_PROXY_IPS: trustedProxyIps,

    CONVERSION_MAX_OPERATIONS: z.coerce.number().int().positive().default(3),
    CONVERSION_MAX_UPLOADS: z.coerce.number().int().positive().default(2),
    CONVERSION_UPLOAD_IDLE_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(2_147_483_647)
        .default(60_000),
    CONVERSION_UPLOAD_TOTAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(2_147_483_647)
        .default(300_000),
    CONVERSION_FILE_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(3_600_000)
        .default(120_000),
    CONVERSION_SWEEP_INTERVAL_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(2_147_483_647)
        .default(1_000),
    CONVERSION_SHUTDOWN_GRACE_MS: z.coerce
        .number()
        .int()
        .positive()
        .max(2_147_483_647)
        .default(10_000),
    CONVERSION_MAX_INPUT_PIXELS: z.coerce
        .number()
        .int()
        .positive()
        .default(20_000_000),
    CONVERSION_MAX_DIMENSION: z.coerce.number().int().positive().default(8192),

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
        .transform((v) => v.trim().toLowerCase())
        .pipe(z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']))
        .transform((v) => ['true', '1', 'yes', 'on'].includes(v))
        .prefault('false'),
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

export function getConversionRuntimeConfig(
    src: NodeJS.ProcessEnv = process.env,
) {
    const env = loadEnv(src);
    return {
        maxOperations: env.CONVERSION_MAX_OPERATIONS,
        maxUploads: env.CONVERSION_MAX_UPLOADS,
        uploadIdleMs: env.CONVERSION_UPLOAD_IDLE_MS,
        uploadTotalMs: env.CONVERSION_UPLOAD_TOTAL_MS,
        fileTimeoutMs: env.CONVERSION_FILE_TIMEOUT_MS,
        sweepIntervalMs: env.CONVERSION_SWEEP_INTERVAL_MS,
        shutdownGraceMs: env.CONVERSION_SHUTDOWN_GRACE_MS,
        maxInputPixels: env.CONVERSION_MAX_INPUT_PIXELS,
        maxDimension: env.CONVERSION_MAX_DIMENSION,
    };
}
export type ConversionRuntimeConfig = ReturnType<
    typeof getConversionRuntimeConfig
>;
