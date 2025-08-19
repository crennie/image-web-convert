import {
    diag,
    DiagConsoleLogger,
    DiagLogLevel,
    context,
    trace,
} from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
    defaultResource,
    resourceFromAttributes,
} from '@opentelemetry/resources';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { loadObservabilityConfig, type ObservabilityConfig } from './config.js';

/**
 * Global singleton guard to prevent double-initialization.
 */
const kTelemetry = Symbol.for('observability.bootstrap.state');
type TelemetryState = {
    initialized: boolean;
    enabled: boolean;
    sdk?: NodeSDK | undefined;
    cfg?: ObservabilityConfig;
};

const g = globalThis as Record<string | symbol, unknown>;
if (!g[kTelemetry]) g[kTelemetry] = { initialized: false, enabled: false };
const state = g[kTelemetry] as TelemetryState;

/**
 * Initialize OpenTelemetry Node SDK with sensible defaults.
 * Call this once, as early as possible in app entry (before express app creation).
 * @return - controller with a shutdown() to await for on process exit.
 */
export async function initTelemetry(
    configOverrides?: Partial<ObservabilityConfig>
): Promise<{ enabled: boolean; shutdown: () => Promise<void> }> {
    if (state.initialized) {
        return {
            enabled: state.enabled,
            shutdown: async () => {
                await state.sdk?.shutdown();
            },
        };
    }

    const cfg = loadObservabilityConfig(configOverrides);
    state.cfg = cfg;

    // SDK internal diagnostics: quiet in prod, helpful in dev.
    diag.setLogger(
        new DiagConsoleLogger(),
        cfg.environment === 'prod' ? DiagLogLevel.ERROR : DiagLogLevel.INFO
    );

    if (!cfg.enabled) {
        state.initialized = true;
        state.enabled = false;
        return {
            enabled: false,
            shutdown: async () => {
                Promise.resolve();
            },
        };
    }

    const resource = defaultResource().merge(
        resourceFromAttributes({
            'service.name': cfg.serviceName,
            'service.version': cfg.serviceVersion,
            'deployment.environment': cfg.environment,
        })
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
        instrumentations,
    });

    // Sampler: NodeSDK reads env OTEL_TRACES_* directly, but we also adapt here for programmatic control.
    // When using ratio sampling, set OTEL_TRACES_SAMPLER(_ARG) via env for consistency across processes.
    // (We intentionally defer to env to keep behavior consistent with other tooling.)

    await sdk.start();

    state.sdk = sdk;
    state.initialized = true;
    state.enabled = true;

    return {
        enabled: true,
        shutdown: async () => {
            try {
                await sdk.shutdown();
            } finally {
                state.initialized = false;
                state.enabled = false;
                state.sdk = undefined;
            }
        },
    };
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
