import {
    diag,
    DiagConsoleLogger,
    DiagLogLevel,
    context,
    metrics,
    propagation,
    trace,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    defaultResource,
    resourceFromAttributes,
} from '@opentelemetry/resources';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
    AlwaysOffSampler,
    AlwaysOnSampler,
    ConsoleSpanExporter,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
    type Sampler,
} from '@opentelemetry/sdk-trace-base';
import { loadObservabilityConfig, type ObservabilityConfig } from './config.js';

/**
 * Global singleton guard to prevent double-initialization.
 */
const kTelemetry = Symbol.for('observability.bootstrap.state');
type TelemetryState = {
    starting?: Promise<TelemetryController>;
    controller?: TelemetryController;
    enabled: boolean;
    diagnosticsInitialized: boolean;
};
type TelemetryController = { enabled: boolean; shutdown: () => Promise<void> };

const g = globalThis as Record<string | symbol, unknown>;
if (!g[kTelemetry])
    g[kTelemetry] = { enabled: false, diagnosticsInitialized: false };
const state = g[kTelemetry] as TelemetryState;

function samplerFromConfig(cfg: ObservabilityConfig): Sampler {
    switch (cfg.sampler) {
        case 'always_on':
            return new AlwaysOnSampler();
        case 'always_off':
            return new AlwaysOffSampler();
        case 'parentbased_always_off':
            return new ParentBasedSampler({ root: new AlwaysOffSampler() });
        case 'parentbased_traceidratio':
            return new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(cfg.samplerArg),
            });
        case 'parentbased_always_on':
            return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    }
}

/**
 * Initialize OpenTelemetry Node SDK with sensible defaults.
 * Call this once, as early as possible in app entry (before express app creation).
 * @return - controller with a shutdown() to await for on process exit.
 */
export async function initTelemetry(
    configOverrides?: Partial<ObservabilityConfig>,
): Promise<TelemetryController> {
    if (state.controller) return state.controller;
    if (state.starting) return state.starting;
    const starting = startTelemetry(configOverrides);
    state.starting = starting;
    try {
        return await starting;
    } finally {
        if (state.starting === starting) state.starting = undefined;
    }
}

async function startTelemetry(
    configOverrides?: Partial<ObservabilityConfig>,
): Promise<TelemetryController> {
    const cfg = loadObservabilityConfig(configOverrides);

    if (!cfg.enabled) {
        state.enabled = false;
        const controller: TelemetryController = {
            enabled: false,
            shutdown: async () => {
                if (state.controller === controller)
                    state.controller = undefined;
            },
        };
        state.controller = controller;
        return controller;
    }

    // SDK diagnostics are process-global; registering more than once emits a warning.
    if (!state.diagnosticsInitialized) {
        diag.setLogger(
            new DiagConsoleLogger(),
            cfg.environment === 'prod' ? DiagLogLevel.ERROR : DiagLogLevel.WARN,
        );
        state.diagnosticsInitialized = true;
    }

    const resource = defaultResource().merge(
        resourceFromAttributes({
            'service.name': cfg.serviceName,
            'service.version': cfg.serviceVersion,
            'deployment.environment': cfg.environment,
        }),
    );

    // Choose exporter: OTLP HTTP (preferred); fallback to console in dev if endpoint looks local.
    const otlpBase = cfg.exporterEndpoint.replace(/\/+$/, '');
    const otlpUrl = `${otlpBase}/v1/traces`;
    const exporter =
        cfg.environment === 'dev' && otlpBase.includes('localhost')
            ? new ConsoleSpanExporter()
            : new OTLPTraceExporter({ url: otlpUrl });

    // Auto-instrumentations: http + express (others are fine with defaults).
    const instrumentations = getNodeAutoInstrumentations({
        // Keep common noisy libs minimal for now; adjust as you grow.
        '@opentelemetry/instrumentation-fs': { enabled: false },

        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-pino': { enabled: true },
    });

    const sdk = new NodeSDK({
        resource,
        traceExporter: exporter,
        sampler: samplerFromConfig(cfg),
        // SDK 0.223 enables OTLP metrics by default; 0.203 required an explicit
        // exporter. Preserve that opt-in and avoid a new collector connection.
        metricReaders: process.env.OTEL_METRICS_EXPORTER?.split(',').some(
            (value) => value.trim(),
        )
            ? undefined
            : [],
        instrumentations,
    });

    await sdk.start();

    state.enabled = true;
    let stopping: Promise<void> | undefined;
    const controller: TelemetryController = {
        enabled: true,
        shutdown: () => {
            stopping ??= sdk.shutdown().finally(() => {
                if (state.controller === controller) {
                    // NodeSDK.shutdown() flushes providers but leaves API globals
                    // registered. Release them before another SDK can start.
                    context.disable();
                    propagation.disable();
                    trace.disable();
                    metrics.disable();
                    state.controller = undefined;
                    state.enabled = false;
                }
            });
            return stopping;
        },
    };
    state.controller = controller;
    return controller;
}

/**
 * Return correlation fields for logs based on the current active span.
 * Use these in your logger child bindings (e.g., req.log).
 */
export function getTraceCorrelation():
    | { trace_id: string; span_id: string }
    | { trace_id?: undefined; span_id?: undefined } {
    const span = trace.getSpan(context.active());
    if (!span) return {};
    const sc = span.spanContext();
    return sc && sc.traceId && sc.spanId
        ? { trace_id: sc.traceId, span_id: sc.spanId }
        : {};
}

/**
 * Convenience boolean you can consult if needed (after init).
 */
export function isTelemetryEnabled(): boolean {
    return !!state.enabled;
}
