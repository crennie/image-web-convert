import { createServer } from 'node:http';
import { trace } from '@opentelemetry/api';
import { initTelemetry, isTelemetryEnabled } from '../lib/instrumentation.js';

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
    vi.stubEnv('OTEL_TRACES_SAMPLER', 'always_off');
    vi.stubEnv('OTEL_METRICS_EXPORTER', undefined);
    vi.stubEnv(
        'OTEL_EXPORTER_OTLP_ENDPOINT',
        `http://127.0.0.1:${address.port}`,
    );
    vi.stubEnv('OTEL_LOGS_EXPORTER', 'none');
    let telemetry: Awaited<ReturnType<typeof initTelemetry>> | undefined;
    let stopped = false;
    try {
        const [first, concurrent] = await Promise.all([
            initTelemetry({
                enabled: true,
                environment: 'test',
                sampler: 'always_on',
                exporterEndpoint: `http://127.0.0.1:${address.port}`,
            }),
            initTelemetry({ enabled: false }),
        ]);
        telemetry = first;
        expect(concurrent).toBe(first);
        expect(telemetry.enabled).toBe(true);
        expect(isTelemetryEnabled()).toBe(true);
        const same = await initTelemetry({ enabled: false });
        expect(same).toBe(telemetry);
        trace
            .getTracer('dependency-compatibility')
            .startSpan('local-test')
            .end();
        await Promise.all([telemetry.shutdown(), same.shutdown()]);
        stopped = true;
        expect(isTelemetryEnabled()).toBe(false);
        expect(requests).toEqual(['/v1/traces']); // No implicit metrics export.
        const count = requests.length;
        const disabled = await initTelemetry({ enabled: false });
        expect(disabled.enabled).toBe(false);
        expect(await initTelemetry({ enabled: true })).toBe(disabled);
        await disabled.shutdown();
        expect(isTelemetryEnabled()).toBe(false);
        expect(requests).toHaveLength(count);
        const restarted = await initTelemetry({
            enabled: true,
            environment: 'test',
            sampler: 'always_on',
            exporterEndpoint: `http://127.0.0.1:${address.port}`,
        });
        expect(restarted).not.toBe(telemetry);
        expect(isTelemetryEnabled()).toBe(true);
        trace
            .getTracer('dependency-compatibility')
            .startSpan('restarted')
            .end();
        await restarted.shutdown();
        expect(isTelemetryEnabled()).toBe(false);
        expect(requests).toEqual(['/v1/traces', '/v1/traces']);
    } finally {
        if (telemetry && !stopped) await telemetry.shutdown();
        collector.closeAllConnections();
        await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
}, 10_000);

it('settles shutdown when the local collector rejects exports', async () => {
    let requests = 0;
    const collector = createServer((req, res) => {
        requests += 1;
        req.resume();
        req.on('end', () => {
            res.statusCode = 503;
            res.end('unavailable');
        });
    });
    collector.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => collector.once('listening', resolve));
    const address = collector.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing collector port');
    vi.stubEnv('OTEL_TRACES_SAMPLER', 'always_on');
    vi.stubEnv('OTEL_METRICS_EXPORTER', undefined);
    vi.stubEnv('OTEL_LOGS_EXPORTER', 'none');
    vi.stubEnv('OTEL_EXPORTER_OTLP_TIMEOUT', '250');
    let telemetry: Awaited<ReturnType<typeof initTelemetry>> | undefined;
    try {
        telemetry = await initTelemetry({
            enabled: true,
            environment: 'test',
            exporterEndpoint: `http://127.0.0.1:${address.port}`,
        });
        trace
            .getTracer('unavailable-collector')
            .startSpan('failed-export')
            .end();
        await expect(telemetry.shutdown()).rejects.toThrow(
            'Export failed with retryable status',
        );
        expect(isTelemetryEnabled()).toBe(false);
        expect(requests).toBeGreaterThan(0);
    } finally {
        if (isTelemetryEnabled()) await telemetry?.shutdown();
        collector.closeAllConnections();
        await new Promise<void>((resolve) => collector.close(() => resolve()));
    }
}, 10_000);
