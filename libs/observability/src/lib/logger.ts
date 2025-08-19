import type pino from 'pino';
import { loadObservabilityConfig } from './config.js';
import { getTraceCorrelation } from './instrumentation.js';

export type GetLoggerOptions = {
    level?: pino.LevelWithSilent;
    pretty?: boolean;
    redact?: string[];
    name?: string;
};

let instance: pino.Logger | null = null;

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

    if (pretty) {
        pinoOpts.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                singleLine: false,
                ignore: 'pid,hostname',
            },
        };
    }

    const { default: pino_ } = await import('pino');
    instance = pino_(pinoOpts);
    return instance;
}

/** Helper to create a child bound with the current trace/span ids. */
export function withCorrelation(logger: pino.Logger): pino.Logger {
    const corr = getTraceCorrelation();
    return Object.keys(corr).length ? logger.child(corr) : logger;
}
