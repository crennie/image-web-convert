import { createServer } from 'node:http';
import { trace } from '@opentelemetry/api';
import { initTelemetry } from '../lib/instrumentation.js';

afterEach(() => vi.unstubAllEnvs());

it('exports a span to a local collector, shuts down, and can initialize disabled', async () => {
    const requests: string[] = [];
    const collector = createServer((req, res) => {
        requests.push(req.url ?? '');
        req.resume();
        req.on('end', () => {
            res.setHeader('Content-Type', 'application/json');
            res.end('{}');
        });
    });
    collector.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => collector.once('listening', resolve));
    const address = collector.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing collector port');
    vi.stubEnv('OTEL_TRACES_SAMPLER', 'always_on');
    vi.stubEnv('OTEL_METRICS_EXPORTER', undefined);
    vi.stubEnv(
        'OTEL_EXPORTER_OTLP_ENDPOINT',
        `http://127.0.0.1:${address.port}`,
    );
    vi.stubEnv('OTEL_LOGS_EXPORTER', 'none');
    let telemetry: Awaited<ReturnType<typeof initTelemetry>> | undefined;
    let stopped = false;
    try {
        telemetry = await initTelemetry({
            enabled: true,
            environment: 'test',
            exporterEndpoint: `http://127.0.0.1:${address.port}`,
        });
        expect(telemetry.enabled).toBe(true);
        trace
            .getTracer('dependency-compatibility')
            .startSpan('local-test')
            .end();
        await telemetry.shutdown();
        stopped = true;
        expect(requests).toEqual(['/v1/traces']); // No implicit metrics export.
        const count = requests.length;
        const disabled = await initTelemetry({ enabled: false });
        expect(disabled.enabled).toBe(false);
        await disabled.shutdown();
        expect(requests).toHaveLength(count);
    } finally {
        if (telemetry && !stopped) await telemetry.shutdown();
        collector.closeAllConnections();
        await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
}, 10_000);
