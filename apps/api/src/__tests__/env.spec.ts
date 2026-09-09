import {
    getSessionImageConfig,
    getConversionRuntimeConfig,
    loadEnv,
} from '../env';

describe('API environment configuration', () => {
    it('loads explicit conversion resource bounds and deadline defaults', () => {
        expect(getConversionRuntimeConfig({})).toEqual({
            maxOperations: 3,
            maxUploads: 2,
            uploadIdleMs: 60000,
            uploadTotalMs: 300000,
            fileTimeoutMs: 120000,
            sweepIntervalMs: 1000,
            shutdownGraceMs: 10000,
            maxInputPixels: 200000000,
            maxDimension: 8192,
        });
        expect(
            getConversionRuntimeConfig({
                CONVERSION_MAX_OPERATIONS: '1',
                CONVERSION_FILE_TIMEOUT_MS: '500',
                CONVERSION_MAX_INPUT_PIXELS: '100',
            }),
        ).toMatchObject({
            maxOperations: 1,
            fileTimeoutMs: 500,
            maxInputPixels: 100,
        });
    });

    it.each([
        ['CONVERSION_MAX_OPERATIONS', '0'],
        ['CONVERSION_MAX_UPLOADS', '1.5'],
        ['CONVERSION_UPLOAD_IDLE_MS', '-1'],
        ['CONVERSION_UPLOAD_TOTAL_MS', '2147483648'],
        ['CONVERSION_FILE_TIMEOUT_MS', '3600001'],
        ['CONVERSION_SWEEP_INTERVAL_MS', '0'],
        ['CONVERSION_SHUTDOWN_GRACE_MS', 'NaN'],
        ['CONVERSION_MAX_INPUT_PIXELS', '0'],
        ['CONVERSION_MAX_DIMENSION', '0'],
    ])('rejects invalid conversion limit %s', (key, value) => {
        expect(() => loadEnv({ [key]: value })).toThrow('Invalid environment');
    });
    it('loads backend-owned image limits', () => {
        expect(
            getSessionImageConfig({
                SESSION_TTL_MINUTES: '30',
                SESSION_MAX_FILES: '8',
                SESSION_PER_FILE_BYTES: '1234',
                SESSION_MAX_TOTAL_BYTES: '5678',
            }),
        ).toEqual({
            ttlMinutes: 30,
            maxFiles: 8,
            maxBytesPerFile: 1234,
            maxTotalBytes: 5678,
        });
    });

    it.each([
        ['SESSION_TTL_MINUTES', '0'],
        ['SESSION_MAX_FILES', '-1'],
        ['SESSION_PER_FILE_BYTES', '1.5'],
        ['SESSION_MAX_TOTAL_BYTES', 'not-a-number'],
    ])('rejects invalid %s', (key, value) => {
        expect(() => loadEnv({ [key]: value })).toThrow('Invalid environment');
    });
});
