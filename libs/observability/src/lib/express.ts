import type {
    Request,
    Response,
    NextFunction,
    ErrorRequestHandler,
} from 'express';
import type { HttpLogger } from 'pino-http';
import type pino from 'pino';
import { randomUUID } from 'node:crypto';
import { getTraceCorrelation } from './instrumentation.js';
import { loadObservabilityConfig } from './config.js';

/**
 * HTTP logging middleware (pino-http) with trace correlation and stable request ids.
 * Logs exactly once per request on response completion.
 */
export async function logContext(baseLogger: pino.Logger): Promise<HttpLogger> {
    const cfg = loadObservabilityConfig();
    const httpLogger = baseLogger.child({ component: 'http' });

    const { pinoHttp } = await import('pino-http');

    return pinoHttp({
        logger: httpLogger,
        // Respect an incoming X-Request-Id if present, else create one
        genReqId: (req) =>
            (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),

        // Merge correlation fields into every log line.
        customProps: () => {
            const { trace_id, span_id } = getTraceCorrelation();
            return {
                trace_id,
                span_id,
            };
        },

        // Map http response types to log error levels automatically:
        // Error status codes log at error level; client 4xx errors at warn; others info.
        customLogLevel: function (_req, res, err) {
            if (err) return 'error';
            const status = res.statusCode;
            if (status >= 500) return 'error';
            if (status >= 400) return 'warn';
            return cfg.logLevel === 'debug' ? 'info' : 'info';
        },

        // Keep to a single completion log; no request-start log.
        autoLogging: true,
        wrapSerializers: true,
    });
}

/**
 * Adds response headers: X-Request-Id and X-Trace-Id.
 * Place this AFTER logContext() so req.id is set.
 */
export function requestContext() {
    return function requestContextMiddleware(
        req: Request,
        res: Response,
        next: NextFunction
    ) {
        // pino-http sets req.id
        const requestId = req.id as string | undefined;
        if (requestId) res.setHeader('X-Request-Id', requestId);

        const { trace_id } = getTraceCorrelation();
        if (trace_id) res.setHeader('X-Trace-Id', trace_id);

        next();
    };
}

/**
 * Normalized JSON error request handler for server that also records exception on the active span
 * (Express will forward here on next(err)).
 */
export function errorTranslator(): ErrorRequestHandler {
    return function (err, _req, res) {
        // _next) {
        // Defer to pino-http to actually log the error line; we just shape the JSON.
        const status = typeof err?.status === 'number' ? err.status : 500;
        const code = err?.code ?? 'INTERNAL';
        const message =
            status === 500
                ? 'Internal Server Error'
                : err?.message ?? String(err);

        const { trace_id } = getTraceCorrelation();

        res.status(status).json({
            error: {
                code,
                message,
            },
            traceId: trace_id,
        });
    };
}
