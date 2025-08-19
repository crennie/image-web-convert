import { z } from 'zod';

const boolFromEnv = (v: string | undefined, fallback: boolean): boolean => {
    if (v === undefined) return fallback;
    const n = v.trim().toLowerCase();
    return n === '1' || n === 'true' || n === 'yes' || n === 'on';
};

const numFromEnv = (v: string | undefined, fallback: number): number => {
    if (v === undefined) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const env = process.env;
const isProd = env['NODE_ENV'] === 'production';

export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;
export const ObservabilityConfigSchema = z.object({
    // General
    serviceName: z.string().default('image-web-convert-api'),
    serviceVersion: z.string().default(env['npm_package_version'] ?? '0.0.0'),
    environment: z
        .string()
        .default(env['OTEL_ENVIRONMENT'] ?? (isProd ? 'prod' : 'dev')),

    // Tracing
    enabled: z.boolean().default(boolFromEnv(env['OTEL_ENABLE'], true)),
    exporterEndpoint: z
        .string()
        .default(env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318'),

    // Sampler
    sampler: z
        .enum([
            'always_on',
            'always_off',
            'parentbased_always_on',
            'parentbased_always_off',
            'parentbased_traceidratio',
        ])
        .default(
            env['OTEL_TRACES_SAMPLER'] ?? isProd
                ? 'parentbased_traceidratio'
                : 'parentbased_always_on'
        ),

    samplerArg: z
        .number()
        .default(
            numFromEnv(env['OTEL_TRACES_SAMPLER_ARG'], isProd ? 0.1 : 1.0)
        ),

    // Logging
    logLevel: z
        .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
        .default(env['LOG_LEVEL'] ?? isProd ? 'info' : 'debug'),
    pretty: z.boolean().default(boolFromEnv(env['LOG_PRETTY'], !isProd)),
    redact: z.array(z.string()).default([
        // Common sensitive fields (pino supports redaction paths)
        'req.headers.authorization',
        'req.headers.cookie',
        "response.headers['set-cookie']",
    ]),
});

export function loadObservabilityConfig(
    partial?: Partial<z.input<typeof ObservabilityConfigSchema>>
): ObservabilityConfig {
    // Allow callers to override specific fields programmatically if desired.
    const cfg = ObservabilityConfigSchema.parse({
        serviceName:
            partial?.serviceName ?? env['OTEL_SERVICE_NAME'] ?? undefined,
        serviceVersion: partial?.serviceVersion ?? undefined,
        environment: partial?.environment ?? undefined,
        enabled: partial?.enabled ?? undefined,
        exporterEndpoint: partial?.exporterEndpoint ?? undefined,
        sampler: partial?.sampler ?? undefined,
        samplerArg: partial?.samplerArg ?? undefined,
        logLevel: partial?.logLevel ?? undefined,
        pretty: partial?.pretty ?? undefined,
        redact: partial?.redact ?? undefined,
    });

    // Minor guardrails
    if (cfg.sampler === 'parentbased_traceidratio') {
        if (cfg.samplerArg <= 0 || cfg.samplerArg > 1) {
            // Normalize invalid values
            cfg.samplerArg = isProd ? 0.1 : 1.0;
        }
    }

    return cfg;
}
