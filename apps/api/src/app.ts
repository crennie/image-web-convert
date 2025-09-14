import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import hpp from 'hpp';
import { rateLimit } from 'express-rate-limit';
import { loadEnv } from './env.js';
import {
    getLogger,
    logContext,
    requestContext,
    errorTranslator,
} from '@image-web-convert/observability';
import apiRouter from './api/index.js';

export type AppDeps = {
    // future: inject logger, metrics, etc.
    test: string;
};

export async function createApp(deps?: AppDeps): Promise<express.Express> {
    const env = loadEnv();
    const app = express();

    // 0) Init OpenTelemetry logging
    if (env.ENABLE_OTEL) {
        const logger = await getLogger(); // pass to logContext(logger)
        app.use(await logContext(logger)); // logs + req.id + correlation
        app.use(requestContext()); // sets X-Request-Id, X-Trace-Id
    }

    // 1) Process-level
    app.set('trust proxy', 1);
    app.disable('x-powered-by');

    // 2) Security defaults
    app.use(
        helmet({
            contentSecurityPolicy: {
                useDefaults: true,
                directives: {
                    // No active content by default
                    'default-src': ["'none'"],
                    // Allow only same-origin connections (might need to change if using SSE or other endpoints)
                    'connect-src': ["'self'"],
                    // Disallow being iframed
                    'frame-ancestors': ["'none'"],
                    // Don’t allow form submissions
                    'form-action': ["'none'"],
                    // No base tag shenanigans
                    'base-uri': ["'none'"],

                    // TODO: Determine image serving restrictions - does it apply for downloads? do we need it for previews
                    // "img-src": ["'self'", "data:"]
                },
            },
            // Other hardening headers:
            referrerPolicy: { policy: 'no-referrer' },
            crossOriginEmbedderPolicy: false, // COEP not needed for plain API
            crossOriginOpenerPolicy: { policy: 'same-origin' },
            crossOriginResourcePolicy: { policy: 'same-site' },
        })
    );

    app.use(express.urlencoded({ extended: true }));
    app.use(hpp());

    // 3) CORS (restrictive by default)
    app.use(
        cors({
            origin: env.CORS_ORIGIN,
            credentials: false,
            exposedHeaders: ['Content-Disposition', 'Content-Length'],
        })
    );

    // 4) Body parsers with strict limits
    app.use(express.json({ limit: env.BODY_LIMIT_JSON }));
    app.use(
        express.urlencoded({
            extended: false,
            limit: env.BODY_LIMIT_URLENCODED,
        })
    );

    // 5) Compression
    app.use(compression());

    // 6) Rate limit (skip health endpoints)
    const limiter = rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.path === '/healthz' || req.path === '/readyz',
    });
    app.use(limiter);


    // --------- API (Session/File Upload/Download) Handler ----
    app.use('/api', apiRouter);

    // ---------- Health & readiness ----------
    // Ready flag toggled by index.ts when server is listening
    let isReady = false;
    app.locals.setReady = (v: boolean) => {
        isReady = v;
    };

    app.get('/healthz', (req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            version: process.env.APP_VERSION ?? '0.0.0',
        });
    });

    app.get('/readyz', (req, res) => {
        if (!isReady) {
            return res.status(503).json({ status: 'starting' });
        }
        return res.json({ status: 'ready' });
    });

    // ---------- 404 & error handlers ----------
    app.use((req, res) => {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Route not found' });
    });

    //app.use(errorHandler);
    app.use(errorTranslator);

    return app;
}
