import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('observability configuration', () => {
    it.each([
        ['development', 'always_off', 'trace'],
        ['production', 'parentbased_always_off', 'error'],
    ])(
        'honors explicit sampler and log level in %s',
        async (mode, sampler, level) => {
            vi.stubEnv('NODE_ENV', mode);
            vi.stubEnv('OTEL_TRACES_SAMPLER', sampler);
            vi.stubEnv('LOG_LEVEL', level);
            const { loadObservabilityConfig } =
                await import('../lib/config.js');
            expect(loadObservabilityConfig()).toMatchObject({
                sampler,
                logLevel: level,
            });
        },
    );

    it.each([
        ['development', 'parentbased_always_on', 'debug'],
        ['production', 'parentbased_traceidratio', 'info'],
    ])('uses defaults in %s', async (mode, sampler, level) => {
        vi.stubEnv('NODE_ENV', mode);
        vi.stubEnv('OTEL_TRACES_SAMPLER', undefined);
        vi.stubEnv('LOG_LEVEL', undefined);
        const { loadObservabilityConfig } = await import('../lib/config.js');
        expect(loadObservabilityConfig()).toMatchObject({
            sampler,
            logLevel: level,
        });
    });
});
