import {
    initTelemetry,
    safeErrorSummary,
} from '@image-web-convert/observability';

(async () => {
    const { loadEnv } = await import('./env.js');
    const env = loadEnv();
    const telemetry = env.ENABLE_OTEL ? await initTelemetry() : undefined;
    const http = await import('node:http');
    const { createApp } = await import('./app.js');
    const { createConversionRuntime } = await import(
        './services/conversion-runtime.service.js'
    );

    async function main() {
        let shutdownOnFault: () => void = () => undefined;
        const conversions = createConversionRuntime({
            onFault: () => shutdownOnFault(),
        });
        const app = await createApp({
            conversions,
            onStorageFault: () => shutdownOnFault(),
        });
        const server = http.createServer(app);

        // Recovery and scheduler ownership must precede accepting requests.
        const { recoverConversionRequestStaging } = await import(
            './controllers/conversion-upload.http.js'
        );
        const { UPLOAD_TMP_DIR } = await import('./services/storage.paths.js');
        await recoverConversionRequestStaging(UPLOAD_TMP_DIR);
        await conversions.start();

        let shuttingDown = false;
        const shutdown = (signal: string, fatal = false) => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`\n${signal} received. Shutting down...`);
            app.locals.setReady?.(false);
            // HTTP closure alone does not imply background conversion drained.
            const fallback = setTimeout(
                () => process.exit(1),
                env.CONVERSION_SHUTDOWN_GRACE_MS,
            ).unref();
            const httpClosed = new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve())),
            );
            void Promise.all([httpClosed, conversions.stop()])
                .then(async ([, result]) => {
                    await telemetry?.shutdown();
                    clearTimeout(fallback);
                    process.exit(result.drained && !fatal ? 0 : 1);
                })
                .catch((err) => {
                    console.error(
                        'Error during shutdown:',
                        safeErrorSummary(err),
                    );
                    process.exit(1);
                });
        };

        shutdownOnFault = () => shutdown('Storage fault', true);
        server.listen(env.PORT, () => {
            // mark ready once we are listening
            app.locals.setReady?.(true);
            console.log(`API listening on http://0.0.0.0:${env.PORT}`);
        });

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }

    main().catch((err) => {
        console.error('Fatal startup error:', safeErrorSummary(err));
        process.exit(1);
    });
})();
