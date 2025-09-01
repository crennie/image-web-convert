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

        // Start server
        server.listen(env.PORT, () => {
            // mark ready once we are listening
            app.locals.setReady?.(true);
            console.log(`API listening on http://0.0.0.0:${env.PORT}`);
        });

        const shutdown = (signal: string) => {
            console.log(`\n${signal} received. Shutting down...`);
            app.locals.setReady?.(false);
            server.close((err) => {
                if (err) {
                    console.error('Error during server close:', err);
                    process.exit(1);
                }
                process.exit(0);
            });

            // Fallback hard-exit if something hangs
            setTimeout(() => process.exit(1), 10_000).unref();
        };

        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    }

    main().catch((err) => {
        console.error('Fatal startup error:', err);
        process.exit(1);
    });
})();
