import { initTelemetry } from '@image-web-convert/observability';

(async () => {
    const { loadEnv } = await import('./env.js');
    const env = loadEnv();
    if (env.ENABLE_OTEL) {
        await initTelemetry();
    }
    const http = await import('node:http');
    const { createApp } = await import('./app.js');

    async function main() {
        const app = await createApp();
        const server = http.createServer(app);
        const conversions = app.locals.conversions;

        // Recovery and scheduler ownership must precede accepting requests.
        const { recoverConversionRequestStaging } = await import('./services/conversion-upload.service.js');
        const { UPLOAD_TMP_DIR } = await import('./services/storage.paths.js');
        await recoverConversionRequestStaging(UPLOAD_TMP_DIR);
        await conversions.start();
        server.listen(env.PORT, () => {
            // mark ready once we are listening
            app.locals.setReady?.(true);
            console.log(`API listening on http://0.0.0.0:${env.PORT}`);
        });

        let shuttingDown = false;
        const shutdown = (signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;
            console.log(`\n${signal} received. Shutting down...`);
            app.locals.setReady?.(false);
            // HTTP closure alone does not imply background conversion drained.
            const fallback = setTimeout(() => process.exit(1), env.CONVERSION_SHUTDOWN_GRACE_MS).unref();
            const httpClosed = new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
            void Promise.all([httpClosed, conversions.stop()]).then(([, result]) => {
                clearTimeout(fallback);
                process.exit(result.drained ? 0 : 1);
            }).catch(err => {
                console.error('Error during shutdown:', err);
                process.exit(1);
            });
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }

    main().catch((err) => {
        console.error('Fatal startup error:', err);
        process.exit(1);
    });
})();
