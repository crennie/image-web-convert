import path from 'node:path';
import fssync from 'node:fs';
import type pino from 'pino';
import { loadObservabilityConfig } from './config.js';
import { getTraceCorrelation } from './instrumentation.js';
import { normalizeAbsolutePath } from '@image-web-convert/node-shared';

const DEFAULT_OTEL_LOG_FILE = path.resolve(process.cwd(), 'logs', 'app.log');
export const OTEL_LOG_FILE = normalizeAbsolutePath(process.env.OTEL_LOG_FILE || DEFAULT_OTEL_LOG_FILE);

export type GetLoggerOptions = {
    level?: pino.LevelWithSilent;
    pretty?: boolean;
    redact?: string[];
    name?: string;
};

let instance: pino.Logger | null = null;

// ensure logging dir exists
if (!fssync.existsSync(path.dirname(OTEL_LOG_FILE))) {
    fssync.mkdirSync(path.dirname(OTEL_LOG_FILE), { recursive: true });
}

export async function getLogger(
    options: GetLoggerOptions = {}
): Promise<pino.Logger> {
    if (instance) return instance;
    const cfg = loadObservabilityConfig();
    const level = options.level ?? cfg.logLevel;
    const pretty = options.pretty ?? cfg.pretty;
    const redact = options.redact ?? cfg.redact;
    const name = options.name ?? cfg.serviceName;

    const pinoOpts: pino.LoggerOptions = {
        level,
        redact,
        base: { service: name, env: cfg.environment },
    };

    pinoOpts.transport = {
        target: pretty ? "pino-pretty" : "pino/file",
        options: {
            translateTime: 'SYS:standard',
            destination: OTEL_LOG_FILE,
            singleLine: false,
            ignore: 'pid,hostname',
        }
    };

    const { default: pino_ } = await import('pino');
    instance = pino_(pinoOpts, pino_.destination({ dest: OTEL_LOG_FILE, append: true, sync: true }));
    return instance;
}

/** Helper to create a child bound with the current trace/span ids. */
export function withCorrelation(logger: pino.Logger): pino.Logger {
    const corr = getTraceCorrelation();
    return Object.keys(corr).length ? logger.child(corr) : logger;
}
